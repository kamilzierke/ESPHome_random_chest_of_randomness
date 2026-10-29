import { WebSocket } from "ws";
import { buildFrameStatsPacket, buildFramePackets } from "./protocol.js";
import type { FrameOut } from "./frameProcessor.js";

type OutFrame = { frameId: number; packets: Buffer[] };
type BroadcasterState = { queue: OutFrame[]; sending: boolean; epoch: number };

export class DeviceBroadcaster {
  private _clients = new Map<string, Set<WebSocket>>();
  private _state = new Map<string, BroadcasterState>();
  constructor(private readonly maxBufferedBytes = 2 * 1024 * 1024) {}

  addClient(id: string, ws: WebSocket): void {
    const old = this._clients.get(id);
    if (old && old.size) {
      for (const sock of old) {
        try { sock.close(); } catch {}
      }
      old.clear();
    }

    // A replacement socket owns a fresh queue. An old drain must not send the
    // remainder of its partial frame to the new connection.
    this._clients.set(id, new Set([ws]));
    this._state.set(id, { queue: [], sending: false, epoch: 0 });

    console.log(`[broadcaster] Client connected to device ${id}, total clients: ${this._clients.get(id)?.size}`);
    ws.once("close", () => this.removeClient(id, ws));
    ws.once("error", () => this.removeClient(id, ws));
  }

  removeClient(id: string, ws: WebSocket): void {
    if (!this._clients.get(id)?.has(ws)) return;
    this._clients.get(id)?.delete(ws);
    if ((this._clients.get(id)?.size ?? 0) === 0) {
      this._clients.delete(id);
      this._state.delete(id);
    }
    console.log(`[broadcaster] Client disconnected from device ${id}, total clients: ${this._clients.get(id)?.size ?? 0}`);
  }

  getClientCount(id: string): number {
    return this._clients.get(id)?.size ?? 0;
  }

  clearQueue(id: string): void {
    const st = this._state.get(id);
    if (!st) return;
    st.queue.length = 0;
    st.epoch++;
  }

  public sendFrameChunked(id: string, data: FrameOut, frameId: number, maxBytes = 12_000): void {
    const peers = this._clients.get(id);
    if (!peers || peers.size === 0 || data.rects.length === 0) return;

    const packets = buildFramePackets(data.rects, data.encoding, frameId, data.isFullFrame, maxBytes);

    const st = this._ensureState(id);
    const frame: OutFrame = { frameId, packets };

    const queuedBytes = st.queue.reduce((sum, f) => sum + f.packets.reduce((n, p) => n + p.length, 0), 0);
    const frameBytes = packets.reduce((sum, p) => sum + p.length, 0);
    if (st.queue.length >= 2 || queuedBytes + frameBytes > this.maxBufferedBytes) {
      // Deltas depend on previous encoded frames. Recover through a fresh
      // connection/keyframe rather than silently deleting an arbitrary delta.
      for (const ws of new Set(peers)) this._dropClient(id, ws);
      return;
    }
    st.queue.push(frame);

    this._drainAsync(id).catch(() => {});
  }

  public startSelfTestMeasurement(id: string): void {
    const peers = this._clients.get(id);
    if (!peers || peers.size === 0) return;

    const packet = buildFrameStatsPacket();
    const st = this._ensureState(id);
    st.queue.push({ frameId: 42, packets: [packet] });
    this._drainAsync(id).catch(() => {});
  }

  private _ensureState(id: string): BroadcasterState {
    let st = this._state.get(id);
    if (!st) {
      st = { queue: [], sending: false, epoch: 0 };
      this._state.set(id, st);
    }
    return st;
  }

  private async _drainAsync(id: string): Promise<void> {
    const st = this._ensureState(id);
    if (st.sending) return;
    st.sending = true;

    try {
      const peers = this._clients.get(id);
      if (!peers || peers.size === 0) { st.queue.length = 0; return; }

      while (st.queue.length) {
        const f = st.queue.shift()!;
        const epoch = st.epoch;
        for (const pkt of f.packets) {
          if (st.epoch !== epoch || this._state.get(id) !== st) break;
          for (const ws of new Set(peers)) {
            if (ws.readyState !== WebSocket.OPEN) {
              this.removeClient(id, ws);
              continue;
            }
            if (ws.bufferedAmount + pkt.length > this.maxBufferedBytes) {
              this._dropClient(id, ws);
              continue;
            }
            try {
              // Await actual send completion; a microtask yield does not put a
              // bound on the socket's native write queue. Also bound a hung send.
              await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error("WebSocket send timeout")), 10_000);
                try {
                  ws.send(pkt, { binary: true }, (error) => {
                    clearTimeout(timer);
                    if (error) reject(error); else resolve();
                  });
                } catch (error) { clearTimeout(timer); reject(error); }
              });
            } catch {
              this._dropClient(id, ws);
            }
          }
          if (peers.size === 0) { st.queue.length = 0; return; }
        }
      }
    } finally {
      st.sending = false;
    }
  }

  private _dropClient(id: string, ws: WebSocket): void {
    this.removeClient(id, ws);
    try { ws.terminate(); } catch {}
  }
}
