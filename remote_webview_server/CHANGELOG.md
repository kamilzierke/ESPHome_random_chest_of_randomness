# Changelog

## 1.1.9 - 2026-05-22

### Added

- Added experimental `raw565` render mode end to end: the server can encode little-endian RGB565 tiles and the ESPHome client can draw them directly without JPEG/PNG decoding.
- Added `raw565` to the Home Assistant add-on `render_mode` option and to the ESPHome `RWV Render Mode` select.
- Added server-side tests for `rm=raw565` config parsing and RAW565 frame encoding.

### Changed

- Split RAW565 full-frame updates into enough rects to keep each tile payload within the configured WebSocket message budget.
- Updated Remote WebView client/server/tuning documentation to describe RAW565 as an experimental latency test mode.
