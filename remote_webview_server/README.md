# Remote WebView Server Add-on

Home Assistant add-on for Remote WebView Server. This add-on builds the server from the source code in this repository instead of using the upstream `strangev/remote-webview-server` Docker image.

## Installation

1. In Home Assistant, open **Settings -> Add-ons -> Add-on Store**.
2. Add this repository as a custom add-on repository:

   ```text
   https://github.com/kamilzierke/ESPHome_random_chest_of_randomness
   ```

3. Install **Remote WebView Server**.
4. Start the add-on.

The ESPHome client should use the Home Assistant host IP and the configured WebSocket port:

```yaml
remote_webview:
  server: 192.168.1.100:8081
```

## Home Assistant Login

The server runs headless Chromium. To log into Home Assistant once and persist the session:

1. Set:

   ```yaml
   expose_debug_proxy: true
   debug_proxy_port: 9222
   user_data_dir: "/pw-data"
   ```

2. Restart the add-on.
3. Open Chrome on a desktop machine.
4. Go to `chrome://inspect/#devices`.
5. Click **Configure...** and add `<HA_IP>:9222`.
6. Click **inspect** for the remote Chromium tab and log into Home Assistant.
7. Disable `expose_debug_proxy` after login.

Use `http://127.0.0.1:8123/...` in the ESPHome `url` when the add-on runs on the same Home Assistant host.

## Parameters

Add-on options are defaults. Values sent by an ESPHome client in its WebSocket query string take priority for that specific device.

- `tile_size` - change detection tile size in pixels.
- `full_frame_tile_count` - number of chunks used for full-frame refresh.
- `full_frame_area_threshold` - changed screen fraction above which the server sends a full frame.
- `full_frame_every` - force a full-frame refresh every N processed frames.
- `every_nth_frame` - Chromium screencast frame sampling.
- `min_frame_interval_ms` - minimum processing interval between frames.
- `jpeg_quality` - JPEG quality used for encoded tiles.
- `max_bytes_per_message` - maximum WebSocket message size.
- `ws_port` - WebSocket stream port used by ESPHome clients.
- `debug_port` - internal Chromium DevTools port.
- `expose_debug_proxy` - expose DevTools through `debug_proxy_port` using `socat`.
- `health_port` - HTTP health endpoint used by the add-on watchdog.
- `prefers_reduced_motion` - asks Chromium and pages to reduce animation where supported.
- `user_data_dir` - persistent Chromium profile directory.
- `browser_locale` - Chromium locale.

## Logs

On client connection the server logs the effective negotiated configuration:

```text
[client_connect] id=esp32-...
  width=480
  height=480
  tileSize=48
  jpegQuality=70
  maxBytesPerMessage=61440
```

Use this log to confirm whether a value came from the ESPHome client or from add-on defaults.
