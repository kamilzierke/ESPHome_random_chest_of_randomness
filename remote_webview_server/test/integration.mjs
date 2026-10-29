import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.dirname(SERVER);
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(ROOT, ".cache/playwright");
const { chromium } = await import("playwright-core");

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function until(check, label, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(20);
  }
  throw new Error(`Timed out: ${label}`);
}

function openURL(url) {
  const body = Buffer.from(url);
  const packet = Buffer.alloc(8 + body.length);
  packet[0] = 4; packet[1] = 1;
  packet.writeUInt32LE(body.length, 4); body.copy(packet, 8);
  return packet;
}

async function connect(port, render = "raw565") {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/?id=isolated-test&w=16&h=16&rm=${render}&ts=8&fftc=1&mfi=20&mbpm=1024`);
  const frames = [];
  ws.on("error", () => {});
  ws.on("message", data => { if (data[0] === 1) frames.push(Buffer.from(data)); });
  await once(ws, "open");
  return { ws, frames };
}

function lastFull(frames) { return frames.findLast(packet => (packet.readUInt16LE(9) & 3) === 3); }

test("isolated Chromium/WebSocket: static keyframe, pause/resume, touch, malformed input, reconnect and restart", { timeout: 90_000 }, async () => {
  const work = await fs.mkdtemp(path.join(ROOT, ".audit/server-integration-"));
  const pageServer = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(`<style>body{margin:0;width:100vw;height:100vh;background:blue;touch-action:none}</style><script>document.addEventListener('touchstart',()=>{document.body.style.background='lime'})</script>`);
  });
  await new Promise(resolve => pageServer.listen(0, "127.0.0.1", resolve));
  const pageURL = `http://127.0.0.1:${pageServer.address().port}/`;
  const wsPort = await freePort(), healthPort = await freePort(), debugPort = await freePort();
  let child, client, browser, output = "";

  async function start() {
    child = spawn(process.execPath, ["dist/index.js"], { cwd: SERVER, windowsHide: true,
      env: { ...process.env, WS_PORT: String(wsPort), HEALTH_PORT: String(healthPort), DEBUG_PORT: String(debugPort), USER_DATA_DIR: path.join(work, "browser-profile") } });
    output = "";
    child.stdout.on("data", data => { output += String(data); });
    child.stderr.on("data", data => { output += String(data); });
    await until(async () => {
      if (child.exitCode !== null) throw new Error(`Server exited: ${output}`);
      try { return (await fetch(`http://127.0.0.1:${healthPort}/`)).ok; } catch { return false; }
    }, "server health");
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  }

  async function stop() {
    if (client) { client.ws.terminate(); client = undefined; }
    if (browser) {
      try { const session = await browser.newBrowserCDPSession(); await session.send("Browser.close"); } catch {}
      await browser.close().catch(() => {}); browser = undefined;
    }
    if (child && child.exitCode === null) {
      const exit = once(child, "exit"); child.kill(); await exit;
    }
  }

  try {
    await start();
    client = await connect(wsPort);
    // Sent immediately after WebSocket open, while asynchronous CDP setup may
    // still be in progress. The URL command must not be lost.
    client.ws.send(openURL(pageURL));
    await until(() => client.frames.some(p => p[6] === 3 && p.readUInt16LE(23) === 0x001f), "initial blue image");
    client.frames.length = 0;
    client.ws.send(Buffer.from([6, 1, 2, 1]));
    const keyframe = await until(() => lastFull(client.frames), "keyframe on static page");
    assert.equal(keyframe[6], 3);
    assert.equal(keyframe.readUInt16LE(23), 0x001f);
    assert.ok(keyframe.length <= 1024);

    client.ws.send(Buffer.from([6, 1, 1, 1]));
    await until(() => output.includes("stream paused"), "pause processed");
    await delay(50); client.frames.length = 0;
    client.ws.send(Buffer.from([6, 1, 2, 1]));
    await delay(100);
    assert.equal(client.frames.length, 0, "paused stream sent an image");
    client.ws.send(Buffer.from([6, 1, 1, 0]));
    await until(() => lastFull(client.frames), "resume on unchanged page");

    client.frames.length = 0;
    const touch = Buffer.from([2, 1, 1, 0, 4, 0, 4, 0]);
    client.ws.send(touch.subarray(0, 4), { fin: false });
    client.ws.send(touch.subarray(4), { fin: true });
    client.ws.send(Buffer.from([2, 1, 3, 0, 4, 0, 4, 0]));
    await until(() => client.frames.some(p => p[6] === 3 && p.readUInt16LE(23) === 0x07e0), "touch changed blue to green");

    client.frames.length = 0;
    client.ws.send(Buffer.from([4, 1, 0])); // incomplete OpenURL
    client.ws.send(Buffer.from([6, 99, 1, 1])); // unsupported version
    client.ws.send(Buffer.from([6, 1, 2, 1]));
    await until(() => lastFull(client.frames), "valid input after malformed packets");
    client.ws.terminate();
    client = await connect(wsPort, "jpeg");
    client.ws.send(openURL(pageURL));
    await until(() => client.frames.some(p => p[6] === 2), "JPEG client reconnect");

    await stop();
    await start();
    client = await connect(wsPort);
    client.ws.send(openURL(pageURL));
    await until(() => lastFull(client.frames), "full frame after server restart");
    await fs.writeFile(path.join(work, "result.json"), JSON.stringify({ status: "passed", productionAccess: false, scenarios: ["startup URL", "static keyframe", "pause/resume", "fragmented touch", "malformed input", "JPEG reconnect", "server restart"] }, null, 2));
    console.log(`Evidence: ${work}`);
  } finally {
    await fs.writeFile(path.join(work, "server.log"), output);
    await stop();
    await new Promise(resolve => pageServer.close(resolve));
  }
});
