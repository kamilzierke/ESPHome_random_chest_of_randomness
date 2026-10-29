import { EventEmitter } from "node:events";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
const root = vi.hoisted(() => ({ send: vi.fn(), session: vi.fn() }));
vi.mock("./cdpRoot.js", () => ({ getRoot: () => root }));
import { broadcaster, ensureDeviceAsync, requestDeviceKeyframe, setDeviceStreamPaused } from "./deviceManager.js";
import { makeConfigFromParams } from "./config.js";

afterEach(() => vi.restoreAllMocks());

describe("static-screen recovery through the actual device processing path", () => {
  it("bypasses the unchanged-image hash for keyframe and resume", async () => {
    const session = new EventEmitter() as EventEmitter & { send: ReturnType<typeof vi.fn> };
    session.send = vi.fn().mockResolvedValue({});
    root.send.mockImplementation(async (method: string) => method === "Target.createTarget" ? { targetId: "static-test" } : { sessionId: "session-test" });
    root.session.mockReturnValue(session);
    vi.spyOn(broadcaster, "getClientCount").mockReturnValue(1);
    const send = vi.spyOn(broadcaster, "sendFrameChunked").mockImplementation(() => {});
    const dev = await ensureDeviceAsync("static-test", makeConfigFromParams(new URLSearchParams("w=8&h=8&mfi=0&rm=raw565")));
    try {
      const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: "blue" } }).png().toBuffer();
      session.emit("Page.screencastFrame", { sessionId: 1, data: png.toString("base64") });
      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      requestDeviceKeyframe(dev);
      // No further producer event: the request must replay the cached image.
      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
      setDeviceStreamPaused(dev, true);
      setDeviceStreamPaused(dev, false);
      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(3));
      expect(send.mock.calls.every(call => call[1].isFullFrame)).toBe(true);
      expect(send.mock.calls.map(call => call[2])).toEqual([1, 2, 3]);
    } finally { dev.frameStream?.stop(); }
  });
});
