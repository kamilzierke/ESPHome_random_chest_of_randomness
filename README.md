# ESPHome Random Chest of Randomness

Personal ESPHome-related components, Home Assistant add-ons, examples, and device notes.

## Remote WebView

This repository contains a bundled Remote WebView setup:

- `components/remote_webview` - ESPHome external component for ESP32 display clients.
- `remote_webview_server` - Home Assistant add-on that builds and runs the matching Remote WebView server from this repository.
- `examples/remote_webview_client` - example ESPHome snippets for power management and Guition panels.

### ESPHome Client

Use this repository as an external component source:

```yaml
external_components:
  - source: github://kamilzierke/ESPHome_random_chest_of_randomness@main
    refresh: 0s
    components: [remote_webview]
```

Then configure the component in your ESPHome device:

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
```

See `docs/remote_webview_client.md` for the full parameter guide. The reusable examples in `examples/remote_webview_client` are split into client, diagnostics, and power packages; when using those packages, configure substitutions instead of duplicating `remote_webview:` in the device YAML.

### Home Assistant Add-on

Add this repository to Home Assistant:

```text
https://github.com/kamilzierke/ESPHome_random_chest_of_randomness
```

Then install **Remote WebView Server** from the add-on store. The add-on lives in `remote_webview_server` and builds the server from the source in this repository.

See `docs/remote_webview_server.md` for setup, login, debug proxy, and tuning notes.
