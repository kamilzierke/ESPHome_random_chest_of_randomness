import { describe, expect, it } from "vitest";
import { Encoding } from "./protocol.js";
import { FrameProcessor, drawTileDebugBorder } from "./frameProcessor.js";

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

describe("FrameProcessor PNG mode", () => {
  function makeProcessor(renderMode: string) {
    const processor = new FrameProcessor({
      tileSize: 4,
      fullframeTileCount: 1,
      fullframeAreaThreshold: 0.9,
      jpegQuality: 75,
      fullFrameEvery: 100,
      maxBytesPerMessage: 61440,
      renderMode,
    });
    processor.requestFullFrame();
    return processor;
  }

  function makeSolidFrame() {
    const rgba = Buffer.alloc(4 * 4 * 4, 0);
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = 0x20;
      rgba[i + 1] = 0x80;
      rgba[i + 2] = 0xc0;
      rgba[i + 3] = 0xff;
    }
    return { data: rgba, width: 4, height: 4 };
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

  it.each(["auto", "raw565", "raw565_rle"])(
    "falls back to JPEG for unsupported renderMode=%s so clients do not receive undecodable packets",
    async (renderMode) => {
      const out = await makeProcessor(renderMode).processFrameAsync(makeSolidFrame());

      expect(out.encoding).toBe(Encoding.JPEG);
      expect(out.rects).toHaveLength(1);
      expect(out.rects[0].data.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    },
  );
});
