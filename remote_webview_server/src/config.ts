import env from "env-var";
import { getRotatedDimensions, Rotation } from "./util.js";

export type RenderMode = "auto" | "jpeg" | "png" | "raw565" | "raw565_rle";

export type DeviceConfig = {
  height: number;                   // px
  width: number;                    // px
  tileSize: number;                 // px
  fullFrameTileCount: number;       // tiles
  fullFrameAreaThreshold: number;   // 0..1
  fullFrameEvery: number;           // frames
  everyNthFrame: number;            // frames (>=1)
  minFrameInterval: number;         // ms (>=0)
  jpegQuality: number;              // 1..100
  maxBytesPerMessage: number;       // bytes (>0)
  rotation: Rotation;               // degrees
  renderMode: RenderMode;           // requested render mode
};

const DEFAULTS = {
  tileSize: 32,
  fullFrameTileCount: 4,
  fullFrameAreaThreshold: 0.5,
  fullFrameEvery: 50,
  everyNthFrame: 1,
  minFrameInterval: 80,
  jpegQuality: 85,
  maxBytesPerMessage: 14336,
  rotation: 0,
  renderMode: "jpeg",
} as const;

const store = new Map<string, DeviceConfig>();

export function getConfigFor(id: string): DeviceConfig {
  const cfg = store.get(id);
  if (!cfg) throw new Error(`config for id="${id}" not found`);
  return cfg;
}
export function setConfigFor(id: string, cfg: DeviceConfig): void {
  store.set(id, cfg);
}

function num(input?: string | null): number | undefined {
  if (input == null) return undefined;
  const v = Number(input);
  if (!Number.isFinite(v)) throw new Error(`invalid number: "${input}"`);
  return v;
}
function intPos(input?: string | null): number | undefined {
  const v = num(input);
  if (v == null) return undefined;
  if (!Number.isInteger(v) || v <= 0) throw new Error(`invalid positive integer: "${input}"`);
  return v;
}
function intNonNeg(input?: string | null): number | undefined {
  const v = num(input);
  if (v == null) return undefined;
  if (!Number.isInteger(v) || v < 0) throw new Error(`invalid non-negative integer: "${input}"`);
  return v;
}
function float01(input?: string | null): number | undefined {
  const v = num(input);
  if (v == null) return undefined;
  if (v < 0 || v > 1) throw new Error(`invalid 0..1 number: "${input}"`);
  return v;
}
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function renderModeFromWire(value: number): RenderMode | undefined {
  switch (value) {
    case 0: return "auto";
    case 1: return "jpeg";
    case 2: return "png";
    case 3: return "raw565";
    case 4: return "raw565_rle";
    default: return undefined;
  }
}

export function renderModeToWire(mode: RenderMode): number {
  switch (mode) {
    case "auto": return 0;
    case "jpeg": return 1;
    case "png": return 2;
    case "raw565": return 3;
    case "raw565_rle": return 4;
  }
}

export function parseRenderMode(input?: string | null): RenderMode | undefined {
  if (!input) return undefined;
  const normalized = input.trim().toLowerCase();
  if (
    normalized === "auto" ||
    normalized === "jpeg" ||
    normalized === "png" ||
    normalized === "raw565" ||
    normalized === "raw565_rle"
  )
    return normalized;
  throw new Error(`invalid render mode: "${input}"`);
}

function readEnvFallbacks(): Partial<DeviceConfig> {
  const val = (name: string) => env.get(name).asString() ?? undefined;

  const out: Partial<DeviceConfig> = {};
  const TS = val("TILE_SIZE");
  const FFTC = val("FULL_FRAME_TILE_COUNT");
  const FFAT = val("FULL_FRAME_AREA_THRESHOLD");
  const FFE = val("FULL_FRAME_EVERY");
  const ENF = val("EVERY_NTH_FRAME");
  const MFI = val("MIN_FRAME_INTERVAL_MS");
  const Q = val("JPEG_QUALITY");
  const MBPM = val("MAX_BYTES_PER_MESSAGE");
  const RM = val("RENDER_MODE");

  if (TS) out.tileSize = intPos(TS)!;
  if (FFTC) out.fullFrameTileCount = intPos(FFTC)!;
  if (FFAT != null) out.fullFrameAreaThreshold = float01(FFAT)!;
  if (FFE) out.fullFrameEvery = intPos(FFE)!;
  if (ENF) out.everyNthFrame = intPos(ENF)!;
  if (MFI != null) out.minFrameInterval = intNonNeg(MFI)!;
  if (Q) out.jpegQuality = clamp(intPos(Q)!, 1, 100);
  if (MBPM) out.maxBytesPerMessage = intPos(MBPM)!;
  if (RM) out.renderMode = parseRenderMode(RM)!;

  return out;
}

export function makeConfigFromParams(params: URLSearchParams): DeviceConfig {
  const envFallbacks = readEnvFallbacks();

  // required
  let height = intPos(params.get("h")) ?? envFallbacks.height;
  let width = intPos(params.get("w")) ?? envFallbacks.width;
  if (!height || !width) throw new Error(`missing required params "h" and/or "w"`);

  // optional
  const tileSize = intPos(params.get("ts")) ?? envFallbacks.tileSize ?? DEFAULTS.tileSize;
  const fullFrameTileCount = intPos(params.get("fftc")) ?? envFallbacks.fullFrameTileCount ?? DEFAULTS.fullFrameTileCount;
  const fullFrameAreaThreshold = float01(params.get("ffat")) ?? envFallbacks.fullFrameAreaThreshold ?? DEFAULTS.fullFrameAreaThreshold;
  const fullFrameEvery = intPos(params.get("ffe")) ?? envFallbacks.fullFrameEvery ?? DEFAULTS.fullFrameEvery;
  const minFrameInterval = intNonNeg(params.get("mfi")) ?? envFallbacks.minFrameInterval ?? DEFAULTS.minFrameInterval;
  const everyNthFrame = intPos(params.get("enf")) ?? envFallbacks.everyNthFrame ?? DEFAULTS.everyNthFrame;
  const jpegQuality = clamp(intPos(params.get("q")) ?? envFallbacks.jpegQuality ?? DEFAULTS.jpegQuality, 1, 100);
  const maxBytesPerMessage = intPos(params.get("mbpm")) ?? envFallbacks.maxBytesPerMessage ?? DEFAULTS.maxBytesPerMessage;
  const rotation = intNonNeg(params.get("r")) as 0 | 90 | 180 | 270 | undefined
    ?? DEFAULTS.rotation;
  const renderMode = parseRenderMode(params.get("rm")) ?? envFallbacks.renderMode ?? DEFAULTS.renderMode;

  const dimensions = getRotatedDimensions(width, height, rotation);

  return {
    height: dimensions.height,
    width: dimensions.width,
    tileSize,
    fullFrameTileCount,
    fullFrameAreaThreshold,
    fullFrameEvery,
    minFrameInterval,
    everyNthFrame,
    jpegQuality,
    maxBytesPerMessage,
    rotation,
    renderMode,
  };
}

export function deviceConfigsEqual(
  a: DeviceConfig,
  b: DeviceConfig,
  eps = 1e-6
): boolean {
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.tileSize === b.tileSize &&
    a.fullFrameTileCount === b.fullFrameTileCount &&
    Math.abs(a.fullFrameAreaThreshold - b.fullFrameAreaThreshold) <= eps &&
    a.fullFrameEvery === b.fullFrameEvery &&
    a.everyNthFrame === b.everyNthFrame &&
    a.minFrameInterval === b.minFrameInterval &&
    a.jpegQuality === b.jpegQuality &&
    a.maxBytesPerMessage === b.maxBytesPerMessage &&
    a.rotation === b.rotation &&
    a.renderMode === b.renderMode
  );
}

export function logDeviceConfig(id: string, cfg: DeviceConfig): void {
  const entries: [string, string | number][] = [
    ["width", cfg.width],
    ["height", cfg.height],
    ["tileSize", cfg.tileSize],
    ["fullFrameTileCount", cfg.fullFrameTileCount],
    ["fullFrameAreaThreshold", cfg.fullFrameAreaThreshold.toFixed(3)],
    ["fullFrameEvery", cfg.fullFrameEvery],
    ["everyNthFrame", cfg.everyNthFrame],
    ["minFrameInterval", cfg.minFrameInterval],
    ["jpegQuality", cfg.jpegQuality],
    ["maxBytesPerMessage", cfg.maxBytesPerMessage],
    ["rotation", cfg.rotation],
    ["renderMode", cfg.renderMode],
  ];

  const head = `[client_connect] id=${id}`;
  const body = entries.map(([k, v]) => `  ${k}=${v}`).join('\n');

  console.info(`${head}\n${body}`);
}
