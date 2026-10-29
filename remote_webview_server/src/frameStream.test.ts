import { afterEach, describe, expect, it, vi } from "vitest";
import { LatestFrameStream } from "./frameStream.js";

afterEach(() => vi.useRealTimers());

describe("device frame scheduling", () => {
  it("replays an unchanged screen for keyframe and resume", async () => {
    vi.useFakeTimers();
    const process = vi.fn(async () => {});
    const stream = new LatestFrameStream(process, () => 0, vi.fn());
    stream.submit("static screen");
    await vi.runAllTimersAsync();
    stream.requestFullFrame();
    await vi.runAllTimersAsync();
    stream.setPaused(true);
    stream.setPaused(false);
    await vi.runAllTimersAsync();
    expect(process.mock.calls).toHaveLength(3);
    expect(process.mock.calls.every((call: any[]) => call[0] === "static screen" && call[1] === true)).toBe(true);
    stream.stop();
  });

  it("serializes awaits and coalesces only unencoded frames", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const sent: string[] = [];
    const process = vi.fn(async (b64: string) => {
      sent.push(b64);
      if (b64 === "first") await new Promise<void>(resolve => { release = resolve; });
    });
    const stream = new LatestFrameStream(process, () => 0, vi.fn());
    stream.submit("first");
    await vi.advanceTimersByTimeAsync(0);
    stream.submit("stale");
    stream.submit("latest");
    await vi.advanceTimersByTimeAsync(100);
    expect(sent).toEqual(["first"]);
    release();
    await vi.runAllTimersAsync();
    expect(sent).toEqual(["first", "latest"]);
    stream.stop();
  });

  it("invalidates in-flight work on pause, keyframe, URL change and stop", async () => {
    vi.useFakeTimers();
    let current!: () => boolean;
    let release!: () => void;
    const stream = new LatestFrameStream(async (_b64, _force, valid) => {
      current = valid;
      await new Promise<void>(resolve => { release = resolve; });
    }, () => 0, vi.fn());
    stream.submit("old page");
    await vi.advanceTimersByTimeAsync(0);
    expect(current()).toBe(true);
    stream.invalidate();
    expect(current()).toBe(false);
    release();
    await vi.runAllTimersAsync();
    stream.stop();
  });

  it("forces a full frame after an encode failure without retrying forever", async () => {
    vi.useFakeTimers();
    const error = vi.fn();
    const process = vi.fn().mockRejectedValueOnce(new Error("bad PNG")).mockResolvedValue(undefined);
    const stream = new LatestFrameStream(process, () => 0, error);
    stream.submit("corrupt");
    await vi.runAllTimersAsync();
    expect(error).toHaveBeenCalledOnce();
    stream.submit("valid");
    await vi.runAllTimersAsync();
    expect(process.mock.calls[1][1]).toBe(true);
    stream.stop();
  });
});
