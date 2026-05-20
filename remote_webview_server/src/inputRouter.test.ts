import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InputRouter } from "./inputRouter.js";
import {
  ClientControlCmd,
  MsgType,
  OPENURL_HEADER_BYTES,
  PROTOCOL_VERSION,
  TouchKind,
  buildTouchPacket,
} from "./protocol.js";

function buildOpenURLPacket(url: string): Buffer {
  const body = Buffer.from(url, "utf8");
  const buf = Buffer.alloc(OPENURL_HEADER_BYTES + body.length);
  buf.writeUInt8(MsgType.OpenURL, 0);
  buf.writeUInt8(PROTOCOL_VERSION, 1);
  buf.writeUInt16LE(0, 2);
  buf.writeUInt32LE(body.length, 4);
  body.copy(buf, OPENURL_HEADER_BYTES);
  return buf;
}

function makeDevice(send = vi.fn()) {
  return {
    deviceId: "esp32-test",
    cfg: {
      width: 480,
      height: 480,
      rotation: 0,
    },
    cdp: { send },
    processor: { requestFullFrame: vi.fn() },
    selfTestRunner: { stop: vi.fn(), startAsync: vi.fn() },
    url: "",
    lastActive: 0,
    pendingB64: undefined,
    debugOverlayEnabled: false,
  } as any;
}

function buildClientControlPacket(cmd: ClientControlCmd, value: number): Buffer {
  return Buffer.from([
    MsgType.ClientControl,
    PROTOCOL_VERSION,
    cmd,
    value & 0xff,
  ]);
}

describe("InputRouter", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("ignores touch move and up packets until a touch down starts the sequence", async () => {
    const send = vi.fn();
    const dev = makeDevice(send);
    const router = new InputRouter(0);

    await router.handleTouchPacketAsync(dev, buildTouchPacket(TouchKind.Move, 10, 20));
    await router.handleTouchPacketAsync(dev, buildTouchPacket(TouchKind.Up, 10, 20));

    expect(send).not.toHaveBeenCalled();

    await router.handleTouchPacketAsync(dev, buildTouchPacket(TouchKind.Down, 10, 20));
    await router.handleTouchPacketAsync(dev, buildTouchPacket(TouchKind.Move, 11, 21));
    await router.handleTouchPacketAsync(dev, buildTouchPacket(TouchKind.Up, 11, 21));

    expect(send).toHaveBeenNthCalledWith(1, "Input.dispatchTouchEvent", expect.objectContaining({ type: "touchStart" }));
    expect(send).toHaveBeenNthCalledWith(2, "Input.dispatchTouchEvent", expect.objectContaining({ type: "touchMove" }));
    expect(send).toHaveBeenNthCalledWith(3, "Input.dispatchTouchEvent", expect.objectContaining({ type: "touchEnd" }));
  });

  it("logs CDP navigation failures with the requested URL", async () => {
    const send = vi.fn(async (method: string) => {
      if (method === "Page.navigate") return { errorText: "net::ERR_NAME_NOT_RESOLVED" };
      return {};
    });
    const dev = makeDevice(send);
    const router = new InputRouter(0);

    await router.handleOpenURLPacketAsync(dev, buildOpenURLPacket("http://does-not-resolve.local/"));

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("net::ERR_NAME_NOT_RESOLVED")
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("http://does-not-resolve.local/")
    );
    expect(dev.processor.requestFullFrame).toHaveBeenCalledTimes(1);
  });

  it("applies debug overlay ClientControl state to the device session", () => {
    const dev = makeDevice();
    const router = new InputRouter(0);

    router.handleClientControlPacket(dev, buildClientControlPacket(ClientControlCmd.SetDebugOverlay, 1));

    expect(dev.debugOverlayEnabled).toBe(true);
    expect(dev.processor.requestFullFrame).toHaveBeenCalledTimes(1);

    router.handleClientControlPacket(dev, buildClientControlPacket(ClientControlCmd.SetDebugOverlay, 0));

    expect(dev.debugOverlayEnabled).toBe(false);
    expect(dev.processor.requestFullFrame).toHaveBeenCalledTimes(2);
  });
});
