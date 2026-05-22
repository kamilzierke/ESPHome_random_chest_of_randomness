import { describe, expect, it } from "vitest";
import { makeConfigFromParams } from "./config.js";

function makeParams(renderMode: string): URLSearchParams {
  return new URLSearchParams({
    id: "panel01",
    w: "480",
    h: "480",
    rm: renderMode,
  });
}

describe("render mode config", () => {
  it("parses rm=png as PNG render mode", () => {
    expect(makeConfigFromParams(makeParams("png")).renderMode).toBe("png");
  });

  it("parses rm=jpeg as JPEG render mode", () => {
    expect(makeConfigFromParams(makeParams("jpeg")).renderMode).toBe("jpeg");
  });

  it("parses rm=raw565 as RAW565 render mode", () => {
    expect(makeConfigFromParams(makeParams("raw565")).renderMode).toBe("raw565");
  });

  it("rejects unknown render modes at config parsing", () => {
    expect(() => makeConfigFromParams(makeParams("avif"))).toThrow(/invalid render mode/);
  });

  it("uses adaptive fallback defaults", () => {
    const cfg = makeConfigFromParams(makeParams("jpeg"));

    expect(cfg.adaptiveQualityEnabled).toBe(true);
    expect(cfg.adaptiveMinJpegQuality).toBe(35);
    expect(cfg.adaptiveQualityStep).toBe(10);
    expect(cfg.adaptiveSplitEnabled).toBe(true);
    expect(cfg.adaptiveSplitMinTileSize).toBe(16);
  });
});
