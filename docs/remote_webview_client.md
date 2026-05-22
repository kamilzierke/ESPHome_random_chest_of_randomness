# Remote WebView ESPHome Client

The ESPHome component lives in `components/remote_webview`.

## Installation

```yaml
external_components:
  - source: github://kamilzierke/ESPHome_random_chest_of_randomness@main
    refresh: 0s
    components: [remote_webview]
```

## Example

```yaml
remote_webview:
  id: rwv
  server: 192.168.1.100:8081
  url: http://127.0.0.1:8123/dashboard-tablet01/0
  rotation: 0
  tile_size: 48
  full_frame_tile_count: 4
  full_frame_area_threshold: 0.9
  full_frame_every: 150
  every_nth_frame: 1
  min_frame_interval: 80
  jpeg_quality: 70
  render_mode: jpeg
  max_bytes_per_msg: 61440
  latest_frame_wins: true
  stream_control_enabled: true
  touch_wake_passthrough: true
  telemetry_log_interval_ms: 5000

  sensors:
    decode_avg_ms:
      name: "RWV Decode Avg"
    last_decode_ms:
      name: "RWV Last Decode"
    render_avg_ms:
      name: "RWV Render Avg"
    decode_drops:
      name: "RWV Decode Drops"
    unsupported_encoding_drops:
      name: "RWV Unsupported Encoding Drops"
    reconnect_count:
      name: "RWV Reconnect Count"
    last_frame_id:
      name: "RWV Last Frame ID"
    bytes_received:
      name: "RWV Bytes Received"
    frames_received:
      name: "RWV Frames Received"
    tiles_received:
      name: "RWV Tiles Received"
    fps:
      name: "RWV FPS"
    queue_depth:
      name: "RWV Queue Depth"

  binary_sensors:
    connected:
      name: "RWV Connected"
    stream_paused:
      name: "RWV Stream Paused"
    touch_enabled:
      name: "RWV Touch Enabled"

  controls:
    pause_switch:
      name: "RWV Pause Stream"
    touch_switch:
      name: "RWV Touch Enabled"
    request_keyframe_button:
      name: "RWV Request Keyframe"
    reconnect_button:
      name: "RWV Reconnect"
    debug_overlay_switch:
      name: "RWV Debug Overlay"
    render_mode_select:
      name: "RWV Render Mode"
      options: [jpeg, png, raw565]
    jpeg_quality_number:
      name: "RWV JPEG Quality"
      min_value: 20
      max_value: 95
      step: 5
    min_frame_interval_number:
      name: "RWV Min Frame Interval"
      min_value: 0
      max_value: 1000
      step: 10
    tile_size_number:
      name: "RWV Tile Size"
      min_value: 16
      max_value: 256
      step: 16
```

## Client and Server Parameter Contract

Most render parameters are configured in ESPHome but are consumed by the server. The client sends them in the WebSocket URL:

```text
ws://server:8081/?id=...&w=480&h=480&r=0&ts=48&fftc=4&ffat=0.9&ffe=150&enf=1&mfi=80&q=70&rm=jpeg&mbpm=61440
```

The server logs the effective values on connect. The ESPHome values take priority over add-on defaults for that device.

## Render Format Status

| Format | Status | Notes |
| --- | --- | --- |
| JPEG | Implemented | Current production path. The server encodes all frame rects as JPEG and the ESPHome client decodes them with `JPEGDEC`. |
| PNG | Implemented, experimental | Select with `render_mode: png` or the `RWV Render Mode` entity. The server encodes PNG rects with `sharp`; the ESPHome client decodes with `pngle`. Test on real hardware before treating it as the default mode. |
| RAW565 | Implemented, experimental | Select with `render_mode: raw565` or the `RWV Render Mode` entity. The server sends little-endian RGB565 tile payloads and the ESPHome client draws them directly without JPEG/PNG decoding. Useful for latency testing; bandwidth can be much higher than JPEG. |
| RAW565_RLE | Planned | Protocol enum exists; encoder/decoder and runtime selection are still pending. |
| RAW565_LZ4 | Reserved | Protocol enum exists as an experimental future option. It needs RAM and dependency review before implementation. |

## Parameters

- `id` - ESPHome component id used by lambdas.
- `server` - `host:port` of the Remote WebView server as seen from the ESP32.
- `url` - page opened by Chromium on the server. In a Home Assistant add-on, `127.0.0.1` means the add-on/Home Assistant host, not the ESP32.
- `device_id` - optional stable device id. Defaults to a MAC-derived id.
- `display_id` - display component to draw to.
- `touchscreen_id` - touchscreen component to forward touch events from.
- `tile_size` - server-side change detection tile size. Use at least `16`; `48` or `64` is usually better for 480x480.
- `full_frame_tile_count` - server-side number of chunks for a full-frame refresh.
- `full_frame_area_threshold` - server-side changed area threshold for forcing full frame.
- `full_frame_every` - server-side periodic full-frame refresh interval.
- `every_nth_frame` - server-side Chromium screencast sampling.
- `min_frame_interval` - server-side minimum frame processing interval in milliseconds.
- `jpeg_quality` - server-side JPEG quality.
- `render_mode` - requested render mode sent to the server as `rm`. `jpeg` is the production default. `png` is implemented for measurement and can be selected at boot or runtime. `raw565` is implemented as an experimental direct RGB565 path. `auto` currently behaves as a JPEG alias. `raw565_rle` remains accepted for backward compatibility, but the server falls back to JPEG until that client draw path exists.
- `max_bytes_per_msg` - both client receive limit and server-side packet chunking hint.
- `big_endian` - local RGB565 byte order for drawing decoded pixels.
- `rotation` - sent to the server as `r`; affects rendered image rotation and touch mapping.
- `latest_frame_wins` - local ESP decode queue behavior. If true, old queued packets are dropped when the decode queue is full.
- `stream_control_enabled` - enables pause/resume/keyframe commands from ESP to server.
- `touch_wake_passthrough` - when paused, first touch resumes stream and is forwarded if true; if false, the component drops touch events while paused.
- `telemetry_log_interval_ms` - local telemetry log interval.
- `sensors` - optional ESPHome native diagnostic sensors. If omitted, no sensor entities are created and the component keeps the previous YAML behavior. `unsupported_encoding_drops` increments when a server sends a frame encoding the client cannot decode.
- `binary_sensors` - optional ESPHome native state entities for connection, stream pause and touch enable state.
- `controls` - optional ESPHome native controls for pause, touch enable, keyframe request, reconnect, debug overlay and runtime tuning.

## Runtime Hooks

```cpp
id(rwv).set_stream_paused(true);
id(rwv).set_stream_paused(false);
id(rwv).request_full_frame();
id(rwv).is_stream_paused();
id(rwv).disable_touch(true);
id(rwv).disable_touch(false);
id(rwv).reconnect();
```

The optional `controls:` block exposes the same runtime hooks as Home Assistant entities:

- `pause_switch` - calls `set_stream_paused(...)`. It also sends `ClientControl PauseStream` when `stream_control_enabled: true`.
- `touch_switch` - enables or disables touch forwarding locally. `on` means touch is enabled.
- `request_keyframe_button` - calls `request_full_frame()`. It requires `stream_control_enabled: true`, because it is a server-side request.
- `reconnect_button` - restarts the ESP WebSocket client connection.
- `debug_overlay_switch` - stores local debug overlay state, publishes it as an entity, and sends `ClientControl SetDebugOverlay` when `stream_control_enabled: true`. The server stores this state, requests a keyframe, and draws diagnostic borders on transmitted rects. Full-frame rects are blue; partial rects are amber. Heatmaps and touch markers are later diagnostics stages.
- `render_mode_select` - sends `ClientConfig RenderMode` when `stream_control_enabled: true`. The server updates the device session without reconnect and requests a keyframe. The default select exposes the currently drawable modes: `jpeg`, experimental `png`, and experimental `raw565`.
- `jpeg_quality_number` - sends `ClientConfig JpegQuality` and affects subsequent JPEG frames without reconnect.
- `min_frame_interval_number` - sends `ClientConfig MinFrameInterval` and updates the server-side frame throttle without reconnect.
- `tile_size_number` - sends `ClientConfig TileSize`, rebuilds the server tile grid and requests a keyframe without reconnect.

## Power Management

Use ESPHome packages for reusable panel configuration. If your device YAML already has a `packages:` block, add these packages there and do not define `remote_webview:` again in the device YAML. Configure the package with substitutions.

```yaml
substitutions:
  rwv_display_id: main_display
  rwv_touchscreen_id: my_touchscreen
  rwv_backlight_id: backlight
  rwv_server: "192.168.1.100:8081"
  rwv_url: "http://127.0.0.1:8123/dashboard-tablet01/0"
  rwv_rotation: "0"

packages:
  rwv_client: !include common-rwv-client.yaml
  rwv_diagnostics: !include common-rwv-diagnostics.yaml
  rwv_power: !include common-rwv-power.yaml
```

The packages are intentionally split:

- `common-rwv-client.yaml` - only the `remote_webview:` component and stream/render substitutions.
- `common-rwv-diagnostics.yaml` - native ESPHome sensors, binary sensors and controls.
- `common-rwv-power.yaml` - backlight, wake/sleep scripts and optional frame watchdog.
- `common-rwv-lvgl-idle.yaml` - optional LVGL idle/pause/resume integration for configs that already use LVGL.

Use ESPHome scripts to turn the backlight off and pause the stream after inactivity. See `examples/remote_webview_client/common-rwv-power.yaml`.

The package provides:

- `rwv_sleep` - pauses the stream and turns off `${rwv_backlight_id}`.
- `rwv_wake` - turns on `${rwv_backlight_id}`, resumes the stream and requests a keyframe.
- `rwv_touch_activity` - hook this from `touchscreen.on_touch` to wake the panel.
- `rwv_idle_timer` - restartable inactivity timer.
- `rwv_sleep_mode` - `dim_then_off` dims first, then sleeps; `off` keeps the panel on until sleep.
- `rwv_idle_dim_after` - idle time before dimming in `dim_then_off` mode.
- `rwv_idle_sleep_after_dim` - delay from dimming to sleep in `dim_then_off` mode.
- `rwv_idle_sleep_after` - idle time before sleep in `off` mode.
- `rwv_backlight_wake_transition`, `rwv_backlight_dim_transition`, `rwv_backlight_sleep_transition` - backlight transition lengths.
- optional reconnect watchdog controlled by `${rwv_watchdog_missed_intervals}`. Keep it at `0` to disable it.

Host configs need to provide a backlight `light` id and call `rwv_touch_activity` from the touchscreen:

```yaml
touchscreen:
  - platform: ...
    id: panel_touch
    on_touch:
      then:
        - script.execute: rwv_touch_activity
```

### Optional LVGL Idle Integration

Use `examples/remote_webview_client/common-rwv-lvgl-idle.yaml` only when the device YAML already has an `lvgl:` section. This package does not define LVGL displays, touchscreens or pages; it only adds idle and resume hooks:

- after `${rwv_lvgl_idle_dim_after}` it dims `${rwv_backlight_id}`;
- after `${rwv_lvgl_idle_sleep_after}` it pauses the Remote WebView stream, turns the backlight off and calls `lvgl.pause`;
- on LVGL resume it turns the backlight on, resumes the stream and requests a full frame;
- `rwv_lvgl_resume_on_input` controls whether LVGL input wakes a paused LVGL instance.

Example:

```yaml
substitutions:
  rwv_backlight_id: backlight
  rwv_lvgl_idle_dim_after: "30s"
  rwv_lvgl_idle_sleep_after: "60s"
  rwv_lvgl_pause_show_snow: "false"

packages:
  rwv_client: !include common-rwv-client.yaml
  rwv_lvgl_idle: !include common-rwv-lvgl-idle.yaml
```

If your device YAML already has custom `lvgl.on_idle` or `lvgl.on_resume` actions, merge the actions intentionally instead of including two independent idle policies.

## Display Configuration Guardrails

Remote WebView draws decoded tiles directly into the ESPHome display. The display should not also run its normal periodic redraw loop, because that can clear or overwrite Remote WebView tiles and look like flicker, tearing or jumping.

Recommended display settings:

```yaml
display:
  - platform: ...
    id: panel_display
    update_interval: never
    auto_clear_enabled: false
```

`update_interval: never` disables the display poller. The Remote WebView component logs a warning during `dump_config()` if the display still has an active update interval.

`auto_clear_enabled: false` prevents ESPHome display rendering from clearing the framebuffer before a display lambda/page draw. ESPHome does not expose this value through the runtime display API, so Remote WebView cannot detect it reliably; keep it explicit in the device YAML.

## Diagnostics

For logs, enable:

```yaml
telemetry_log_interval_ms: 5000
```

Watch:

- `drops` - decode queue pressure.
- `decode_avg` - JPEG decode time.
- `render_avg` - frame rendering time.
- `last_frame` - whether frames are advancing.
- `reconnects` - WebSocket stability.

For Home Assistant entities, configure the optional `sensors:` and `binary_sensors:` blocks under `remote_webview`. Sensor updates are throttled to `telemetry_log_interval_ms`, with a minimum interval of 1 second. If `telemetry_log_interval_ms` is `0`, diagnostic entities still publish at roughly 1 Hz.

Available numeric sensors:

- `decode_avg_ms` - rolling average JPEG decode time on the ESP.
- `last_decode_ms` - last frame packet decode time.
- `render_avg_ms` - average frame render time reported by the client.
- `decode_drops` - packets dropped before decode.
- `reconnect_count` - reconnect count after the first successful connection.
- `last_frame_id` - last received frame id.
- `bytes_received` - total binary WebSocket payload bytes received by the client.
- `frames_received` - number of distinct frame ids seen by the client.
- `tiles_received` - total tile headers received.
- `fps` - client-side frame rate estimate based on received frame ids.
- `queue_depth` - current decode queue depth.

Available binary sensors:

- `connected` - WebSocket connection state.
- `stream_paused` - local stream pause state.
- `touch_enabled` - inverse of `disable_touch(...)`.

Available controls:

- `pause_switch`
- `touch_switch`
- `request_keyframe_button`
- `reconnect_button`
- `debug_overlay_switch`
- `render_mode_select`
- `jpeg_quality_number`
- `min_frame_interval_number`
- `tile_size_number`

`debug_overlay_switch` synchronizes debug overlay state to the server. The current server overlay draws rect borders before encoding; changed-tile colors, latency heatmaps and touch markers are planned for later diagnostics stages.

The runtime tuning controls use `ClientConfig` packets. They update the active server-side device session without reconnecting. Changing `tile_size` or `render_mode` forces a keyframe because it changes how rects are generated or interpreted; changing JPEG quality or minimum frame interval applies to subsequent frames.
