# Changelog

## 1.1.10 - 2026-05-22

### Added

- Added adaptive JPEG fallback before oversized tile fallback: the server now retries lower JPEG quality, then splits oversized tiles before using the final debug fallback.
- Added add-on options for adaptive fallback tuning: `adaptive_quality_enabled`, `adaptive_min_jpeg_quality`, `adaptive_quality_step`, `adaptive_split_enabled`, and `adaptive_split_min_tile_size`.

### Changed

- Oversized JPEG tiles no longer immediately turn into red fallback tiles in normal conditions.

## 1.1.9 - 2026-05-22

### Added

- Added experimental `raw565` render mode end to end: the server can encode little-endian RGB565 tiles and the ESPHome client can draw them directly without JPEG/PNG decoding.
- Added `raw565` to the Home Assistant add-on `render_mode` option and to the ESPHome `RWV Render Mode` select.
- Added server-side tests for `rm=raw565` config parsing and RAW565 frame encoding.

### Changed

- Split RAW565 full-frame updates into enough rects to keep each tile payload within the configured WebSocket message budget.
- Updated Remote WebView client/server/tuning documentation to describe RAW565 as an experimental latency test mode.
