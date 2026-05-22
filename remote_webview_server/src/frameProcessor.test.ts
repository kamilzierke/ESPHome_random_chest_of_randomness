import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { Encoding, FRAME_HEADER_BYTES, TILE_HEADER_BYTES } from "./protocol.js";
import { FrameProcessor, FrameProcessorCfg, drawTileDebugBorder } from "./frameProcessor.js";

function rgbaAt(buf: Buffer, width: number, x: number, y: number): number[] {
  const off = (y * width + x) * 4;
  return [buf[off], buf[off + 1], buf[off + 2], buf[off + 3]];
}

describe("drawTileDebugBorder", () => {
  it("draws a full-frame border without touching interior pixels", () => {
    const width = 4;
    const height = 3;
    const raw = Buffer.alloc(width * height * 4, 0);

    drawTileDebugBorder(raw, width, height, true);

    expect(rgbaAt(raw, width, 0, 0)).toEqual([0, 160, 255, 255]);
    expect(rgbaAt(raw, width, 3, 2)).toEqual([0, 160, 255, 255]);
    expect(rgbaAt(raw, width, 1, 1)).toEqual([0, 0, 0, 0]);
  });

  it("uses a different border color for partial updates", () => {
    const width = 3;
    const height = 3;
    const raw = Buffer.alloc(width * height * 4, 0);

    drawTileDebugBorder(raw, width, height, false);

    expect(rgbaAt(raw, width, 0, 0)).toEqual([255, 180, 0, 255]);
    expect(rgbaAt(raw, width, 2, 2)).toEqual([255, 180, 0, 255]);
    expect(rgbaAt(raw, width, 1, 1)).toEqual([0, 0, 0, 0]);
  });
});

describe("FrameProcessor render modes", () => {
  function makeProcessor(renderMode: string, overrides: Partial<FrameProcessorCfg> = {}) {
    const processor = new FrameProcessor({
      tileSize: 4,
      fullframeTileCount: 1,
      fullframeAreaThreshold: 0.9,
      jpegQuality: 75,
      fullFrameEvery: 100,
      maxBytesPerMessage: 61440,
      renderMode,
      ...overrides,
    });
    processor.requestFullFrame();
    return processor;
  }

  function makeSolidFrame(width = 4, height = 4) {
    const rgba = Buffer.alloc(width * height * 4, 0);
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = 0x20;
      rgba[i + 1] = 0x80;
      rgba[i + 2] = 0xc0;
      rgba[i + 3] = 0xff;
    }
    return { data: rgba, width, height };
  }

  function makeBlueNoiseFrame(width: number, height: number) {
    const rgba = Buffer.alloc(width * height * 4, 0);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const off = (y * width + x) * 4;
        const v = (x * 17 + y * 31 + ((x * y) % 251)) & 0xff;
        rgba[off] = v >> 3;
        rgba[off + 1] = 96 + (v >> 2);
        rgba[off + 2] = 160 + (v >> 3);
        rgba[off + 3] = 0xff;
      }
    }
    return { data: rgba, width, height };
  }

  async function jpegSize(frame: ReturnType<typeof makeBlueNoiseFrame>, quality: number): Promise<number> {
    return sharp(frame.data, { raw: { width: frame.width, height: frame.height, channels: 4 } })
      .jpeg({ quality, mozjpeg: false, chromaSubsampling: "4:2:0" })
      .toBuffer()
      .then((buf) => buf.length);
  }

  async function averageRgb(encodedJpeg: Buffer): Promise<[number, number, number]> {
    const { data, info } = await sharp(encodedJpeg).raw().toBuffer({ resolveWithObject: true });
    const sums = [0, 0, 0];
    for (let i = 0; i < data.length; i += info.channels) {
      sums[0] += data[i];
      sums[1] += data[i + 1];
      sums[2] += data[i + 2];
    }
    const pixels = data.length / info.channels;
    return [sums[0] / pixels, sums[1] / pixels, sums[2] / pixels];
  }

  it("encodes frame rects as PNG when renderMode is png", async () => {
    const out = await makeProcessor("png").processFrameAsync(makeSolidFrame());

    expect(out.encoding).toBe(Encoding.PNG);
    expect(out.rects).toHaveLength(1);
    expect(out.rects[0].data.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  it("encodes frame rects as JPEG when renderMode is jpeg", async () => {
    const out = await makeProcessor("jpeg").processFrameAsync(makeSolidFrame());

    expect(out.encoding).toBe(Encoding.JPEG);
    expect(out.rects).toHaveLength(1);
    expect(out.rects[0].data.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  });

  it("encodes frame rects as little-endian RAW565 when renderMode is raw565", async () => {
    const out = await makeProcessor("raw565").processFrameAsync(makeSolidFrame());

    expect(out.encoding).toBe(Encoding.RAW565);
    expect(out.rects).toHaveLength(1);
    expect(out.rects[0].data).toHaveLength(4 * 4 * 2);
    expect(out.rects[0].data.subarray(0, 2)).toEqual(Buffer.from([0x18, 0x24]));
  });

  it("splits RAW565 full frames so each rect fits the packet payload budget", async () => {
    const maxPayloadBytes = 16;
    const out = await makeProcessor("raw565", {
      fullframeTileCount: 1,
      maxBytesPerMessage: FRAME_HEADER_BYTES + TILE_HEADER_BYTES + maxPayloadBytes,
    }).processFrameAsync(makeSolidFrame(8, 8));

    expect(out.encoding).toBe(Encoding.RAW565);
    expect(out.rects.length).toBeGreaterThan(1);
    expect(out.rects.every((r) => r.data.length <= maxPayloadBytes)).toBe(true);
    expect(out.rects.reduce((sum, r) => sum + r.data.length, 0)).toBe(8 * 8 * 2);
  });

  it("retries JPEG at lower quality before using a fallback tile", async () => {
    const frame = makeBlueNoiseFrame(64, 64);
    const quality95Size = await jpegSize(frame, 95);
    const quality35Size = await jpegSize(frame, 35);
    const maxPayloadBytes = Math.floor((quality95Size + quality35Size) / 2);

    const out = await makeProcessor("jpeg", {
      jpegQuality: 95,
      maxBytesPerMessage: FRAME_HEADER_BYTES + TILE_HEADER_BYTES + maxPayloadBytes,
    }).processFrameAsync(frame);

    expect(out.encoding).toBe(Encoding.JPEG);
    expect(out.rects).toHaveLength(1);
    expect(out.rects[0].data.length).toBeLessThanOrEqual(maxPayloadBytes);

    const [r, g, b] = await averageRgb(out.rects[0].data);
    expect(g).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(r);
  });

  it("splits JPEG tiles when lowering quality cannot fit the packet payload budget", async () => {
    const frame = makeBlueNoiseFrame(96, 96);
    const maxPayloadBytes = 900;

    const out = await makeProcessor("jpeg", {
      jpegQuality: 95,
      adaptiveMinJpegQuality: 95,
      maxBytesPerMessage: FRAME_HEADER_BYTES + TILE_HEADER_BYTES + maxPayloadBytes,
    }).processFrameAsync(frame);

    expect(out.encoding).toBe(Encoding.JPEG);
    expect(out.rects.length).toBeGreaterThan(1);
    expect(out.rects.every((r) => r.data.length <= maxPayloadBytes)).toBe(true);
  });

  it.each(["auto", "raw565_rle"])(
    "falls back to JPEG for unsupported renderMode=%s so clients do not receive undecodable packets",
    async (renderMode) => {
      const out = await makeProcessor(renderMode).processFrameAsync(makeSolidFrame());

      expect(out.encoding).toBe(Encoding.JPEG);
      expect(out.rects).toHaveLength(1);
      expect(out.rects[0].data.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    },
  );
});
