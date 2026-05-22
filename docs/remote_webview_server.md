# Remote WebView Server

The Home Assistant add-on lives in `remote_webview_server`. It builds the bundled TypeScript/Node/Playwright server from this repository.

## Home Assistant Add-on Structure

Home Assistant add-on store expects:

- `repository.yaml` at repository root.
- one add-on directory directly under repository root.
- `config.yaml`, `Dockerfile`, and runtime files inside the add-on directory.

This repository uses:

```text
repository.yaml
remote_webview_server/
  CHANGELOG.md
  config.yaml
  Dockerfile
  run.sh
  package.json
  package-lock.json
  tsconfig.json
  src/
  self-test/
```

## Release Notes

Home Assistant shows add-on/app release notes from `remote_webview_server/CHANGELOG.md`. Every server version bump must update all of these files in the same change:

- `remote_webview_server/config.yaml`
- `remote_webview_server/package.json`
- `remote_webview_server/package-lock.json`
- `remote_webview_server/CHANGELOG.md`

Add the newest changelog entry at the top and keep it focused on user-visible changes, configuration changes and migration notes.

## Add-on Options

The add-on options are default server values. ESPHome clients can override stream parameters per device by sending query parameters in the WebSocket connection.

Important options:

- `ws_port` - WebSocket port, default `8081`.
- `health_port` - health endpoint for Home Assistant watchdog, default `18080`.
- `debug_port` - internal Chromium CDP port, default `9221`.
- `expose_debug_proxy` - when true, exposes Chromium DevTools on `debug_proxy_port`.
- `debug_proxy_port` - external DevTools port, default `9222`.
- `user_data_dir` - persistent Chromium profile path. Keep `/pw-data` for persisted login.
- `prefers_reduced_motion` - reduces page animations where supported.
- `browser_locale` - Chromium locale.

Stream defaults:

- `tile_size`
- `full_frame_tile_count`
- `full_frame_area_threshold`
- `full_frame_every`
- `every_nth_frame`
- `min_frame_interval_ms`
- `jpeg_quality`
- `render_mode`
- `max_bytes_per_message`

`render_mode` in the add-on UI exposes `auto`, `jpeg`, `png`, and `raw565`. `jpeg` is the production default. `png` is implemented for testing and runtime tuning. `raw565` is an experimental direct RGB565 path intended for latency tests. `auto` currently behaves as a JPEG alias until the auto heuristic exists. Older clients may still request `raw565_rle`; the server accepts that value but sends JPEG frames until the ESPHome client draw path is implemented.

## Login Flow

1. Enable:

   ```yaml
   expose_debug_proxy: true
   debug_proxy_port: 9222
   user_data_dir: "/pw-data"
   ```

2. Restart the add-on.
3. Open Chrome: `chrome://inspect/#devices`.
4. Configure `<HA_IP>:9222`.
5. Click `inspect` and log into Home Assistant.
6. Disable `expose_debug_proxy`.

## Verifying Client Negotiation

The server logs effective per-device config:

```text
[client_connect] id=esp32-...
  tileSize=48
  minFrameInterval=80
  jpegQuality=70
  renderMode=jpeg
```

If these values match add-on defaults instead of ESPHome YAML, the ESPHome firmware is probably using a cached or old external component build.

## Client Diagnostics

The server remains the source of effective render settings, but ESPHome can expose client-side diagnostics as native Home Assistant entities under the `remote_webview:` component. These are configured in the ESPHome YAML with `sensors:` and `binary_sensors:`; they do not require any add-on option.

Use them to correlate server logs with client behavior:

- `connected` should match server connect/disconnect logs.
- `frames_received`, `tiles_received`, and `fps` show whether the ESP is receiving new frame data.
- `decode_avg_ms`, `last_decode_ms`, and `queue_depth` show whether the ESP decode side is the bottleneck.
- `decode_drops` indicates local queue pressure or an overloaded client.
- `unsupported_encoding_drops` should stay at `0`. If it increments, the server sent an encoding the current ESPHome client cannot decode.

## Client Controls

ESPHome can also expose native Home Assistant controls with the `controls:` block. The current server protocol supports these runtime commands:

- `PauseStream` - used by `pause_switch` when `stream_control_enabled: true`.
- `RequestKeyframe` - used by `request_keyframe_button` when `stream_control_enabled: true`.
- `SetDebugOverlay` - used by `debug_overlay_switch` when `stream_control_enabled: true`. The server stores the state, requests a keyframe, and draws diagnostic borders on transmitted rects before encoding. Full-frame rects are blue; partial rects are amber.

Runtime tuning uses `ClientConfig` packets:

- `RenderMode` - updates the requested render mode and requests a keyframe. `jpeg` is the production path. `png` is implemented end-to-end for testing. `raw565` is implemented end-to-end as an experimental direct RGB565 path. `auto` currently maps to JPEG. `raw565_rle` is accepted for protocol compatibility but encoded as JPEG until upcoming format work adds the client draw path.
- `JpegQuality` - updates the active JPEG quality for the next encoded frames.
- `MinFrameInterval` - updates the per-device frame throttle without reconnecting.
- `TileSize` - updates the server tile grid and requests a keyframe.

The `reconnect_button` and `touch_switch` are local ESP client controls.
