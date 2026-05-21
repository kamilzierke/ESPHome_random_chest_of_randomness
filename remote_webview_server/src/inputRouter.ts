import type { DeviceSession } from "./deviceManager.js";
import { requestDeviceKeyframe, setDeviceDebugOverlay, setDeviceStreamPaused, updateDeviceRuntimeConfig } from "./deviceManager.js";
import { renderModeFromWire } from "./config.js";
import {
  ClientConfigField,
  ClientControlCmd,
  TouchKind,
  parseClientConfigPacket,
  parseClientControlPacket,
  parseFrameStatsPacket,
  parseOpenURLPacket,
  parseTouchPacket,
} from "./protocol.js";
import { mapPointForRotation } from "./util.js";

export class InputRouter {
  private _lastMoveAt = 0;
  private readonly _moveThrottleMs: number;
  private readonly _activeTouches = new Set<string>();

  constructor(moveThrottleMs = 12) {
    this._moveThrottleMs = moveThrottleMs;
  }

  public async handleTouchPacketAsync(dev: DeviceSession, buf: Buffer): Promise<void> {
    const pkt = parseTouchPacket(buf);
    if (!pkt) return;

    const touchKey = `${dev.deviceId}:${pkt.pointerId}`;
    if (pkt.kind === TouchKind.Down || pkt.kind === TouchKind.Tap) {
      this._activeTouches.add(touchKey);
    } else if (!this._activeTouches.has(touchKey)) {
      return;
    }

    if (pkt.kind === TouchKind.Move) {
      const now = Date.now();
      if (now - this._lastMoveAt < this._moveThrottleMs) return;
      this._lastMoveAt = now;
    }

    await this._dispatchTouchAsync(dev, pkt.kind, pkt.x, pkt.y);

    if (pkt.kind === TouchKind.Up || pkt.kind === TouchKind.Tap) {
      this._activeTouches.delete(touchKey);
    }
  }

  public async handleFrameStatsPacketAsync(dev: DeviceSession, buf: Buffer): Promise<void> {
    const value = parseFrameStatsPacket(buf);
    dev.selfTestRunner?.setFrameRenderTimeAsync(value ?? 0, dev.cdp);
  }

  public async handleOpenURLPacketAsync(dev: DeviceSession, buf: Buffer): Promise<void> {
    const pkt = parseOpenURLPacket(buf);
    if (!pkt) return;

    if (pkt.url === "self-test") {
      await dev.selfTestRunner.startAsync(dev.deviceId, dev.cdp);
    } else {
      dev.selfTestRunner.stop();

      if (dev.url !== pkt.url) {
        const result = await dev.cdp.send("Page.navigate", { url: pkt.url });
        dev.url = pkt.url;
        if (result?.errorText) {
          console.warn(`[device] navigation failed for ${dev.deviceId}: ${result.errorText}; url=${pkt.url}`);
        }
        requestDeviceKeyframe(dev);
      }
    }
  }

  public handleClientControlPacket(dev: DeviceSession, buf: Buffer): void {
    const pkt = parseClientControlPacket(buf);
    if (!pkt) return;

    switch (pkt.cmd) {
      case ClientControlCmd.PauseStream:
        setDeviceStreamPaused(dev, pkt.value !== 0);
        break;
      case ClientControlCmd.RequestKeyframe:
        requestDeviceKeyframe(dev);
        break;
      case ClientControlCmd.SetDebugOverlay:
        setDeviceDebugOverlay(dev, pkt.value !== 0);
        break;
      default:
        break;
    }
  }

  public handleClientConfigPacket(dev: DeviceSession, buf: Buffer): void {
    const pkt = parseClientConfigPacket(buf);
    if (!pkt) return;

    switch (pkt.field) {
      case ClientConfigField.RenderMode: {
        const renderMode = renderModeFromWire(pkt.value);
        if (renderMode) updateDeviceRuntimeConfig(dev, { renderMode });
        break;
      }
      case ClientConfigField.JpegQuality:
        updateDeviceRuntimeConfig(dev, { jpegQuality: pkt.value });
        break;
      case ClientConfigField.MinFrameInterval:
        updateDeviceRuntimeConfig(dev, { minFrameInterval: pkt.value });
        break;
      case ClientConfigField.TileSize:
        updateDeviceRuntimeConfig(dev, { tileSize: pkt.value });
        break;
      default:
        break;
    }
  }

  private async _dispatchTouchAsync(dev: DeviceSession, kind: TouchKind, x: number, y: number): Promise<void> {
    try {
      const id = 1; // single-finger id
      const rotated = mapPointForRotation(
        x, y,
        dev.cfg.width, dev.cfg.height,
        dev.cfg.rotation
      );
      const points = [{ x: rotated.x, y: rotated.y, radiusX: 1, radiusY: 1, force: 1, id }];

      switch (kind) {
        case TouchKind.Down:
          await dev.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points });
          break;

        case TouchKind.Move:
          await dev.cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points });
          break;

        case TouchKind.Up:
          await dev.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          break;

        case TouchKind.Tap:
          await dev.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points });
          await dev.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          break;
      }
    } catch (e) {
      console.warn(`Failed to dispatch touch event: ${(e as Error).message}`);
    }
  }
}
