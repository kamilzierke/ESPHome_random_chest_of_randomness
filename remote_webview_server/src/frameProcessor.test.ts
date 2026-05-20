import { describe, expect, it } from "vitest";
import { drawTileDebugBorder } from "./frameProcessor.js";

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
