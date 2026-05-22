# Remote WebView Tuning

This document collects practical profiles and diagnostics for tuning Remote WebView on ESP32 panels. The current stable render path is JPEG tiles over WebSocket. PNG is available as an experimental measurement mode.

## Current Format Support

| Format | Client | Server | Use today |
| --- | --- | --- | --- |
| JPEG | Yes | Yes | Default and recommended mode. |
| PNG | Yes, via `pngle` | Yes, via `sharp` | Selectable for testing with `render_mode: png` or `RWV Render Mode`. |
| RAW565 | Planned | Partial helper only | Not selectable yet. |
| RAW565_RLE | Planned | Planned | Not selectable yet. |
| RAW565_LZ4 | Reserved | Reserved | Do not use yet. |

## Baseline Profiles

| Profile | Goal | Suggested Parameters |
| --- | --- | --- |
| Smooth UI | Better responsiveness on 480x480 panels | `tile_size: 48`, `jpeg_quality: 70-82`, `min_frame_interval: 50-80`, `full_frame_every: 150`, `every_nth_frame: 1` |
| Low CPU | Lower ESP decode and server encode load | `tile_size: 64`, `jpeg_quality: 60-70`, `min_frame_interval: 120-180`, `full_frame_every: 200`, `every_nth_frame: 2` |
| PNG test | Compare PNG size/latency on a dashboard | `render_mode: png`, `tile_size: 48-64`, `min_frame_interval: 100-160`; watch `RWV Render Avg`, `RWV FPS`, and network stability. |
| Debug tiles | See what the server sends | Enable `debug_overlay_switch`; full-frame rects are blue and partial rects are amber. |
| Slow network | Reduce bandwidth and queue pressure | `jpeg_quality: 55-65`, `tile_size: 64`, `min_frame_interval: 120`, keep `max_bytes_per_msg: 61440` |

## Runtime Controls

`common-rwv-diagnostics.yaml` exposes tuning controls in Home Assistant:

| Control | Effect |
| --- | --- |
| `RWV Render Mode` | Sends the requested render mode to the server and forces a keyframe. `jpeg` and experimental `png` are drawable today. |
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
