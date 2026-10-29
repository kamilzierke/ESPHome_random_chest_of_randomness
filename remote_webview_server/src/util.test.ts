import { describe, expect, it } from "vitest";
import { hash32, mapPointForRotation, getRotatedDimensions } from "./util.js";

describe("screen changes and rotation", () => {
  it("detects a change in every RGBA byte, including green, blue and alpha", () => {
    const initial = Buffer.alloc(16, 0);
    for (let i = 0; i < initial.length; ++i) {
      const changed = Buffer.from(initial);
      changed[i] = 1;
      expect(hash32(changed)).not.toBe(hash32(initial));
    }
  });

  it.each([0, 90, 180, 270] as const)("maps all display corners back to the browser at %i degrees", (r) => {
    const width = 800, height = 1280;
    const rotated = getRotatedDimensions(width, height, r);
    const corners = [[0, 0], [rotated.width - 1, 0], [0, rotated.height - 1], [rotated.width - 1, rotated.height - 1]];
    const mapped = corners.map(([x, y]) => mapPointForRotation(x, y, width, height, r));
    expect(new Set(mapped.map(p => `${p.x},${p.y}`)).size).toBe(4);
    for (const p of mapped) {
      expect([0, width - 1]).toContain(p.x);
      expect([0, height - 1]).toContain(p.y);
    }
  });
});
