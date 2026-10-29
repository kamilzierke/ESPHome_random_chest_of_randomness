#include "remote_webview.h"
#include "remote_webview_config.h"
#include "esphome/core/log.h"

#include "esp_idf_version.h"
#include "esp_event.h"
#include "esp_mac.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "esp_heap_caps.h"
#include "esp_websocket_client.h"
#include "esp_efuse.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

namespace esphome {
namespace remote_webview {

static const char *const TAG = "Remote_WebView";
RemoteWebView *RemoteWebView::self_ = nullptr;

struct PngDrawContext {
  RemoteWebView *self{nullptr};
  int16_t dst_x{0};
  int16_t dst_y{0};
  uint16_t width{0}, height{0};
  bool valid{false}, complete{false};
};

static inline void websocket_force_reconnect(esp_websocket_client_handle_t client) {
  if (!client) return;
  const esp_err_t stopped = esp_websocket_client_stop(client);
  if (stopped != ESP_OK) {
    ESP_LOGW(TAG, "websocket stop failed: %d", stopped);
    return;
  }
  const esp_err_t started = esp_websocket_client_start(client);
  if (started != ESP_OK) ESP_LOGE(TAG, "websocket start failed: %d", started);
}

void RemoteWebView::setup() {
  self_ = this;
  device_id_ = resolve_device_id_();

  if (!display_) {
    ESP_LOGE(TAG, "no display");
    return;
  }

  display_width_ = display_->get_width();
  display_height_ = display_->get_height();

  q_decode_ = xQueueCreate(cfg::decode_queue_depth, sizeof(WsMsg));
  ws_send_mtx_ = xSemaphoreCreateMutex();

  if (!q_decode_ || !ws_send_mtx_) {
    ESP_LOGE(TAG, "queue/mutex allocation failed");
    mark_failed();
    return;
  }

  if (touch_) {
    touch_listener_ = new RemoteWebViewTouchListener(this);
    touch_->register_listener(touch_listener_);
    ESP_LOGD(TAG, "touch listener registered");
  }

  publish_connection_state_();
  publish_stream_paused_state_();
  publish_touch_enabled_state_();
  publish_debug_overlay_state_();
  publish_runtime_control_states_();
  maybe_publish_diagnostics_();

#if REMOTE_WEBVIEW_HW_JPEG
  jpeg_decode_engine_cfg_t jcfg = {
    .timeout_ms = 200,
  };
  if (jpeg_new_decoder_engine(&jcfg, &hw_dec_) != ESP_OK) {
    hw_dec_ = nullptr;
  }
  
  if (hw_dec_) {
    const int W = display_->get_width();
    const int H = display_->get_height();
    const int aligned_w = (W + 15) & ~15;
    const int aligned_h = (H + 15) & ~15;
    
    const size_t max_buffer_size = (size_t)aligned_w * (size_t)aligned_h * 2u;
    
    jpeg_decode_memory_alloc_cfg_t in_cfg { .buffer_direction = JPEG_DEC_ALLOC_INPUT_BUFFER };
    jpeg_decode_memory_alloc_cfg_t out_cfg { .buffer_direction = JPEG_DEC_ALLOC_OUTPUT_BUFFER };
    
    hw_decode_input_buf_ = (uint8_t*)jpeg_alloc_decoder_mem((uint32_t)max_buffer_size, &in_cfg, &hw_decode_input_size_);
    hw_decode_output_buf_ = (uint8_t*)jpeg_alloc_decoder_mem((uint32_t)max_buffer_size, &out_cfg, &hw_decode_output_size_);
    
    if (!hw_decode_input_buf_ || !hw_decode_output_buf_) {
      ESP_LOGE(TAG, "Failed to allocate HW decoder buffers");
      if (hw_decode_input_buf_) free(hw_decode_input_buf_);
      if (hw_decode_output_buf_) free(hw_decode_output_buf_);
      hw_decode_input_buf_ = nullptr;
      hw_decode_output_buf_ = nullptr;
      jpeg_del_decoder_engine(hw_dec_);
      hw_dec_ = nullptr;
    } else {
      ESP_LOGD(TAG, "HW decoder buffers allocated: input=%u, output=%u", 
               (unsigned)hw_decode_input_size_, (unsigned)hw_decode_output_size_);
    }
  }
#endif
  start_decode_task_();
  if (!is_failed()) start_ws_task_();
}

void RemoteWebView::loop() {
  if (session_pending_.exchange(false) && ws_connected_) {
    apply_stream_state_();
    sync_runtime_config_();
    if (stream_control_enabled_ && debug_overlay_enabled_)
      ws_send_client_control_(proto::ClientControlCmd::SetDebugOverlay, 1);
    if (!url_.empty()) ws_send_open_url_(url_.c_str(), 0);
  }
  if (connection_dirty_.exchange(false)) publish_connection_state_();
  maybe_publish_diagnostics_();
}

void RemoteWebView::dump_config() {
  ESP_LOGCONFIG(TAG, "remote_webview:");
  ESP_LOGCONFIG(TAG, "  source_id: %s", source_id_.c_str());

  const std::string id = device_id_.empty() ? resolve_device_id_() : device_id_;
  ESP_LOGCONFIG(TAG, "  id: %s", id.c_str());

  if (display_) {
    ESP_LOGCONFIG(TAG, "  display: %dx%d", display_->get_width(), display_->get_height());
    const uint32_t display_update_interval = display_->get_update_interval();
    if (display_update_interval != SCHEDULER_DONT_RUN) {
      ESP_LOGW(TAG, "display update_interval is active (%u ms). Remote WebView displays should use "
                    "update_interval: never to avoid periodic redraw/clear artifacts.",
               (unsigned) display_update_interval);
    }
  }

#if REMOTE_WEBVIEW_HW_JPEG
  ESP_LOGCONFIG(TAG, "  hw_jpeg: %s", hw_dec_ ? "yes" : "no");
#else
  ESP_LOGCONFIG(TAG, "  hw_jpeg: no");
#endif

  ESP_LOGCONFIG(TAG, "  server: %s:%d", server_host_.c_str(), server_port_);
  ESP_LOGCONFIG(TAG, "  url: %s", url_.c_str());

  auto print_opt_int = [&](const char *name, int v) {
    if (v >= 0) ESP_LOGCONFIG(TAG, "  %s: %d", name, v);
  };
  auto print_opt_float2 = [&](const char *name, float v) {
    if (v >= 0.0f) ESP_LOGCONFIG(TAG, "  %s: %.2f", name, (double)v);
  };

  print_opt_int   ("tile_size",                 tile_size_);
  print_opt_int   ("full_frame_tile_count",     full_frame_tile_count_);
  print_opt_float2("full_frame_area_threshold", full_frame_area_threshold_);
  print_opt_int   ("full_frame_every",          full_frame_every_);
  print_opt_int   ("every_nth_frame",           every_nth_frame_);
  print_opt_int   ("min_frame_interval",        min_frame_interval_);
  print_opt_int   ("jpeg_quality",              jpeg_quality_);
  ESP_LOGCONFIG(TAG, "  render_mode: %s", render_mode_name_(render_mode_));
  print_opt_int   ("max_bytes_per_msg",         max_bytes_per_msg_);
  print_opt_int   ("big_endian",                rgb565_big_endian_);
  print_opt_int   ("rotation",                  rotation_);
  ESP_LOGCONFIG(TAG, "  latest_frame_wins: %s", latest_frame_wins_ ? "true" : "false");
  ESP_LOGCONFIG(TAG, "  touch_wake_passthrough: %s", touch_wake_passthrough_ ? "true" : "false");
  ESP_LOGCONFIG(TAG, "  stream_control_enabled: %s", stream_control_enabled_ ? "true" : "false");
  if (telemetry_log_interval_ms_ > 0) {
    ESP_LOGCONFIG(TAG, "  telemetry_log_interval_ms: %u", (unsigned) telemetry_log_interval_ms_);
  }
}

bool RemoteWebView::open_url(const std::string &s) {
  if (s.empty()) return false;

  if (!ws_client_ || !esp_websocket_client_is_connected(ws_client_))
    return false;

  if (ws_send_open_url_(s.c_str(), 0)) {
    url_ = s;
    ESP_LOGD(TAG, "opened URL: %s", s.c_str());
    return true;
  }

  return false;
}

void RemoteWebView::set_stream_paused(bool paused) {
  if (stream_paused_ == paused)
    return;

  // The host on_touch automation can resume before TouchListener::touch().
  // Preserve wake-only semantics for that same physical contact, including
  // (0,0), where ESPHome may omit the initial update() callback.
  if (!paused && !touch_wake_passthrough_ && touch_) {
    for (const auto &point : touch_->get_touches()) {
      if (point.state == touchscreen::STATE_PRESSED || point.state == touchscreen::STATE_UPDATED)
        suppress_touch_until_release_ = true;
    }
  }
  stream_paused_ = paused;
  invalidate_image_();
  if (paused)
    clear_decode_queue_();

  apply_stream_state_();
  publish_stream_paused_state_();
  ESP_LOGD(TAG, "stream %s", paused ? "paused" : "resumed");
}

void RemoteWebView::set_debug_overlay_enabled(bool enabled) {
  if (debug_overlay_enabled_ == enabled)
    return;

  debug_overlay_enabled_ = enabled;
  if (stream_control_enabled_) {
    ws_send_client_control_(proto::ClientControlCmd::SetDebugOverlay, enabled ? 1 : 0);
  }
  publish_debug_overlay_state_();
  ESP_LOGD(TAG, "debug overlay %s", enabled ? "enabled" : "disabled");
}

void RemoteWebView::set_runtime_jpeg_quality(int v) {
  if (v < 1) v = 1;
  if (v > 100) v = 100;
  if (jpeg_quality_ == v) {
    publish_runtime_control_states_();
    return;
  }

  jpeg_quality_ = v;
  if (stream_control_enabled_) {
    ws_send_client_config_(proto::ClientConfigField::JpegQuality, (uint32_t) v);
  }
  publish_runtime_control_states_();
  ESP_LOGD(TAG, "jpeg quality set to %d", v);
}

void RemoteWebView::set_runtime_min_frame_interval(int v) {
  if (v < 0) v = 0;
  if (min_frame_interval_ == v) {
    publish_runtime_control_states_();
    return;
  }

  min_frame_interval_ = v;
  if (stream_control_enabled_) {
    ws_send_client_config_(proto::ClientConfigField::MinFrameInterval, (uint32_t) v);
  }
  publish_runtime_control_states_();
  ESP_LOGD(TAG, "min frame interval set to %d ms", v);
}

void RemoteWebView::set_runtime_tile_size(int v) {
  if (v < 1) v = 1;
  if (tile_size_ == v) {
    publish_runtime_control_states_();
    return;
  }

  tile_size_ = v;
  if (stream_control_enabled_) {
    ws_send_client_config_(proto::ClientConfigField::TileSize, (uint32_t) v);
  }
  publish_runtime_control_states_();
  ESP_LOGD(TAG, "tile size set to %d", v);
}

void RemoteWebView::set_runtime_render_mode(int v) {
  if (v < 0 || v > 4) v = 1;
  if (render_mode_ == v) {
    publish_runtime_control_states_();
    return;
  }

  render_mode_ = v;
  if (stream_control_enabled_) {
    ws_send_client_config_(proto::ClientConfigField::RenderMode, (uint32_t) v);
  }
  publish_runtime_control_states_();
  ESP_LOGD(TAG, "render mode set to %s", render_mode_name_(render_mode_));
}

void RemoteWebView::request_full_frame() {
  if (stream_control_enabled_) keyframe_requested_ = true;
}

void RemoteWebView::reconnect() {
  reconnect_requested_ = true;
}

void RemoteWebView::invalidate_image_() {
  portENTER_CRITICAL(&recovery_mux_);
  recovery_after_frame_ = last_wire_frame_.load();
  recovery_barrier_valid_ = wire_frame_seen_.load();
  recovery_epoch_.fetch_add(1);
  portEXIT_CRITICAL(&recovery_mux_);
  keyframe_requested_ = true;
}

void RemoteWebView::clear_decode_queue_() {
  if (!q_decode_)
    return;

  WsMsg dropped{};
  while (xQueueReceive(q_decode_, &dropped, 0) == pdTRUE) {
    if (dropped.buf) {
      free(dropped.buf);
      dropped.buf = nullptr;
      decode_drop_count_++;
    }
  }
}

void RemoteWebView::apply_stream_state_() {
  if (!stream_control_enabled_)
    return;

  if (!ws_client_ || !esp_websocket_client_is_connected(ws_client_))
    return;

  if (stream_paused_) {
    ws_send_client_control_(proto::ClientControlCmd::PauseStream, 1);
    return;
  }

  ws_send_client_control_(proto::ClientControlCmd::PauseStream, 0);
  sync_runtime_config_();
  ws_send_client_control_(proto::ClientControlCmd::RequestKeyframe, 1);
}

void RemoteWebView::sync_runtime_config_() {
  if (!stream_control_enabled_)
    return;

  if (!ws_client_ || !esp_websocket_client_is_connected(ws_client_))
    return;

  ws_send_client_config_(proto::ClientConfigField::RenderMode, (uint32_t) render_mode_);
  if (jpeg_quality_ >= 0)
    ws_send_client_config_(proto::ClientConfigField::JpegQuality, (uint32_t) jpeg_quality_);
  if (min_frame_interval_ >= 0)
    ws_send_client_config_(proto::ClientConfigField::MinFrameInterval, (uint32_t) min_frame_interval_);
  if (tile_size_ >= 0)
    ws_send_client_config_(proto::ClientConfigField::TileSize, (uint32_t) tile_size_);
}

void RemoteWebView::maybe_log_telemetry_() {
  if (telemetry_log_interval_ms_ == 0)
    return;

  const uint64_t now_us = esp_timer_get_time();
  const uint64_t interval_us = (uint64_t) telemetry_log_interval_ms_ * 1000ULL;
  if (last_telemetry_log_us_ != 0 && (now_us - last_telemetry_log_us_) < interval_us)
    return;

  last_telemetry_log_us_ = now_us;
  ESP_LOGI(TAG,
           "telemetry drops=%u unsupported_encoding_drops=%u decode_avg=%u ms render_avg=%u ms last_frame=%lu reconnects=%u paused=%s",
           (unsigned) decode_drop_count_,
           (unsigned) unsupported_encoding_drops_,
           (unsigned) get_decode_avg_ms(),
           (unsigned) frame_render_avg_ms_,
           (unsigned long) last_frame_id_,
           (unsigned) reconnect_count_,
           stream_paused_ ? "true" : "false");
}

void RemoteWebView::maybe_publish_diagnostics_() {
#if defined(USE_SENSOR)
  const uint64_t now_us = esp_timer_get_time();
  uint32_t interval_ms = telemetry_log_interval_ms_ > 0 ? telemetry_log_interval_ms_ : 1000;
  if (interval_ms < 1000)
    interval_ms = 1000;

  const uint64_t interval_us = (uint64_t) interval_ms * 1000ULL;
  if (last_diagnostic_publish_us_ != 0 && (now_us - last_diagnostic_publish_us_) < interval_us)
    return;

  if (last_fps_sample_us_ != 0 && now_us > last_fps_sample_us_) {
    const uint32_t frame_delta = frames_received_ - last_fps_frame_count_;
    const uint64_t elapsed_us = now_us - last_fps_sample_us_;
    fps_ = elapsed_us > 0 ? (float) frame_delta * 1000000.0f / (float) elapsed_us : 0.0f;
  }
  last_fps_sample_us_ = now_us;
  last_fps_frame_count_ = frames_received_;
  last_diagnostic_publish_us_ = now_us;

  if (decode_avg_ms_sensor_) decode_avg_ms_sensor_->publish_state((float) get_decode_avg_ms());
  if (last_decode_ms_sensor_) last_decode_ms_sensor_->publish_state((float) last_decode_ms_);
  if (render_avg_ms_sensor_) render_avg_ms_sensor_->publish_state((float) frame_render_avg_ms_);
  if (decode_drops_sensor_) decode_drops_sensor_->publish_state((float) decode_drop_count_);
  if (unsupported_encoding_drops_sensor_) unsupported_encoding_drops_sensor_->publish_state((float) unsupported_encoding_drops_);
  if (reconnect_count_sensor_) reconnect_count_sensor_->publish_state((float) reconnect_count_);
  if (last_frame_id_sensor_) last_frame_id_sensor_->publish_state((float) last_frame_id_);
  if (bytes_received_sensor_) bytes_received_sensor_->publish_state((float) bytes_received_);
  if (frames_received_sensor_) frames_received_sensor_->publish_state((float) frames_received_);
  if (tiles_received_sensor_) tiles_received_sensor_->publish_state((float) tiles_received_);
  if (fps_sensor_) fps_sensor_->publish_state(fps_);
  if (queue_depth_sensor_) queue_depth_sensor_->publish_state((float) (q_decode_ ? uxQueueMessagesWaiting(q_decode_) : 0));
#endif
}

void RemoteWebView::publish_connection_state_() {
#if defined(USE_BINARY_SENSOR)
  if (connected_binary_sensor_) connected_binary_sensor_->publish_state(ws_connected_);
#endif
}

void RemoteWebView::publish_stream_paused_state_() {
#if defined(USE_BINARY_SENSOR)
  if (stream_paused_binary_sensor_) stream_paused_binary_sensor_->publish_state(stream_paused_);
#endif
#if defined(USE_SWITCH)
  if (pause_switch_) pause_switch_->publish_state(stream_paused_);
#endif
}

void RemoteWebView::publish_touch_enabled_state_() {
#if defined(USE_BINARY_SENSOR)
  if (touch_enabled_binary_sensor_) touch_enabled_binary_sensor_->publish_state(!touch_disabled_);
#endif
#if defined(USE_SWITCH)
  if (touch_switch_) touch_switch_->publish_state(!touch_disabled_);
#endif
}

void RemoteWebView::publish_debug_overlay_state_() {
#if defined(USE_SWITCH)
  if (debug_overlay_switch_) debug_overlay_switch_->publish_state(debug_overlay_enabled_);
#endif
}

void RemoteWebView::publish_runtime_control_states_() {
#if defined(USE_NUMBER)
  if (jpeg_quality_number_ && jpeg_quality_ >= 0) jpeg_quality_number_->publish_state((float) jpeg_quality_);
  if (min_frame_interval_number_ && min_frame_interval_ >= 0) min_frame_interval_number_->publish_state((float) min_frame_interval_);
  if (tile_size_number_ && tile_size_ >= 0) tile_size_number_->publish_state((float) tile_size_);
#endif
#if defined(USE_SELECT)
  if (render_mode_select_) render_mode_select_->publish_state(render_mode_name_(render_mode_));
#endif
}

void RemoteWebView::start_ws_task_() {
  if (xTaskCreatePinnedToCore(&RemoteWebView::ws_task_tramp_, "rwv_ws", cfg::ws_task_stack, this, 5, &t_ws_, 0) != pdPASS) {
    ESP_LOGE(TAG, "websocket task allocation failed");
    mark_failed();
  }
}

void RemoteWebView::ws_task_tramp_(void *arg) {
  auto *self = reinterpret_cast<RemoteWebView*>(arg);
  std::string uri_str = self->build_ws_uri_();
  esp_websocket_client_config_t cfg_ws = {};
  cfg_ws.uri = uri_str.c_str();
  cfg_ws.reconnect_timeout_ms = 2000;
  cfg_ws.network_timeout_ms = 10000;
  cfg_ws.task_stack = cfg::ws_task_stack;
  cfg_ws.task_prio = cfg::ws_task_prio;
  cfg_ws.buffer_size = cfg::ws_buffer_size;
  cfg_ws.disable_auto_reconnect = false;
  cfg_ws.enable_close_reconnect = true;
  WsReasm reasm{};
  reasm.owner = self;
  esp_websocket_client_handle_t client = esp_websocket_client_init(&cfg_ws);
  self->ws_client_ = client;
  if (!client || esp_websocket_register_events(client, WEBSOCKET_EVENT_ANY, ws_event_handler_, &reasm) != ESP_OK ||
      esp_websocket_client_start(client) != ESP_OK) {
    ESP_LOGE(TAG, "websocket initialization failed");
    if (client) esp_websocket_client_destroy(client);
    self->ws_client_ = nullptr;
    vTaskDelete(nullptr);
    return;
  }
  for (;;) {
    vTaskDelay(pdMS_TO_TICKS(50));
    if (self->reconnect_requested_.exchange(false)) {
      if (xSemaphoreTake(self->ws_send_mtx_, pdMS_TO_TICKS(250)) == pdTRUE) {
        websocket_force_reconnect(client);
        xSemaphoreGive(self->ws_send_mtx_);
      } else self->reconnect_requested_ = true;
    }
    if (!esp_websocket_client_is_connected(client)) continue;
    if (self->keyframe_requested_ && !self->stream_control_enabled_ && !self->stream_paused_) {
      self->keyframe_requested_ = false;
      self->reconnect_requested_ = true;
      continue;
    }
    const uint64_t now = esp_timer_get_time();
    if (self->keyframe_requested_ && !self->stream_paused_ && self->stream_control_enabled_ &&
        now - self->last_keyframe_request_us_ >= 1000000ULL) {
      self->keyframe_requested_ = false;
      if (self->ws_send_client_control_(proto::ClientControlCmd::RequestKeyframe, 1))
        self->last_keyframe_request_us_ = now;
      else self->keyframe_requested_ = true;
    }
    if (now - self->last_keepalive_us_ >= cfg::ws_keepalive_interval_us && self->ws_send_keepalive_())
      self->last_keepalive_us_ = now;
  }
}

void RemoteWebView::reasm_reset_(WsReasm &r) {
  if (r.buf) free(r.buf);
  r.buf = nullptr; r.total = 0; r.filled = 0;
  r.frame_size = 0; r.frame_filled = 0;
}

void RemoteWebView::ws_event_handler_(void *handler_arg, esp_event_base_t, int32_t event_id, void *event_data) {
  auto *r = reinterpret_cast<WsReasm*>(handler_arg);
  auto *self = r ? r->owner : nullptr;
  auto *e = reinterpret_cast<const esp_websocket_event_data_t *>(event_data);
  if (!self || !e) return;
  switch (event_id) {
    case WEBSOCKET_EVENT_CONNECTED:
      self->clear_decode_queue_();
      self->wire_frame_seen_ = false;
      self->invalidate_image_();
      self->keyframe_requested_ = self->stream_control_enabled_;
      self->ws_connected_ = true;
      if (self->ws_connected_once_) self->reconnect_count_++;
      self->ws_connected_once_ = true;
      self->session_pending_ = true;
      self->connection_dirty_ = true;
      ESP_LOGI(TAG, "[ws] connected");
      break;
    case WEBSOCKET_EVENT_DISCONNECTED:
    case WEBSOCKET_EVENT_CLOSED:
      self->ws_connected_ = false;
      self->connection_dirty_ = true;
      self->invalidate_image_();
      reasm_reset_(*r);
      // esp_websocket_client owns automatic reconnect, including clean close.
      ESP_LOGI(TAG, "[ws] disconnected/closed");
      break;
    case WEBSOCKET_EVENT_DATA: {
      if (e->op_code != WS_TRANSPORT_OPCODES_BINARY && e->op_code != WS_TRANSPORT_OPCODES_CONT) break;
      const size_t limit = self->max_bytes_per_msg_ > 0 ? size_t(self->max_bytes_per_msg_) : cfg::ws_max_message_bytes;
      if (e->data_len < 0 || e->payload_len < 0 || e->payload_offset < 0 ||
          (e->data_len && !e->data_ptr)) {
        reasm_reset_(*r); self->invalidate_image_(); break;
      }
      if (e->payload_offset == 0) {
        if (e->op_code == WS_TRANSPORT_OPCODES_BINARY) {
          if (r->buf) self->invalidate_image_();
          reasm_reset_(*r);
          if (size_t(e->payload_len) > limit) { self->invalidate_image_(); break; }
          r->total = limit;
          r->buf = (uint8_t *)heap_caps_malloc(limit, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
          if (!r->buf) r->buf = (uint8_t *)heap_caps_malloc(limit, MALLOC_CAP_8BIT);
          if (!r->buf) { self->invalidate_image_(); break; }
        } else if (!r->buf || r->frame_filled != r->frame_size) {
          reasm_reset_(*r); self->invalidate_image_(); break;
        }
        r->frame_size = size_t(e->payload_len);
        r->frame_filled = 0;
      }
      const size_t count = size_t(e->data_len);
      if (!r->buf || size_t(e->payload_offset) != r->frame_filled ||
          r->frame_filled > r->frame_size || count > r->frame_size - r->frame_filled ||
          r->filled > r->total || count > r->total - r->filled) {
        reasm_reset_(*r); self->invalidate_image_(); break;
      }
      if (count) memcpy(r->buf + r->filled, e->data_ptr, count);
      r->filled += count; r->frame_filled += count;
      if (r->frame_filled != r->frame_size || !e->fin) break;
      WsMsg msg{};
      msg.buf = r->buf; msg.len = r->filled; msg.client = e->client;
      r->buf = nullptr; reasm_reset_(*r);
      proto::FrameInfo info{}; size_t offset = 0;
      if (proto::parse_frame_header(msg.buf, msg.len, info, offset)) {
        self->last_wire_frame_ = info.frame_id;
        self->wire_frame_seen_ = true;
      }
      self->bytes_received_ += uint32_t(msg.len);
      bool queued = self->q_decode_ && xQueueSend(self->q_decode_, &msg, 0) == pdTRUE;
      if (!queued && self->q_decode_ && self->latest_frame_wins_) {
        WsMsg old{};
        if (xQueueReceive(self->q_decode_, &old, 0) == pdTRUE) {
          free(old.buf); self->decode_drop_count_++;
          self->invalidate_image_();
        }
        queued = xQueueSend(self->q_decode_, &msg, 0) == pdTRUE;
      }
      if (!queued) {
        free(msg.buf); self->decode_drop_count_++;
        self->invalidate_image_();
      }
      break;
    }
    case WEBSOCKET_EVENT_ERROR:
      self->ws_connected_ = false;
      self->connection_dirty_ = true;
      ESP_LOGE(TAG, "[ws] error: type=%d tls_err=%d tls_stack=%d", e->error_handle.error_type,
               e->error_handle.esp_tls_last_esp_err, e->error_handle.esp_tls_stack_err);
      break;
    default: break;
  }
}

void RemoteWebView::start_decode_task_() {
  if (xTaskCreatePinnedToCore(&RemoteWebView::decode_task_tramp_, "rwv_decode", cfg::decode_task_stack, this, 6, &t_decode_, 1) != pdPASS) {
    ESP_LOGE(TAG, "decode task allocation failed");
    mark_failed();
  }
}

void RemoteWebView::decode_task_tramp_(void *arg) {
  auto *self = reinterpret_cast<RemoteWebView*>(arg);
  WsMsg m;
  for (;;) {
    if (xQueueReceive(self->q_decode_, &m, portMAX_DELAY) == pdTRUE) {
      const bool is_frame = (m.buf && m.len > 0 && m.buf[0] == (uint8_t) proto::MsgType::Frame);
      const uint64_t started_us = esp_timer_get_time();
      self->process_packet_(m.client, m.buf, m.len);
      if (is_frame) {
        const uint64_t elapsed_us = esp_timer_get_time() - started_us;
        portENTER_CRITICAL(&self->decode_stats_mux_);
        self->decode_time_sum_us_ += elapsed_us;
        self->decode_time_count_++;
        portEXIT_CRITICAL(&self->decode_stats_mux_);
        self->last_decode_ms_ = (uint32_t) (elapsed_us / 1000ULL);
        self->maybe_log_telemetry_();

      }
      free(m.buf);
    }
  }
}

void RemoteWebView::process_packet_(void * /*client*/, const uint8_t *data, size_t len) {
  if (!data || len == 0) return;

  const proto::MsgType type = (proto::MsgType)data[0];
  switch (type) {
    case proto::MsgType::Frame:
      process_frame_packet_(data, len);
      break;
    case proto::MsgType::FrameStats:
      process_frame_stats_packet_(data, len);
      break;
    default:
      ESP_LOGW(TAG, "unknown packet type: %d", (int)type);
      break;
  }
}

void RemoteWebView::process_frame_packet_(const uint8_t *data, size_t len)
{
  if (stream_paused_) return;
  if (!proto::validate_frame_packet(data, len, display_width_, display_height_)) {
    proto::FrameInfo malformed{}; size_t malformed_offset = 0;
    if (proto::parse_frame_header(data, len, malformed, malformed_offset) &&
        malformed.enc != proto::Encoding::JPEG && malformed.enc != proto::Encoding::PNG &&
        malformed.enc != proto::Encoding::RAW565) unsupported_encoding_drops_++;
    decode_drop_count_++;
    invalidate_image_();
    return;
  }
  const uint32_t epoch = recovery_epoch_.load();
  if (decode_epoch_ != epoch) {
    decode_epoch_ = epoch;
    recovering_ = true;
    receiving_full_frame_ = false;
    frame_complete_ = true;
  }

  proto::FrameInfo fi{};
  size_t off = 0;
  if (!proto::parse_frame_header(data, len, fi, off)) return;
  if (recovering_ && !receiving_full_frame_) {
    if (!(fi.flags & proto::kFlagIsFullFrame) ||
        (recovery_barrier_valid_ && int32_t(fi.frame_id - recovery_after_frame_) <= 0)) return;
    receiving_full_frame_ = true;
  }
  if (fi.frame_id != frame_id_ && !frame_complete_) {
    invalidate_image_();
    return;
  }
  frame_complete_ = false;

  if (fi.frame_id != frame_id_) {
    frame_id_ = fi.frame_id;
    last_frame_id_ = fi.frame_id;
    frames_received_++;
    frame_tiles_ = 0;
    frame_bytes_ = 0;
    frame_start_us_ = esp_timer_get_time();
  }
  frame_bytes_ += len;
  frame_tiles_ += fi.tile_count;
  tiles_received_ += fi.tile_count;

  for (uint16_t i = 0; i < fi.tile_count; i++) {
    proto::TileHeader th{};
    if (!proto::parse_tile_header(data, len, th, off)) return;
    if (th.dlen > len - off) { invalidate_image_(); return; }

    if (th.w == 0 || th.h == 0 || th.w > display_width_ || th.h > display_height_) {
      off += th.dlen;
      continue;
    }

    bool decoded = false;
    if (fi.enc == proto::Encoding::JPEG)
      decoded = decode_jpeg_tile_to_lcd_((int16_t)th.x, (int16_t)th.y, th.w, th.h, data + off, th.dlen);
    else if (fi.enc == proto::Encoding::PNG)
      decoded = decode_png_tile_to_lcd_((int16_t)th.x, (int16_t)th.y, th.w, th.h, data + off, th.dlen);
    else if (fi.enc == proto::Encoding::RAW565)
      decoded = draw_raw565_tile_to_lcd_((int16_t)th.x, (int16_t)th.y, th.w, th.h, data + off, th.dlen);
    if (!decoded) {
      decode_drop_count_++;
      ESP_LOGW(TAG, "tile decode failed; requesting full frame");
      invalidate_image_();
      return;
    }
    if (recovery_epoch_.load() != epoch) return;

    off += th.dlen;
  }

  if (fi.flags & proto::kFlagLastOfFrame) {
    frame_complete_ = true;
    recovering_ = false;
    receiving_full_frame_ = false;
    const uint32_t time_ms = (esp_timer_get_time() - frame_start_us_) / 1000ULL;
    frame_stats_bytes_ += frame_bytes_;
    frame_stats_time_ += time_ms;
    frame_stats_count_++;
    frame_render_avg_ms_ = frame_stats_count_ ? (frame_stats_time_ / frame_stats_count_) : time_ms;
    ESP_LOGD(TAG, "frame %lu: tiles %u (%u bytes) - %lu ms", frame_id_, frame_tiles_, frame_bytes_, time_ms);
  }
}

void RemoteWebView::process_frame_stats_packet_(const uint8_t *data, size_t len)
{
  if (!data || len != sizeof(proto::FrameStatsPacket) || data[1] != proto::kProtocolVersion) return;
  uint32_t avg_render_time = 0;
  if (frame_stats_count_ > 0)
    avg_render_time = frame_stats_time_ / frame_stats_count_;

  ESP_LOGD(TAG, "sending frame stats: avg_time=%u ms, bytes=%u", (unsigned)avg_render_time, (unsigned)frame_stats_bytes_);
  uint8_t pkt[sizeof(proto::FrameStatsPacket)];
  const size_t n = proto::build_frame_stats_packet(avg_render_time, frame_stats_bytes_, pkt);

  frame_stats_time_ = 0;
  frame_stats_count_ = 0;
  frame_stats_bytes_ = 0;

  const TickType_t to = pdMS_TO_TICKS(50);
  if (xSemaphoreTake(ws_send_mtx_, to) != pdTRUE)
    return;

  esp_websocket_client_send_bin(ws_client_, (const char*)pkt, (int)n, to);
  xSemaphoreGive(ws_send_mtx_);
}

bool RemoteWebView::decode_jpeg_tile_to_lcd_(int16_t dst_x, int16_t dst_y, uint16_t width, uint16_t height, const uint8_t *data, size_t len) {
  if (!data || !len) return false;

#if REMOTE_WEBVIEW_HW_JPEG
  if (hw_dec_ && hw_decode_input_buf_ && hw_decode_output_buf_) {
    jpeg_decode_picture_info_t hdr{};
    if (jpeg_decoder_get_info(data, (uint32_t)len, &hdr) != ESP_OK || !hdr.width || !hdr.height) {
      return decode_jpeg_tile_software_(dst_x, dst_y, width, height, data, len);
    }

    if (hdr.width != width || hdr.height != height) return false;
    const int aligned_w = (hdr.width  + 15) & ~15;
    const int aligned_h = (hdr.height + 15) & ~15;
    const uint32_t out_sz = (uint32_t)aligned_w * (uint32_t)aligned_h * 2u;

    if (aligned_w != (int)hdr.width) {
      ESP_LOGW(TAG, "jpeg dimensions not aligned: %u x %u", (unsigned)hdr.width, (unsigned)hdr.height);
      return decode_jpeg_tile_software_(dst_x, dst_y, width, height, data, len);
    }
    
    if (len > hw_decode_input_size_ || out_sz > hw_decode_output_size_) {
      ESP_LOGW(TAG, "tile too large for HW decoder buffers");
      return decode_jpeg_tile_software_(dst_x, dst_y, width, height, data, len);
    }

    jpeg_decode_cfg_t jcfg{};
    jcfg.output_format = JPEG_DECODE_OUT_FORMAT_RGB565;
    jcfg.rgb_order     = JPEG_DEC_RGB_ELEMENT_ORDER_BGR;
    jcfg.conv_std      = JPEG_YUV_RGB_CONV_STD_BT709;

    memcpy(hw_decode_input_buf_, data, len);
    
    uint32_t written = 0;
    esp_err_t dr = jpeg_decoder_process(hw_dec_, &jcfg, hw_decode_input_buf_, (uint32_t)len, 
                                        hw_decode_output_buf_, (uint32_t)hw_decode_output_size_, &written);

    if (dr != ESP_OK) {
      return decode_jpeg_tile_software_(dst_x, dst_y, width, height, data, len);
    }

    display_->draw_pixels_at(dst_x, dst_y, (int)hdr.width, (int)hdr.height, hw_decode_output_buf_,
        esphome::display::COLOR_ORDER_RGB,
        esphome::display::COLOR_BITNESS_565,
        rgb565_big_endian_);

    return true;
  }
#endif  // REMOTE_WEBVIEW_HW_JPEG

  return decode_jpeg_tile_software_(dst_x, dst_y, width, height, data, len);
}

bool RemoteWebView::decode_jpeg_tile_software_(int16_t dst_x, int16_t dst_y, uint16_t width, uint16_t height, const uint8_t *data, size_t len) {
  if (!jd_.openRAM((uint8_t*)data, (int)len, &RemoteWebView::jpeg_draw_cb_s_)) {
    ESP_LOGE(TAG, "openRAM failed (len=%u) err=%d", (unsigned)len, jd_.getLastError());
    return false;
  }

  if (jd_.getWidth() != width || jd_.getHeight() != height) { jd_.close(); return false; }
  jd_.setMaxOutputSize(8 * 2048);
  jd_.setPixelType(rgb565_big_endian_ ? RGB565_BIG_ENDIAN : RGB565_LITTLE_ENDIAN);

  const int rc = jd_.decode(dst_x, dst_y, 0);
  if (rc == 0) {
    ESP_LOGE(TAG, "decode rc=%d err=%d", rc, jd_.getLastError());
    jd_.close();
    return false;
  }
  jd_.close();
  return true;
}

int RemoteWebView::jpeg_draw_cb_s_(JPEGDRAW *p) {
  return self_ ? self_->jpeg_draw_cb_(p) : 0;
}

int RemoteWebView::jpeg_draw_cb_(JPEGDRAW *p) {
  int32_t x = p->x, y = p->y, w = p->iWidth, h = p->iHeight;
  
  if (x >= display_width_ || y >= display_height_) return 1;
  if (x + w > display_width_) w = display_width_ - x;
  if (y + h > display_height_) h = display_height_ - y;
  if (w <= 0 || h <= 0) return 1;

  display_->draw_pixels_at(
      x, y, w, h,
      (const uint8_t *)p->pPixels,
      esphome::display::COLOR_ORDER_RGB,
      esphome::display::COLOR_BITNESS_565,
      rgb565_big_endian_
  );

  return 1;
}

bool RemoteWebView::decode_png_tile_to_lcd_(int16_t dst_x, int16_t dst_y, uint16_t width, uint16_t height, const uint8_t *data, size_t len) {
  static const uint8_t signature[] = {137, 80, 78, 71, 13, 10, 26, 10};
  if (!data || len < 33 || memcmp(data, signature, sizeof(signature)) || memcmp(data + 12, "IHDR", 4)) return false;
  const auto be32 = [](const uint8_t *p) { return (uint32_t(p[0]) << 24) | (uint32_t(p[1]) << 16) |
                                                  (uint32_t(p[2]) << 8) | uint32_t(p[3]); };
  if (be32(data + 16) != width || be32(data + 20) != height) return false;

  auto *pngle = (pngle_t *) heap_caps_malloc(PNGLE_T_SIZE, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!pngle) pngle = (pngle_t *) heap_caps_malloc(PNGLE_T_SIZE, MALLOC_CAP_8BIT);
  if (!pngle) {
    ESP_LOGE(TAG, "png decoder allocation failed (%u bytes)", (unsigned) PNGLE_T_SIZE);
    return false;
  }

  memset(pngle, 0, PNGLE_T_SIZE);
  pngle_reset(pngle);

  PngDrawContext ctx;
  ctx.self = this;
  ctx.dst_x = dst_x;
  ctx.dst_y = dst_y;
  ctx.width = width;
  ctx.height = height;

  pngle_set_user_data(pngle, &ctx);
  pngle_set_init_callback(pngle, &RemoteWebView::png_init_cb_s_);
  pngle_set_draw_callback(pngle, &RemoteWebView::png_draw_cb_s_);
  pngle_set_done_callback(pngle, &RemoteWebView::png_done_cb_s_);

  const int fed = pngle_feed(pngle, data, len);
  if (fed < 0) {
    ESP_LOGE(TAG, "png decode failed: %s", pngle_error(pngle));
    pngle_destroy(pngle);
    return false;
  }

  const bool complete = ctx.valid && ctx.complete && size_t(fed) == len;
  pngle_destroy(pngle);
  return complete;
}

bool RemoteWebView::draw_raw565_tile_to_lcd_(int16_t dst_x, int16_t dst_y, uint16_t w, uint16_t h, const uint8_t *data,
                                             size_t len) {
  if (!data || w == 0 || h == 0) return false;

  const size_t expected = (size_t) w * (size_t) h * 2u;
  if (len != expected) {
    ESP_LOGW(TAG, "raw565 tile length mismatch: got=%u expected=%u", (unsigned) len, (unsigned) expected);
    return false;
  }

  if (dst_x < 0 || dst_y < 0 || dst_x >= display_width_ || dst_y >= display_height_) return false;

  int draw_w = w;
  int draw_h = h;
  if (dst_x + draw_w > display_width_) draw_w = display_width_ - dst_x;
  if (dst_y + draw_h > display_height_) draw_h = display_height_ - dst_y;
  if (draw_w <= 0 || draw_h <= 0) return false;

  // RAW565 wire data is little-endian RGB565. Let display drivers convert from that source order.
  if (draw_w == (int) w) {
    display_->draw_pixels_at(dst_x, dst_y, draw_w, draw_h, data, esphome::display::COLOR_ORDER_RGB,
                             esphome::display::COLOR_BITNESS_565, false);
    return true;
  }

  const size_t row_stride = (size_t) w * 2u;
  for (int row = 0; row < draw_h; row++) {
    display_->draw_pixels_at(dst_x, dst_y + row, draw_w, 1, data + ((size_t) row * row_stride),
                             esphome::display::COLOR_ORDER_RGB, esphome::display::COLOR_BITNESS_565, false);
  }
  return true;
}

void RemoteWebView::png_init_cb_s_(pngle_t *pngle, uint32_t w, uint32_t h) {
  auto *ctx = reinterpret_cast<PngDrawContext *>(pngle_get_user_data(pngle));
  if (ctx) ctx->valid = w == ctx->width && h == ctx->height;
}

void RemoteWebView::png_done_cb_s_(pngle_t *pngle) {
  auto *ctx = reinterpret_cast<PngDrawContext *>(pngle_get_user_data(pngle));
  if (ctx) ctx->complete = true;
}

void RemoteWebView::png_draw_cb_s_(pngle_t *pngle, uint32_t x, uint32_t y, uint32_t w, uint32_t h,
                                   const uint8_t rgba[4]) {
  if (!pngle || !rgba) return;
  auto *ctx = reinterpret_cast<PngDrawContext *>(pngle_get_user_data(pngle));
  if (!ctx || !ctx->self || !ctx->valid) return;
  RemoteWebView *self = ctx->self;

  int32_t dx = ctx->dst_x + (int32_t) x;
  int32_t dy = ctx->dst_y + (int32_t) y;
  int32_t dw = (int32_t) w;
  int32_t dh = (int32_t) h;

  if (dx >= self->display_width_ || dy >= self->display_height_) return;
  if (dx + dw > self->display_width_) dw = self->display_width_ - dx;
  if (dy + dh > self->display_height_) dh = self->display_height_ - dy;
  if (dw <= 0 || dh <= 0) return;

  self->display_->filled_rectangle(dx, dy, dw, dh, Color(rgba[0], rgba[1], rgba[2], rgba[3]));
}

bool RemoteWebView::ws_send_touch_event_(proto::TouchType type, int x, int y, uint8_t pid) {
  if (touch_disabled_)
    return false;
  if (suppress_touch_until_release_)
    return false;

  if (stream_paused_) {
    if (type == proto::TouchType::Down) {
      set_stream_paused(false);
      if (!touch_wake_passthrough_) {
        suppress_touch_until_release_ = true;
        return false;
      }
    } else {
      return false;
    }
  }

  if (!ws_client_ || !ws_send_mtx_ || !esp_websocket_client_is_connected(ws_client_))
    return false;

  if (x < 0) x = 0; if (y < 0) y = 0;
  if (x >= display_width_) x = display_width_ - 1;
  if (y >= display_height_) y = display_height_ - 1;

  uint8_t pkt[sizeof(proto::TouchPacket)];
  const size_t n = proto::build_touch_packet(type, pid, x, y, pkt);

  const TickType_t to = pdMS_TO_TICKS(50);
  if (xSemaphoreTake(ws_send_mtx_, pdMS_TO_TICKS(10)) != pdTRUE)
    return false;

  int r = esp_websocket_client_send_bin(ws_client_, (const char*)pkt, (int)n, to);
  xSemaphoreGive(ws_send_mtx_);
  return r == (int)n;
}

bool RemoteWebView::ws_send_open_url_(const char *url, uint16_t flags) {
  if (!ws_client_ || !ws_send_mtx_ ||  !url || !esp_websocket_client_is_connected(ws_client_))
    return false;

  const uint32_t n = (uint32_t) strlen(url);
  const size_t total = sizeof(proto::OpenURLHeader) + (size_t) n;
  
  if (total > 16 * 1024) return false;

    auto *pkt = (uint8_t *) heap_caps_malloc(total, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!pkt) pkt = (uint8_t *) heap_caps_malloc(total, MALLOC_CAP_8BIT);
  if (!pkt) return false;

  const size_t written = proto::build_open_url_packet(url, flags, pkt, total);
  bool ok = false;
  if (written) {
    if (xSemaphoreTake(ws_send_mtx_, pdMS_TO_TICKS(50)) == pdTRUE) {
      const int r = esp_websocket_client_send_bin(ws_client_, (const char *) pkt, (int) written, pdMS_TO_TICKS(200));
      xSemaphoreGive(ws_send_mtx_);
      ok = (r == (int) written);
    }
  }
  free(pkt);
  return ok;
}

bool RemoteWebView::ws_send_keepalive_() {
  if (!ws_client_ || !ws_send_mtx_ || !esp_websocket_client_is_connected(ws_client_))
    return false;

  uint8_t pkt[sizeof(proto::KeepalivePacket)];
  const size_t n = proto::build_keepalive_packet(pkt);
  if (!n) return false;

  const TickType_t to = pdMS_TO_TICKS(50);
  if (xSemaphoreTake(ws_send_mtx_, to) != pdTRUE)
    return false;

  const int r = esp_websocket_client_send_bin(ws_client_, (const char*)pkt, (int)n, to);
  xSemaphoreGive(ws_send_mtx_);
  return r == (int)n;
}

bool RemoteWebView::ws_send_client_control_(proto::ClientControlCmd cmd, uint8_t value) {
  if (!ws_client_ || !ws_send_mtx_ || !esp_websocket_client_is_connected(ws_client_))
    return false;

  uint8_t pkt[sizeof(proto::ClientControlPacket)];
  const size_t n = proto::build_client_control_packet(cmd, value, pkt);
  if (!n)
    return false;

  const TickType_t to = pdMS_TO_TICKS(50);
  if (xSemaphoreTake(ws_send_mtx_, to) != pdTRUE)
    return false;

  const int r = esp_websocket_client_send_bin(ws_client_, (const char*)pkt, (int)n, to);
  xSemaphoreGive(ws_send_mtx_);
  return r == (int)n;
}

bool RemoteWebView::ws_send_client_config_(proto::ClientConfigField field, uint32_t value) {
  if (!ws_client_ || !ws_send_mtx_ || !esp_websocket_client_is_connected(ws_client_))
    return false;

  uint8_t pkt[sizeof(proto::ClientConfigPacket)];
  const size_t n = proto::build_client_config_packet(field, value, pkt);
  if (!n)
    return false;

  const TickType_t to = pdMS_TO_TICKS(50);
  if (xSemaphoreTake(ws_send_mtx_, to) != pdTRUE)
    return false;

  const int r = esp_websocket_client_send_bin(ws_client_, (const char*)pkt, (int)n, to);
  xSemaphoreGive(ws_send_mtx_);
  return r == (int)n;
}

void RemoteWebViewTouchListener::update(const touchscreen::TouchPoints_t &pts) {
  if (!parent_) return;

  const uint64_t now = esp_timer_get_time();
  for (auto &p : pts) {
    switch (p.state) {
      case touchscreen::STATE_PRESSED:
        pressed_in_update_ = true;
        parent_->ws_send_touch_event_(proto::TouchType::Down, p.x, p.y, p.id);
        break;
      case touchscreen::STATE_UPDATED:
        if (!RemoteWebView::kCoalesceMoves || RemoteWebView::kMoveIntervalUs == 0 ||
            (now - parent_->last_move_us_) >= RemoteWebView::kMoveIntervalUs) {
          parent_->last_move_us_ = now;
          parent_->ws_send_touch_event_(proto::TouchType::Move, p.x, p.y, p.id);
        }
        break;
      case touchscreen::STATE_RELEASING:
      case touchscreen::STATE_RELEASED:
        parent_->ws_send_touch_event_(proto::TouchType::Up, p.x, p.y, p.id);
        break;
      default: break;
    }
  }
}

void RemoteWebViewTouchListener::release() {
  if (!parent_) return;
  parent_->suppress_touch_until_release_ = false;
  pressed_in_update_ = false;
}

void RemoteWebViewTouchListener::touch(touchscreen::TouchPoint tp) {
  // Normally update() delivered Down already. ESPHome can omit it when the
  // first coordinate is (0,0), so retain exactly one fallback Down.
  if (parent_ && !pressed_in_update_)
    parent_->ws_send_touch_event_(proto::TouchType::Down, tp.x, tp.y, tp.id);
}

void RemoteWebView::disable_touch(bool disable) {
  touch_disabled_ = disable;
  publish_touch_enabled_state_();
  ESP_LOGD(TAG, "touch %s", disable ? "disabled" : "enabled");
}

#ifdef USE_SWITCH
void RemoteWebViewPauseSwitch::write_state(bool state) {
  if (!parent_) {
    publish_state(state);
    return;
  }
  parent_->set_stream_paused(state);
  publish_state(parent_->is_stream_paused());
}

void RemoteWebViewTouchSwitch::write_state(bool state) {
  if (!parent_) {
    publish_state(state);
    return;
  }
  parent_->disable_touch(!state);
  publish_state(parent_->is_touch_enabled());
}

void RemoteWebViewDebugOverlaySwitch::write_state(bool state) {
  if (!parent_) {
    publish_state(state);
    return;
  }
  parent_->set_debug_overlay_enabled(state);
  publish_state(parent_->is_debug_overlay_enabled());
}
#endif

#ifdef USE_NUMBER
void RemoteWebViewJpegQualityNumber::control(float value) {
  if (!parent_) {
    publish_state(value);
    return;
  }
  parent_->set_runtime_jpeg_quality((int) (value + (value >= 0.0f ? 0.5f : -0.5f)));
  publish_state((float) parent_->get_jpeg_quality());
}

void RemoteWebViewMinFrameIntervalNumber::control(float value) {
  if (!parent_) {
    publish_state(value);
    return;
  }
  parent_->set_runtime_min_frame_interval((int) (value + (value >= 0.0f ? 0.5f : -0.5f)));
  publish_state((float) parent_->get_min_frame_interval());
}

void RemoteWebViewTileSizeNumber::control(float value) {
  if (!parent_) {
    publish_state(value);
    return;
  }
  parent_->set_runtime_tile_size((int) (value + (value >= 0.0f ? 0.5f : -0.5f)));
  publish_state((float) parent_->get_tile_size());
}
#endif

#ifdef USE_SELECT
void RemoteWebViewRenderModeSelect::control(size_t index) {
  if (!parent_) {
    publish_state(index);
    return;
  }
  parent_->set_runtime_render_mode(index == 2 ? 3 : (index == 1 ? 2 : 1));
  publish_state(parent_->get_render_mode_name());
}
#endif

#ifdef USE_BUTTON
void RemoteWebViewRequestKeyframeButton::press_action() {
  if (parent_) parent_->request_full_frame();
}

void RemoteWebViewReconnectButton::press_action() {
  if (parent_) parent_->reconnect();
}
#endif

void RemoteWebView::set_server(const std::string &s) {
  auto pos = s.rfind(':');
  if (pos == std::string::npos || pos == s.size() - 1) {
    ESP_LOGE(TAG, "server must be host:port, got: %s", s.c_str());
    return;
  }
  server_host_ = s.substr(0, pos);
  server_port_ = atoi(s.c_str() + pos + 1);
  if (server_port_ <= 0 || server_port_ > 65535) {
    ESP_LOGE(TAG, "invalid port in server: %s", s.c_str());
    server_host_.clear();
    server_port_ = 0;
  }
}

void RemoteWebView::append_q_int_(std::string &s, const char *k, int v) {
  if (v < 0) return;
  s += (s.find('?') == std::string::npos) ? '?' : '&';
  char buf[32];
  snprintf(buf, sizeof(buf), "%s=%d", k, v);
  s += buf;
}

void RemoteWebView::append_q_float_(std::string &s, const char *k, float v) {
  if (v < 0.0f) return;
  s += (s.find('?') == std::string::npos) ? '?' : '&';
  char buf[32];
  
  snprintf(buf, sizeof(buf), "%s=%.2f", k, (double)v);
  s += buf;
}

void RemoteWebView::append_q_str_(std::string &s, const char *k, const char *v) {
  if (!v || !*v) return;
  s += (s.find('?') == std::string::npos) ? '?' : '&';
  s += k; s += '='; s += v;
}

std::string RemoteWebView::resolve_device_id_() const {
  if (!device_id_.empty()) return device_id_;

  uint8_t mac[6] = {0};
  esp_err_t err = ESP_FAIL;
  
#if ESP_IDF_VERSION_MAJOR >= 5
  err = esp_read_mac(mac, ESP_MAC_WIFI_STA);
  if (err != ESP_OK) {
    err = esp_read_mac(mac, ESP_MAC_BT);
  }
  if (err != ESP_OK) {
    err = esp_read_mac(mac, ESP_MAC_ETH);
  }
  if (err != ESP_OK) {
    err = esp_efuse_mac_get_default(mac);
  }
#else
  err = esp_efuse_mac_get_default(mac);
  if (err != ESP_OK) {
    err = esp_read_mac(mac, ESP_MAC_WIFI_STA);
  }
#endif

  if (err != ESP_OK) {
    ESP_LOGW(TAG, "Failed to read MAC address, using random ID");
    esp_fill_random(mac, sizeof(mac));
  }

  char buf[32];
  snprintf(buf, sizeof(buf), "esp32-%02x%02x%02x%02x%02x%02x",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  return std::string(buf);
}

std::string RemoteWebView::build_ws_uri_() const {
  std::string uri;
  uri = "ws://" + server_host_ + ":" + std::to_string(server_port_);
  uri += "/";

  const std::string id = resolve_device_id_();
  append_q_str_(uri, "id", id.c_str());

  append_q_int_(uri, "w", display_width_);
  append_q_int_(uri, "h", display_height_);

  append_q_int_(uri,   "r",    rotation_);
  append_q_int_(uri,   "ts",   tile_size_);
  append_q_int_(uri,   "fftc", full_frame_tile_count_);
  append_q_float_(uri, "ffat", full_frame_area_threshold_);
  append_q_int_(uri,   "ffe",  full_frame_every_);
  append_q_int_(uri,   "enf",  every_nth_frame_);
  append_q_int_(uri,   "mfi",  min_frame_interval_);
  append_q_int_(uri,   "q",    jpeg_quality_);
  append_q_str_(uri,   "rm",   render_mode_name_(render_mode_));
  append_q_int_(uri,   "mbpm", max_bytes_per_msg_);

  return uri;
}

const char *RemoteWebView::render_mode_name_(int mode) {
  switch (mode) {
    case 0: return "auto";
    case 1: return "jpeg";
    case 2: return "png";
    case 3: return "raw565";
    case 4: return "raw565_rle";
    default: return "jpeg";
  }
}

}  // namespace remote_webview
}  // namespace esphome
