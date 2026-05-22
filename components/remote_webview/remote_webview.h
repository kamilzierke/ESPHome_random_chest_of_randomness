#pragma once
#include "esphome/core/component.h"
#include "esphome/components/display/display.h"
#include "esphome/components/touchscreen/touchscreen.h"
#ifdef USE_SENSOR
#include "esphome/components/sensor/sensor.h"
#endif
#ifdef USE_BINARY_SENSOR
#include "esphome/components/binary_sensor/binary_sensor.h"
#endif
#ifdef USE_SWITCH
#include "esphome/components/switch/switch.h"
#endif
#ifdef USE_BUTTON
#include "esphome/components/button/button.h"
#endif
#ifdef USE_NUMBER
#include "esphome/components/number/number.h"
#endif
#ifdef USE_SELECT
#include "esphome/components/select/select.h"
#endif
#include "JPEGDEC.h"
#include <pngle.h>
#include "protocol.h"
#include "remote_webview_config.h"

#include "esp_event.h"
#include "esp_websocket_client.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"

#if defined(CONFIG_IDF_TARGET_ESP32P4)
  #include "driver/jpeg_decode.h"
  #define REMOTE_WEBVIEW_HW_JPEG 1
#else
  #define REMOTE_WEBVIEW_HW_JPEG 0
#endif
#if defined(CONFIG_IDF_TARGET_ESP32P4)
  #include "esp_cache.h"
  #define REMOTE_WEBVIEW_HAS_CACHE_MSYNC 1
#else
  #define REMOTE_WEBVIEW_HAS_CACHE_MSYNC 0
#endif

namespace esphome {
namespace remote_webview {

class RemoteWebView : public Component {
 public:
  void set_display(display::Display *d) { display_ = d; }
  void set_touchscreen(touchscreen::Touchscreen *t) { touch_ = t; }
  void set_device_id(const std::string &s) { device_id_ = s; }
  void set_url(const std::string &s) { url_ = s; }
  void set_server(const std::string &s);
  void set_tile_size(int v) { tile_size_ = v; }
  void set_full_frame_tile_count(int v) { full_frame_tile_count_ = v; }
  void set_full_frame_area_threshold(float v) { full_frame_area_threshold_ = v; }
  void set_full_frame_every(int v) { full_frame_every_ = v; }
  void set_every_nth_frame(int v) { every_nth_frame_ = v; }
  void set_min_frame_interval(int v) { min_frame_interval_ = v; }
  void set_jpeg_quality(int v) { jpeg_quality_ = v; }
  void set_render_mode(int v) { render_mode_ = v; }
  void set_max_bytes_per_msg(int v) { max_bytes_per_msg_ = v; }
  void set_big_endian(bool v) { rgb565_big_endian_ = v; }
  void set_rotation(int v) { rotation_ = v; }
  void set_latest_frame_wins(bool v) { latest_frame_wins_ = v; }
  void set_touch_wake_passthrough(bool v) { touch_wake_passthrough_ = v; }
  void set_stream_control_enabled(bool v) { stream_control_enabled_ = v; }
  void set_telemetry_log_interval_ms(uint32_t v) { telemetry_log_interval_ms_ = v; }
#ifdef USE_SENSOR
  void set_decode_avg_ms_sensor(sensor::Sensor *s) { decode_avg_ms_sensor_ = s; }
  void set_last_decode_ms_sensor(sensor::Sensor *s) { last_decode_ms_sensor_ = s; }
  void set_render_avg_ms_sensor(sensor::Sensor *s) { render_avg_ms_sensor_ = s; }
  void set_decode_drops_sensor(sensor::Sensor *s) { decode_drops_sensor_ = s; }
  void set_reconnect_count_sensor(sensor::Sensor *s) { reconnect_count_sensor_ = s; }
  void set_last_frame_id_sensor(sensor::Sensor *s) { last_frame_id_sensor_ = s; }
  void set_bytes_received_sensor(sensor::Sensor *s) { bytes_received_sensor_ = s; }
  void set_frames_received_sensor(sensor::Sensor *s) { frames_received_sensor_ = s; }
  void set_tiles_received_sensor(sensor::Sensor *s) { tiles_received_sensor_ = s; }
  void set_fps_sensor(sensor::Sensor *s) { fps_sensor_ = s; }
  void set_queue_depth_sensor(sensor::Sensor *s) { queue_depth_sensor_ = s; }
#endif
#ifdef USE_BINARY_SENSOR
  void set_connected_binary_sensor(binary_sensor::BinarySensor *s) { connected_binary_sensor_ = s; }
  void set_stream_paused_binary_sensor(binary_sensor::BinarySensor *s) { stream_paused_binary_sensor_ = s; }
  void set_touch_enabled_binary_sensor(binary_sensor::BinarySensor *s) { touch_enabled_binary_sensor_ = s; }
#endif
#ifdef USE_SWITCH
  void set_pause_switch(switch_::Switch *s) { pause_switch_ = s; }
  void set_touch_switch(switch_::Switch *s) { touch_switch_ = s; }
  void set_debug_overlay_switch(switch_::Switch *s) { debug_overlay_switch_ = s; }
#endif
#ifdef USE_BUTTON
  void set_request_keyframe_button(button::Button *b) { request_keyframe_button_ = b; }
  void set_reconnect_button(button::Button *b) { reconnect_button_ = b; }
#endif
#ifdef USE_NUMBER
  void set_jpeg_quality_number(number::Number *n) { jpeg_quality_number_ = n; }
  void set_min_frame_interval_number(number::Number *n) { min_frame_interval_number_ = n; }
  void set_tile_size_number(number::Number *n) { tile_size_number_ = n; }
#endif
#ifdef USE_SELECT
  void set_render_mode_select(select::Select *s) { render_mode_select_ = s; }
#endif

  void disable_touch(bool disable);
  bool is_touch_enabled() const { return !touch_disabled_; }
  bool open_url(const std::string &s);
  void set_stream_paused(bool paused);
  bool is_stream_paused() const { return stream_paused_; }
  void set_debug_overlay_enabled(bool enabled);
  bool is_debug_overlay_enabled() const { return debug_overlay_enabled_; }
  void request_full_frame();
  void reconnect();
  void set_runtime_jpeg_quality(int v);
  void set_runtime_min_frame_interval(int v);
  void set_runtime_tile_size(int v);
  void set_runtime_render_mode(int v);

  uint32_t get_decode_drop_count() const { return decode_drop_count_; }
  uint32_t get_decode_avg_ms() const {
    if (decode_time_count_ == 0) return last_decode_ms_;
    return (uint32_t)((decode_time_sum_us_ / decode_time_count_) / 1000ULL);
  }
  uint32_t get_render_avg_ms() const { return frame_render_avg_ms_; }
  uint32_t get_last_frame_id() const { return last_frame_id_; }
  uint32_t get_reconnect_count() const { return reconnect_count_; }
  int get_jpeg_quality() const { return jpeg_quality_; }
  int get_min_frame_interval() const { return min_frame_interval_; }
  int get_tile_size() const { return tile_size_; }
  int get_render_mode() const { return render_mode_; }
  const char *get_render_mode_name() const { return render_mode_name_(render_mode_); }

  void setup() override;
  void loop() override { maybe_publish_diagnostics_(); }
  void dump_config() override;
  float get_setup_priority() const override { return setup_priority::LATE; }

 private:
  struct WsMsg {
    uint8_t *buf{nullptr};
    size_t   len{0};
    void    *client{nullptr}; // opaque esp_websocket_client_handle_t
  };
  struct WsReasm {
    uint8_t *buf{nullptr};
    size_t total{0}, filled{0};
  };

  static constexpr bool     kCoalesceMoves  = cfg::coalesce_moves;
  static constexpr uint32_t kMoveRateHz     = cfg::move_rate_hz;
  static constexpr uint32_t kMoveIntervalUs = (kMoveRateHz ? (1000000u / kMoveRateHz) : 0);

  static RemoteWebView *self_;
  display::Display *display_{nullptr};
  touchscreen::Touchscreen *touch_ = nullptr;
  class RemoteWebViewTouchListener *touch_listener_ = nullptr;
  int display_width_{0};
  int display_height_{0};
  std::string url_;
  std::string server_host_;
  std::string device_id_;
  int server_port_{0};
  int tile_size_{-1};
  int full_frame_tile_count_{-1};
  float full_frame_area_threshold_{-1.0f};
  int full_frame_every_{-1};
  int every_nth_frame_{-1};
  int min_frame_interval_{-1};
  int jpeg_quality_{-1};
  int render_mode_{1};
  int max_bytes_per_msg_{-1};
  bool rgb565_big_endian_{true};
  int rotation_{0};
  bool touch_disabled_{false};

  bool latest_frame_wins_{false};
  bool touch_wake_passthrough_{false};
  bool stream_control_enabled_{false};
  uint32_t telemetry_log_interval_ms_{0};
  bool stream_paused_{false};
  bool ws_connected_{false};
  bool debug_overlay_enabled_{false};

#if REMOTE_WEBVIEW_HW_JPEG
  jpeg_decoder_handle_t hw_dec_{nullptr};
  uint8_t *hw_decode_input_buf_{nullptr};
  uint8_t *hw_decode_output_buf_{nullptr};
  size_t hw_decode_input_size_{0};
  size_t hw_decode_output_size_{0};
#endif

  uint64_t last_move_us_{0};
  uint64_t last_keepalive_us_{0};

  uint64_t frame_start_us_ = 0;
  uint32_t frame_id_{0xffffffffu};
  uint16_t frame_tiles_{0};
  size_t   frame_bytes_{0};
  uint32_t frame_stats_time_{0};
  uint32_t frame_stats_count_{0};
  size_t   frame_stats_bytes_{0};

  uint32_t decode_drop_count_{0};
  uint64_t decode_time_sum_us_{0};
  uint32_t decode_time_count_{0};
  uint32_t last_decode_ms_{0};
  uint32_t frame_render_avg_ms_{0};
  uint32_t last_frame_id_{0xffffffffu};
  uint32_t reconnect_count_{0};
  uint64_t last_telemetry_log_us_{0};
  uint64_t last_diagnostic_publish_us_{0};
  uint64_t last_fps_sample_us_{0};
  uint32_t last_fps_frame_count_{0};
  float fps_{0.0f};
  bool ws_connected_once_{false};
  uint32_t bytes_received_{0};
  uint32_t frames_received_{0};
  uint32_t tiles_received_{0};

#ifdef USE_SENSOR
  sensor::Sensor *decode_avg_ms_sensor_{nullptr};
  sensor::Sensor *last_decode_ms_sensor_{nullptr};
  sensor::Sensor *render_avg_ms_sensor_{nullptr};
  sensor::Sensor *decode_drops_sensor_{nullptr};
  sensor::Sensor *reconnect_count_sensor_{nullptr};
  sensor::Sensor *last_frame_id_sensor_{nullptr};
  sensor::Sensor *bytes_received_sensor_{nullptr};
  sensor::Sensor *frames_received_sensor_{nullptr};
  sensor::Sensor *tiles_received_sensor_{nullptr};
  sensor::Sensor *fps_sensor_{nullptr};
  sensor::Sensor *queue_depth_sensor_{nullptr};
#endif
#ifdef USE_BINARY_SENSOR
  binary_sensor::BinarySensor *connected_binary_sensor_{nullptr};
  binary_sensor::BinarySensor *stream_paused_binary_sensor_{nullptr};
  binary_sensor::BinarySensor *touch_enabled_binary_sensor_{nullptr};
#endif
#ifdef USE_SWITCH
  switch_::Switch *pause_switch_{nullptr};
  switch_::Switch *touch_switch_{nullptr};
  switch_::Switch *debug_overlay_switch_{nullptr};
#endif
#ifdef USE_BUTTON
  button::Button *request_keyframe_button_{nullptr};
  button::Button *reconnect_button_{nullptr};
#endif
#ifdef USE_NUMBER
  number::Number *jpeg_quality_number_{nullptr};
  number::Number *min_frame_interval_number_{nullptr};
  number::Number *tile_size_number_{nullptr};
#endif
#ifdef USE_SELECT
  select::Select *render_mode_select_{nullptr};
#endif

  QueueHandle_t     q_decode_{nullptr};
  SemaphoreHandle_t ws_send_mtx_{nullptr};
  TaskHandle_t      t_ws_{nullptr};
  TaskHandle_t      t_decode_{nullptr};

  esp_websocket_client_handle_t ws_client_{nullptr};

  void start_ws_task_();
  void start_decode_task_();
  static void ws_task_tramp_(void *arg);
  static void decode_task_tramp_(void *arg);

  static void ws_event_handler_(void *handler_arg, esp_event_base_t base, int32_t event_id, void *event_data);
  static void reasm_reset_(WsReasm &r);

  void process_packet_(void *client, const uint8_t *data, size_t len);
  void process_frame_packet_(const uint8_t *data, size_t len);
  void process_frame_stats_packet_(const uint8_t *data, size_t len);
  bool decode_jpeg_tile_to_lcd_(int16_t dst_x, int16_t dst_y, const uint8_t *data, size_t len);
  bool decode_jpeg_tile_software_(int16_t dst_x, int16_t dst_y, const uint8_t *data, size_t len);
  bool decode_png_tile_to_lcd_(int16_t dst_x, int16_t dst_y, const uint8_t *data, size_t len);

  static int jpeg_draw_cb_s_(JPEGDRAW *p);
  int jpeg_draw_cb_(JPEGDRAW *p);
  JPEGDEC jd_;
  static void png_init_cb_s_(pngle_t *pngle, uint32_t w, uint32_t h);
  static void png_draw_cb_s_(pngle_t *pngle, uint32_t x, uint32_t y, uint32_t w, uint32_t h,
                             const uint8_t rgba[4]);

  bool ws_send_touch_event_(proto::TouchType type, int x, int y, uint8_t pid);
  bool ws_send_keepalive_();
  bool ws_send_open_url_(const char *url, uint16_t flags);
  bool ws_send_client_control_(proto::ClientControlCmd cmd, uint8_t value);
  bool ws_send_client_config_(proto::ClientConfigField field, uint32_t value);
  void sync_runtime_config_();

  void clear_decode_queue_();
  void apply_stream_state_();
  void maybe_log_telemetry_();
  void maybe_publish_diagnostics_();
  void publish_connection_state_();
  void publish_stream_paused_state_();
  void publish_touch_enabled_state_();
  void publish_debug_overlay_state_();
  void publish_runtime_control_states_();

  std::string resolve_device_id_() const;
  std::string build_ws_uri_() const;
  static void append_q_int_(std::string &s, const char *k, int v);
  static void append_q_float_(std::string &s, const char *k, float v);
  static void append_q_str_(std::string &s, const char *k, const char *v);
  static const char *render_mode_name_(int mode);

  friend class RemoteWebViewTouchListener;
};

class RemoteWebViewTouchListener : public touchscreen::TouchListener {
 public:
  explicit RemoteWebViewTouchListener(RemoteWebView *p) : parent_(p) {}
  void touch(touchscreen::TouchPoint tp) override;
  void update(const touchscreen::TouchPoints_t &pts) override;
  void release() override;
 private:
  RemoteWebView *parent_{nullptr};
};

#ifdef USE_SWITCH
class RemoteWebViewPauseSwitch : public switch_::Switch {
 public:
  void set_parent(RemoteWebView *parent) { parent_ = parent; }

 protected:
  void write_state(bool state) override;

 private:
  RemoteWebView *parent_{nullptr};
};

class RemoteWebViewTouchSwitch : public switch_::Switch {
 public:
  void set_parent(RemoteWebView *parent) { parent_ = parent; }

 protected:
  void write_state(bool state) override;

 private:
  RemoteWebView *parent_{nullptr};
};

class RemoteWebViewDebugOverlaySwitch : public switch_::Switch {
 public:
  void set_parent(RemoteWebView *parent) { parent_ = parent; }

 protected:
  void write_state(bool state) override;

 private:
  RemoteWebView *parent_{nullptr};
};
#endif

#ifdef USE_BUTTON
class RemoteWebViewRequestKeyframeButton : public button::Button {
 public:
  void set_parent(RemoteWebView *parent) { parent_ = parent; }

 protected:
  void press_action() override;

 private:
  RemoteWebView *parent_{nullptr};
};

class RemoteWebViewReconnectButton : public button::Button {
 public:
  void set_parent(RemoteWebView *parent) { parent_ = parent; }

 protected:
  void press_action() override;

 private:
  RemoteWebView *parent_{nullptr};
};
#endif

#ifdef USE_NUMBER
class RemoteWebViewJpegQualityNumber : public number::Number {
 public:
  void set_parent(RemoteWebView *parent) { parent_ = parent; }

 protected:
  void control(float value) override;

 private:
  RemoteWebView *parent_{nullptr};
};

class RemoteWebViewMinFrameIntervalNumber : public number::Number {
 public:
  void set_parent(RemoteWebView *parent) { parent_ = parent; }

 protected:
  void control(float value) override;

 private:
  RemoteWebView *parent_{nullptr};
};

class RemoteWebViewTileSizeNumber : public number::Number {
 public:
  void set_parent(RemoteWebView *parent) { parent_ = parent; }

 protected:
  void control(float value) override;

 private:
  RemoteWebView *parent_{nullptr};
};
#endif

#ifdef USE_SELECT
class RemoteWebViewRenderModeSelect : public select::Select {
 public:
  void set_parent(RemoteWebView *parent) { parent_ = parent; }

 protected:
  void control(size_t index) override;

 private:
  RemoteWebView *parent_{nullptr};
};
#endif

}  // namespace remote_webview
}  // namespace esphome
