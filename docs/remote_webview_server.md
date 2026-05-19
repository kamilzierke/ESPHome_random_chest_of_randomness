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
  config.yaml
  Dockerfile
  run.sh
  package.json
  package-lock.json
  tsconfig.json
  src/
  self-test/
```

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
- `max_bytes_per_message`

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
```

If these values match add-on defaults instead of ESPHome YAML, the ESPHome firmware is probably using a cached or old external component build.
