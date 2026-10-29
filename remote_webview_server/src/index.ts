import http from "http";
import { WebSocket, WebSocketServer } from "ws";
import env from "env-var";
import { makeConfigFromParams, setConfigFor, logDeviceConfig } from "./config.js";
import { broadcaster, ensureDeviceAsync, cleanupIdleAsync } from "./deviceManager.js";
import { InputRouter } from "./inputRouter.js";
import { bootstrapAsync } from "./browser.js";
import { MsgType } from "./protocol.js";

const WS_PORT = env.get("WS_PORT").default("8081").asIntPositive();
const HEALTH_PORT = env.get("HEALTH_PORT").default("18080").asIntPositive();

const wss = new WebSocketServer({ port: WS_PORT, perMessageDeflate: false, maxPayload: 16 * 1024 });
const inputRouter = new InputRouter();

await bootstrapAsync();

wss.on("connection", (ws, req) => {
  ws.on("error", error => console.warn(`[server] client transport error: ${error.message}`));
  try {
    const url = new URL(req.url || "", `ws://localhost:${WS_PORT}`);
    const id = url.searchParams.get("id") || "default";

    const cfg = makeConfigFromParams(url.searchParams);
    setConfigFor(id, cfg);
    logDeviceConfig(id, cfg);

    broadcaster.addClient(id, ws);
    const ready = ensureDeviceAsync(id, cfg).catch(error => {
      console.warn(`[server] device initialization failed: ${(error as Error).message}`);
      ws.terminate();
      return null;
    });
    let inputs = Promise.resolve();
    let pendingInputs = 0;

    ws.on("message", (msg, isBinary) => {
      if (!isBinary) return;

      const buf: Buffer = Buffer.isBuffer(msg) ? msg : Buffer.from(msg as ArrayBuffer);
      if (buf.length === 0) return;

      if (++pendingInputs > 64) { ws.terminate(); return; }
      inputs = inputs.then(async () => {
      try {
      const dev = await ready;
      if (!dev || ws.readyState !== WebSocket.OPEN) return;
      dev.lastActive = Date.now();
      switch (buf.readUInt8(0)) {
        case MsgType.Touch:
          await inputRouter.handleTouchPacketAsync(dev, buf);
          break;
        case MsgType.Keepalive:
          dev.lastActive = Date.now();
          break;
        case MsgType.FrameStats:
          await inputRouter.handleFrameStatsPacketAsync(dev, buf);
          break;
        case MsgType.OpenURL:
          await inputRouter.handleOpenURLPacketAsync(dev, buf);
          break;
        case MsgType.ClientControl:
          inputRouter.handleClientControlPacket(dev, buf);
          break;
        case MsgType.ClientConfig:
          inputRouter.handleClientConfigPacket(dev, buf);
          break;
        default:
          break;
      }
      } finally { pendingInputs--; }
      }).catch(error => console.warn(`[server] client input failed: ${(error as Error).message}`));
    });

    ws.on("close", () => {
      void ready.then(dev => { if (dev) dev.lastActive = Date.now(); });
      broadcaster.removeClient(id, ws);
    });
  } catch (error) {
    console.warn(`[server] invalid client setup: ${(error as Error).message}`);
    ws.close(1008, "Invalid device configuration");
  }
});

http.createServer(async (_req, res) => {
  try {
    res.writeHead(200);
    res.end("ok");
  } catch (_e) {
    res.writeHead(500);
    res.end("err");
  }
}).listen(HEALTH_PORT);

setInterval(() => cleanupIdleAsync(), 60_000);

console.log(`[server] WebSocket listening on :${WS_PORT}`);
