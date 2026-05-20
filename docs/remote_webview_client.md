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
  tile_size: 48
  full_frame_tile_count: 4
  full_frame_area_threshold: 0.9
  full_frame_every: 150
  every_nth_frame: 1
  min_frame_interval: 80
  jpeg_quality: 70
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
```

## Client and Server Parameter Contract

Most render parameters are configured in ESPHome but are consumed by the server. The client sends them in the WebSocket URL:

```text
ws://server:8081/?id=...&w=480&h=480&r=0&ts=48&fftc=4&ffat=0.9&ffe=150&enf=1&mfi=80&q=70&mbpm=61440
```

The server logs the effective values on connect. The ESPHome values take priority over add-on defaults for that device.

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
- `max_bytes_per_msg` - both client receive limit and server-side packet chunking hint.
- `big_endian` - local RGB565 byte order for drawing decoded pixels.
- `rotation` - sent to the server as `r`; affects rendered image rotation and touch mapping.
- `latest_frame_wins` - local ESP decode queue behavior. If true, old queued packets are dropped when the decode queue is full.
- `stream_control_enabled` - enables pause/resume/keyframe commands from ESP to server.
- `touch_wake_passthrough` - when paused, first touch resumes stream and is forwarded if true; if false, the component drops touch events while paused.
- `telemetry_log_interval_ms` - local telemetry log interval.
- `sensors` - optional ESPHome native diagnostic sensors. If omitted, no sensor entities are created and the component keeps the previous YAML behavior.
- `binary_sensors` - optional ESPHome native state entities for connection, stream pause and touch enable state.

## Runtime Hooks

```cpp
id(rwv).set_stream_paused(true);
id(rwv).set_stream_paused(false);
id(rwv).request_full_frame();
id(rwv).is_stream_paused();
id(rwv).disable_touch(true);
id(rwv).disable_touch(false);
```

## Power Management

Use ESPHome scripts to turn the backlight off and pause the stream after inactivity. See `examples/remote_webview_client/common-rwv-power.yaml`.

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
