import os from "node:os";
import sharp from "sharp";
import { Encoding, FRAME_HEADER_BYTES, TILE_HEADER_BYTES } from "./protocol.js";
import { hash32 } from "./util.js";

sharp.concurrency(Math.max(1, os.cpus().length - 1));

export type RGBA = { data: Buffer; width: number; height: number };

export type Rect = { x: number; y: number; w: number; h: number; data: Buffer };

export type FrameOut = {
  rects: Rect[];
  isFullFrame: boolean;
  encoding: Encoding;
};

export type FrameProcessOptions = {
  debugOverlayEnabled?: boolean;
};

export type FrameProcessorCfg = {
  tileSize: number;
  fullframeTileCount: number;
  fullframeAreaThreshold: number;
  jpegQuality: number;
  fullFrameEvery: number;
  maxBytesPerMessage: number;
  renderMode?: string;
  adaptiveQualityEnabled?: boolean;
  adaptiveMinJpegQuality?: number;
  adaptiveQualityStep?: number;
  adaptiveSplitEnabled?: boolean;
  adaptiveSplitMinTileSize?: number;
};

export class FrameProcessor {
  private _cfg: FrameProcessorCfg;
  private _cols = 0;
  private _rows = 0;
  private _prev?: Uint32Array;
  private _iter = 0;
  private _fullFrameRequested = false;

  constructor(cfg: FrameProcessorCfg) {
    this._cfg = cfg;
  }

  public requestFullFrame(): void {
    this._iter = 0;
    this._fullFrameRequested = true;
  }

  public async processFrameAsync(rgba: RGBA, options: FrameProcessOptions = {}): Promise<FrameOut> {
    if (!this._prev) this._initGrid(rgba.width, rgba.height);

    let forceFull = (this._iter % this._cfg.fullFrameEvery) === 0;
    if (this._fullFrameRequested) {
      forceFull = true;
      this._fullFrameRequested = false;
    }
    const chosenEncoding = this._chooseEncoding();

    type TileInfo = { x: number; y: number; w: number; h: number; idx: number; h32: number; changed: boolean };
    const tiles: TileInfo[] = [];
    let changedArea = 0;

    for (let ty = 0; ty < this._rows; ty++) {
      for (let tx = 0; tx < this._cols; tx++) {
        const x = tx * this._cfg.tileSize;
        const y = ty * this._cfg.tileSize;
        const w = Math.min(this._cfg.tileSize, rgba.width - x);
        const h = Math.min(this._cfg.tileSize, rgba.height - y);

        const raw = this._extractRaw(rgba, x, y, w, h);
        const h32 = hash32(raw);
        const idx = ty * this._cols + tx;
        const prev = this._prev![idx];
        const changed = forceFull || (prev !== h32);

        tiles.push({ x, y, w, h, idx, h32, changed });
        if (changed) changedArea += w * h;
      }
    }

    const totalArea = rgba.width * rgba.height;
    const changedPct = totalArea > 0 ? (changedArea / totalArea) : 0;
    const doFull = forceFull || (changedPct > this._cfg.fullframeAreaThreshold);

    let out: FrameOut;
    if (doFull) {
      out = await this._processFullFrame(rgba, tiles, chosenEncoding, options.debugOverlayEnabled === true);
    } else {
      out = await this._processPartialFrame(rgba, tiles, chosenEncoding, options.debugOverlayEnabled === true);
    }

    this._iter++;
    return out;
  }

  private async _processFullFrame(
    rgba: RGBA,
    tilesInfo: { idx: number; h32: number }[],
    encoding: Encoding,
    debugOverlayEnabled: boolean
  ): Promise<FrameOut> {
    const fullFrameTileCount = encoding === Encoding.RAW565
      ? this._raw565FullFrameTileCount(rgba.width, rgba.height)
      : this._cfg.fullframeTileCount;
    const rectsForFull = this._splitWholeFrame(rgba.width, rgba.height, fullFrameTileCount);
    const rects: Rect[] = [];

    for (const r of rectsForFull) {
      rects.push(...await this._encodeRectAdaptive(rgba, r, encoding, debugOverlayEnabled, true));
    }

    for (const t of tilesInfo) this._prev![t.idx] = t.h32;

    return { rects, isFullFrame: true, encoding };
  }

  private async _processPartialFrame(
    rgba: RGBA,
    tiles: { x: number; y: number; w: number; h: number; idx: number; h32: number; changed: boolean }[],
    encoding: Encoding,
    debugOverlayEnabled: boolean
  ): Promise<FrameOut> {
    const mergedRects = this._mergeChangedTiles(tiles, rgba.width, rgba.height);

    const out: Rect[] = [];
    for (const r of mergedRects) {
      out.push(...await this._encodeRectAdaptive(rgba, r, encoding, debugOverlayEnabled, false));
    }
    for (const t of tiles) if (t.changed) this._prev![t.idx] = t.h32;

    return { rects: out, isFullFrame: false, encoding };
  }

  private _splitWholeFrame(w: number, h: number, n: number): { x: number; y: number; w: number; h: number }[] {
    if (n <= 1) return [{ x: 0, y: 0, w, h }];

    if (n === 2) {
      const h1 = Math.floor(h / 2);
      const h2 = h - h1;
      return [
        { x: 0, y: 0, w, h: h1 },
        { x: 0, y: h1, w, h: h2 },
      ];
    }

    let rows = Math.floor(Math.sqrt(n));
    while (rows > 1 && (n % rows !== 0)) rows--;
    const cols = Math.floor(n / rows);

    const split = (size: number, parts: number): number[] => {
      const out: number[] = [];
      let prev = 0;
      for (let i = 1; i <= parts; i++) {
        const cur = Math.floor((i * size) / parts);
        out.push(cur - prev);
        prev = cur;
      }
      return out;
    };

    const widths = split(w, cols);
    const heights = split(h, rows);

    const rects: { x: number; y: number; w: number; h: number }[] = [];
    let yAcc = 0;
    for (let r = 0; r < rows; r++) {
      let xAcc = 0;
      for (let c = 0; c < cols; c++) {
        rects.push({ x: xAcc, y: yAcc, w: widths[c], h: heights[r] });
        xAcc += widths[c];
      }
      yAcc += heights[r];
    }
    return rects;
  }

  private _raw565FullFrameTileCount(w: number, h: number): number {
    const maxBytesPerTile = this._cfg.maxBytesPerMessage - FRAME_HEADER_BYTES - TILE_HEADER_BYTES;
    if (maxBytesPerTile < 2) return this._cfg.fullframeTileCount;

    let n = Math.max(1, this._cfg.fullframeTileCount);
    const maxParts = Math.max(1, w * h);
    while (n < maxParts) {
      const rects = this._splitWholeFrame(w, h, n);
      if (rects.every((r) => r.w * r.h * 2 <= maxBytesPerTile)) return n;
      n++;
    }
    return n;
  }

  private _getMaxFullTileSize(frameW: number, frameH: number): { maxW: number; maxH: number } {
    const fullRects = this._splitWholeFrame(frameW, frameH, this._cfg.fullframeTileCount);
    let maxW = 0, maxH = 0;
    for (const r of fullRects) {
      if (r.w > maxW) maxW = r.w;
      if (r.h > maxH) maxH = r.h;
    }
    return { maxW, maxH };
  }

  private _calcGridSplits(frameW: number, frameH: number) {
    const cols = this._cols, rows = this._rows, ts = this._cfg.tileSize;
    const widths: number[] = new Array(cols);
    const heights: number[] = new Array(rows);
    const xOffsets: number[] = new Array(cols);
    const yOffsets: number[] = new Array(rows);

    let x = 0;
    for (let c = 0; c < cols; c++) {
      const w = Math.min(ts, frameW - x);
      widths[c] = w;
      xOffsets[c] = x;
      x += w;
    }
    let y = 0;
    for (let r = 0; r < rows; r++) {
      const h = Math.min(ts, frameH - y);
      heights[r] = h;
      yOffsets[r] = y;
      y += h;
    }
    return { widths, heights, xOffsets, yOffsets };
  }

  private _mergeChangedTiles(
    tiles: { x: number; y: number; w: number; h: number; idx: number; h32: number; changed: boolean }[],
    frameW: number,
    frameH: number
  ): { x: number; y: number; w: number; h: number }[] {
    const cols = this._cols, rows = this._rows;
    const changed: boolean[][] = Array.from({ length: rows }, () => Array<boolean>(cols).fill(false));
    const visited: boolean[][] = Array.from({ length: rows }, () => Array<boolean>(cols).fill(false));

    for (let i = 0; i < tiles.length; i++) {
      const ty = Math.floor(i / cols);
      const tx = i % cols;
      changed[ty][tx] = tiles[i].changed;
    }

    const { widths, heights, xOffsets, yOffsets } = this._calcGridSplits(frameW, frameH);
    const { maxW, maxH } = this._getMaxFullTileSize(frameW, frameH);

    const rects: { x: number; y: number; w: number; h: number }[] = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!changed[r][c] || visited[r][c]) continue;

        // grow horizontally
        let wTiles = 0, pxW = 0;
        while (c + wTiles < cols && changed[r][c + wTiles] && !visited[r][c + wTiles]) {
          const nextW = pxW + widths[c + wTiles];
          if (nextW > maxW) break;
          pxW = nextW;
          wTiles++;
        }

        // grow vertically
        let hTiles = 1, pxH = heights[r];
        let canGrow = true;
        while (canGrow && (r + hTiles) < rows) {
          const nextH = pxH + heights[r + hTiles];
          if (nextH > maxH) break;
          for (let cc = c; cc < c + wTiles; cc++) {
            if (!changed[r + hTiles][cc] || visited[r + hTiles][cc]) { canGrow = false; break; }
          }
          if (!canGrow) break;
          pxH = nextH;
          hTiles++;
        }

        rects.push({ x: xOffsets[c], y: yOffsets[r], w: pxW, h: pxH });

        for (let rr = r; rr < r + hTiles; rr++) {
          for (let cc = c; cc < c + wTiles; cc++) {
            visited[rr][cc] = true;
          }
        }
      }
    }

    return rects;
  }

  private _initGrid(w: number, h: number) {
    this._cols = Math.ceil(w / this._cfg.tileSize);
    this._rows = Math.ceil(h / this._cfg.tileSize);
    this._prev = new Uint32Array(this._cols * this._rows);
  }

  private _extractRaw(rgba: RGBA, x: number, y: number, w: number, h: number): Buffer {
    const out = Buffer.allocUnsafe(w * h * 4);
    for (let yy = 0; yy < h; yy++) {
      const src = ((y + yy) * rgba.width + x) * 4;
      rgba.data.copy(out, yy * w * 4, src, src + w * 4);
    }
    return out;
  }

  private async _encode(rawRgba: Buffer, w: number, h: number, enc: Encoding): Promise<Buffer> {
    switch (enc) {
      case Encoding.PNG:
        return this._encodePNG(rawRgba, w, h);
      case Encoding.JPEG:
        return this._encodeJPEG(rawRgba, w, h, this._cfg.jpegQuality);
      case Encoding.RAW565:
        return this._encodeRAW565(rawRgba);
      default:
        return this._encodeJPEG(rawRgba, w, h, this._cfg.jpegQuality);
    }
  }

  private _chooseEncoding(): Encoding {
    switch (this._cfg.renderMode) {
      case "png":
        return Encoding.PNG;
      case "raw565":
        return Encoding.RAW565;
      case "jpeg":
      case "auto":
      case "raw565_rle":
      default:
        return Encoding.JPEG;
    }
  }

  private async _encodeJPEG(rawRgba: Buffer, w: number, h: number, quality: number): Promise<Buffer> {
    return sharp(rawRgba, { raw: { width: w, height: h, channels: 4 } })
      .jpeg({ quality, mozjpeg: false, chromaSubsampling: "4:2:0" })
      .toBuffer();
  }

  private async _encodePNG(rawRgba: Buffer, w: number, h: number): Promise<Buffer> {
    return sharp(rawRgba, { raw: { width: w, height: h, channels: 4 } })
      .png({ compressionLevel: 3, adaptiveFiltering: false })
      .toBuffer();
  }

  private _encodeRAW565(rawRgba: Buffer): Buffer {
    const pxCount = rawRgba.length >> 2;
    const out = Buffer.allocUnsafe(pxCount * 2);
    for (let i = 0, j = 0; i < pxCount; i++, j += 4) {
      const r = rawRgba[j];
      const g = rawRgba[j + 1];
      const b = rawRgba[j + 2];
      const v = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
      out[i * 2] = v & 0xFF;
      out[i * 2 + 1] = (v >> 8) & 0xFF;
    }
    return out;
  }

  private async _makeRedFrameAsync(w: number, h: number, enc: Encoding): Promise<Buffer> {
    const raw = Buffer.allocUnsafe(w * h * 4);
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const RGBA_RED = 0xFF0000FF; // bytes: FF 00 00 FF
    for (let o = 0; o < raw.length; o += 4) view.setUint32(o, RGBA_RED, true);
    return this._encode(raw, w, h, enc);
  }

  private async _encodeRectAdaptive(
    rgba: RGBA,
    rect: { x: number; y: number; w: number; h: number },
    enc: Encoding,
    debugOverlayEnabled: boolean,
    isFullFrame: boolean
  ): Promise<Rect[]> {
    const maxBytesPerTile = this._cfg.maxBytesPerMessage - FRAME_HEADER_BYTES - TILE_HEADER_BYTES;
    const data = await this._tryEncodeWithinBudget(rgba, rect, enc, debugOverlayEnabled, isFullFrame, maxBytesPerTile);
    if (data) return [{ ...rect, data }];

    if (this._adaptiveSplitEnabled() && this._canSplitRect(rect)) {
      const [a, b] = this._splitRect(rect);
      return [
        ...await this._encodeRectAdaptive(rgba, a, enc, debugOverlayEnabled, isFullFrame),
        ...await this._encodeRectAdaptive(rgba, b, enc, debugOverlayEnabled, isFullFrame),
      ];
    }

    console.warn(`[frame] encoded tile exceeds message budget after adaptive fallback: x=${rect.x} y=${rect.y} w=${rect.w} h=${rect.h} enc=${enc}`);
    const redData = await this._makeRedFrameAsync(rect.w, rect.h, enc);
    return [{ ...rect, data: redData }];
  }

  private async _tryEncodeWithinBudget(
    rgba: RGBA,
    rect: { x: number; y: number; w: number; h: number },
    enc: Encoding,
    debugOverlayEnabled: boolean,
    isFullFrame: boolean,
    maxBytesPerTile: number
  ): Promise<Buffer | undefined> {
    if (maxBytesPerTile <= 0) return undefined;

    const raw = this._extractRaw(rgba, rect.x, rect.y, rect.w, rect.h);
    if (debugOverlayEnabled) drawTileDebugBorder(raw, rect.w, rect.h, isFullFrame);

    if (enc !== Encoding.JPEG || !this._adaptiveQualityEnabled()) {
      const data = await this._encode(raw, rect.w, rect.h, enc);
      return data.length <= maxBytesPerTile ? data : undefined;
    }

    const startQuality = Math.min(100, Math.max(1, Math.round(this._cfg.jpegQuality)));
    const minQuality = Math.min(startQuality, this._adaptiveMinJpegQuality());
    const step = this._adaptiveQualityStep();
    const tried = new Set<number>();
    for (let q = startQuality; q >= minQuality; q -= step) {
      const quality = Math.max(minQuality, Math.min(100, Math.round(q)));
      if (tried.has(quality)) continue;
      tried.add(quality);

      const data = await this._encodeJPEG(raw, rect.w, rect.h, quality);
      if (data.length <= maxBytesPerTile) return data;
    }

    if (!tried.has(minQuality)) {
      const data = await this._encodeJPEG(raw, rect.w, rect.h, minQuality);
      if (data.length <= maxBytesPerTile) return data;
    }

    return undefined;
  }

  private _adaptiveQualityEnabled(): boolean {
    return this._cfg.adaptiveQualityEnabled !== false;
  }

  private _adaptiveMinJpegQuality(): number {
    return Math.min(100, Math.max(1, Math.round(this._cfg.adaptiveMinJpegQuality ?? 35)));
  }

  private _adaptiveQualityStep(): number {
    return Math.min(100, Math.max(1, Math.round(this._cfg.adaptiveQualityStep ?? 10)));
  }

  private _adaptiveSplitEnabled(): boolean {
    return this._cfg.adaptiveSplitEnabled !== false;
  }

  private _adaptiveSplitMinTileSize(): number {
    return Math.max(1, Math.round(this._cfg.adaptiveSplitMinTileSize ?? 16));
  }

  private _canSplitRect(rect: { w: number; h: number }): boolean {
    const min = this._adaptiveSplitMinTileSize();
    return rect.w > min || rect.h > min;
  }

  private _splitRect(rect: { x: number; y: number; w: number; h: number }): [
    { x: number; y: number; w: number; h: number },
    { x: number; y: number; w: number; h: number }
  ] {
    const splitWidth = rect.w >= rect.h && rect.w > this._adaptiveSplitMinTileSize();
    if (splitWidth) {
      const w1 = Math.floor(rect.w / 2);
      return [
        { x: rect.x, y: rect.y, w: w1, h: rect.h },
        { x: rect.x + w1, y: rect.y, w: rect.w - w1, h: rect.h },
      ];
    }

    const h1 = Math.floor(rect.h / 2);
    return [
      { x: rect.x, y: rect.y, w: rect.w, h: h1 },
      { x: rect.x, y: rect.y + h1, w: rect.w, h: rect.h - h1 },
    ];
  }

  public updateConfig(cfg: FrameProcessorCfg): void {
    const tileSizeChanged = cfg.tileSize !== this._cfg.tileSize;
    this._cfg = cfg;
    if (tileSizeChanged) {
      this._cols = 0;
      this._rows = 0;
      this._prev = undefined;
    }
    this.requestFullFrame();
  }
}

export function drawTileDebugBorder(rawRgba: Buffer, w: number, h: number, isFullFrame: boolean): void {
  if (w <= 0 || h <= 0 || rawRgba.length < w * h * 4)
    return;

  const color = isFullFrame
    ? [0, 160, 255, 255]
    : [255, 180, 0, 255];

  const setPixel = (x: number, y: number) => {
    const off = (y * w + x) * 4;
    rawRgba[off] = color[0];
    rawRgba[off + 1] = color[1];
    rawRgba[off + 2] = color[2];
    rawRgba[off + 3] = color[3];
  };

  for (let x = 0; x < w; x++) {
    setPixel(x, 0);
    setPixel(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    setPixel(0, y);
    setPixel(w - 1, y);
  }
}
