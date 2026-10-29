import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { DeviceBroadcaster } from "./broadcaster.js";
import { Encoding } from "./protocol.js";

class Socket extends EventEmitter {
  readyState = WebSocket.OPEN;
  bufferedAmount = 0;
  sent: Buffer[] = [];
  done: Array<(error?: Error) => void> = [];
  close = vi.fn();
  terminate = vi.fn();
  send(packet: Buffer, _options: unknown, callback: (error?: Error) => void) {
    this.sent.push(packet);
    this.done.push(callback);
  }
  get ws() { return this as unknown as WebSocket; }
}
const frame = { rects: [{ x: 0, y: 0, w: 1, h: 1, data: Buffer.from([1, 2]) }], encoding: Encoding.RAW565, isFullFrame: false };
afterEach(() => vi.useRealTimers());

describe("bounded WebSocket delivery", () => {
  it("keeps encoded deltas in order and waits for completion", async () => {
    const b = new DeviceBroadcaster();
    const s = new Socket();
    b.addClient("device", s.ws);
    b.sendFrameChunked("device", frame, 1);
    b.sendFrameChunked("device", frame, 2);
    b.sendFrameChunked("device", frame, 3);
    expect(s.sent).toHaveLength(1);
    s.done.shift()!(); await Promise.resolve(); await Promise.resolve();
    s.done.shift()!(); await Promise.resolve(); await Promise.resolve();
    s.done.shift()!(); await Promise.resolve();
    expect(s.sent.map(p => p.readUInt32LE(2))).toEqual([1, 2, 3]);
  });

  it("disconnects on backpressure and async errors to force a new keyframe", async () => {
    const b = new DeviceBroadcaster(100);
    const s = new Socket();
    b.addClient("device", s.ws);
    s.bufferedAmount = 100;
    b.sendFrameChunked("device", frame, 1);
    expect(s.terminate).toHaveBeenCalledOnce();
    expect(b.getClientCount("device")).toBe(0);
    const s2 = new Socket();
    b.addClient("device", s2.ws);
    b.sendFrameChunked("device", frame, 2);
    s2.done.shift()!(new Error("write failed"));
    await Promise.resolve(); await Promise.resolve();
    expect(s2.terminate).toHaveBeenCalledOnce();
  });

  it("an old socket close cannot remove its replacement", () => {
    const b = new DeviceBroadcaster();
    const old = new Socket(); const next = new Socket();
    b.addClient("device", old.ws);
    b.addClient("device", next.ws);
    old.emit("close");
    expect(b.getClientCount("device")).toBe(1);
  });

  it("bounds stalled send time", async () => {
    vi.useFakeTimers();
    const b = new DeviceBroadcaster(); const s = new Socket();
    b.addClient("device", s.ws);
    b.sendFrameChunked("device", frame, 1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.terminate).toHaveBeenCalledOnce();
  });
});
