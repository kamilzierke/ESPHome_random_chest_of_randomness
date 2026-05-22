# Remote WebView Tuning

This document collects practical profiles and diagnostics for tuning Remote WebView on ESP32 panels. The current stable render path is JPEG tiles over WebSocket. PNG and RAW565 are available as experimental measurement modes.

## Current Format Support

| Format | Client | Server | Use today |
| --- | --- | --- | --- |
| JPEG | Yes | Yes | Default and recommended mode. |
| PNG | Yes, via `pngle` | Yes, via `sharp` | Selectable for testing with `render_mode: png` or `RWV Render Mode`. |
| Auto | JPEG alias for now | JPEG alias for now | Safe to leave unused until the heuristic exists. |
| RAW565 | Yes, direct draw | Yes, little-endian RGB565 | Selectable for latency testing with `render_mode: raw565` or `RWV Render Mode`; watch bandwidth and packet size. |
| RAW565_RLE | Planned | Emits JPEG fallback today | Not selectable yet. |
| RAW565_LZ4 | Reserved | Reserved | Do not use yet. |

## Baseline Profiles

| Profile | Goal | Suggested Parameters |
| --- | --- | --- |
| Smooth UI | Better responsiveness on 480x480 panels | `tile_size: 48`, `jpeg_quality: 70-82`, `min_frame_interval: 50-80`, `full_frame_every: 150`, `every_nth_frame: 1` |
| Low CPU | Lower ESP decode and server encode load | `tile_size: 64`, `jpeg_quality: 60-70`, `min_frame_interval: 120-180`, `full_frame_every: 200`, `every_nth_frame: 2` |
| PNG test | Compare PNG size/latency on a dashboard | `render_mode: png`, `tile_size: 48-64`, `min_frame_interval: 100-160`; watch `RWV Render Avg`, `RWV FPS`, and network stability. |
| RAW565 latency | Remove image decode cost on the ESP | `render_mode: raw565`, `tile_size: 32-48`, `min_frame_interval: 80-160`; watch `RWV FPS`, `RWV Queue Depth`, and Wi-Fi stability. |
| Debug tiles | See what the server sends | Enable `debug_overlay_switch`; full-frame rects are blue and partial rects are amber. |
| Slow network | Reduce bandwidth and queue pressure | `jpeg_quality: 55-65`, `tile_size: 64`, `min_frame_interval: 120`, keep `max_bytes_per_msg: 61440` |

## Adaptive Fallback

The server protects `max_bytes_per_message` in stages:

1. For JPEG tiles, retry lower JPEG quality down to `adaptive_min_jpeg_quality`.
2. If the encoded tile is still too large, split the rect recursively while `adaptive_split_enabled` is true.
3. Use the red fallback tile only as a final debug fallback when the configured limits make the tile impossible to send normally.

Recommended defaults for 480x480 panels are:

```yaml
adaptive_quality_enabled: true
adaptive_min_jpeg_quality: 35
adaptive_quality_step: 10
adaptive_split_enabled: true
adaptive_split_min_tile_size: 16
```

## Runtime Controls

`common-rwv-diagnostics.yaml` exposes tuning controls in Home Assistant:

| Control | Effect |
| --- | --- |
| `RWV Render Mode` | Sends the requested render mode to the server and forces a keyframe. `jpeg`, experimental `png`, and experimental `raw565` are drawable today. |
| `RWV JPEG Quality` | Changes JPEG quality for subsequent frames without reconnecting. |
| `RWV Min Frame Interval` | Changes server-side frame throttle without reconnecting. |
| `RWV Tile Size` | Rebuilds the server tile grid and forces a keyframe. |

## What To Watch

Use `common-rwv-diagnostics.yaml` to expose native ESPHome entities in Home Assistant.

| Metric | Meaning | Tuning Direction |
| --- | --- | --- |
| `RWV FPS` | Client-side frame arrival rate | Raise only if decode/render times and Wi-Fi are stable. |
| `RWV Decode Avg` | Average JPEG decode time on the ESP | Lower JPEG quality, increase tile size, or increase `min_frame_interval` if this is high. |
| `RWV Render Avg` | Average packet render time on the ESP | Watch together with decode time; high values can cause visible lag. |
| `RWV Decode Drops` | Packets dropped before decode | Increase `min_frame_interval`, lower JPEG quality, or enable latest-frame behavior. |
| `RWV Unsupported Encoding Drops` | Tiles skipped because the client cannot decode the frame encoding | Should stay at `0`; update server/client together if it increments. |
| `RWV Queue Depth` | Current decode backlog | Should usually stay low; sustained growth means the client cannot keep up. |
| `RWV Last Frame ID` | Last received frame id | Use to detect whether the stream is advancing. |

## Display Guardrails

For Remote WebView panels, keep the ESPHome display from periodically clearing or redrawing over streamed tiles:

```yaml
display:
  - platform: ...
    id: panel_display
    update_interval: never
    auto_clear_enabled: false
```

## Debug Overlay

The current debug overlay is server-side and controlled by the ESPHome `debug_overlay_switch` entity. It is meant for visual tuning:

- blue border: full-frame rect;
- amber border: partial update rect.

Future diagnostics work will add changed-tile colors, heatmaps and touch markers.
