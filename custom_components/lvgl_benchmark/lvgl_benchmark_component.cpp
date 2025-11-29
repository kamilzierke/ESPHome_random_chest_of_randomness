#include "lvgl_benchmark_component.h"

#include "esp_heap_caps.h"

namespace esphome {
namespace lvgl_benchmark {

static const char *const TAG = "lvgl_benchmark";

LvglBenchmarkComponent::LvglBenchmarkComponent(uint8_t backlight_pin, uint8_t cs, uint8_t clk, uint8_t d0,
                                               uint8_t d1, uint8_t d2, uint8_t d3)
    : backlight_pin_(backlight_pin), cs_(cs), clk_(clk), d0_(d0), d1_(d1), d2_(d2), d3_(d3) {}

void LvglBenchmarkComponent::setup() {
  ESP_LOGI(TAG, "Initializing NV3041A display via QSPI");

  bus_ = new Arduino_ESP32QSPI(cs_, clk_, d0_, d1_, d2_, d3_);
  panel_ = new Arduino_NV3041A(bus_, GFX_NOT_DEFINED /* rst */, 0 /* rotation */, true /* IPS */);
  canvas_ = new Arduino_Canvas(width_, height_, panel_);

  if (!canvas_->begin()) {
    ESP_LOGE(TAG, "Display init failed");
    return;
  }

  pinMode(backlight_pin_, OUTPUT);
  digitalWrite(backlight_pin_, HIGH);

  canvas_->fillScreen(BLACK);

  lv_init();
  if (!this->allocate_draw_buffer_()) {
    ESP_LOGE(TAG, "Failed to allocate LVGL draw buffer");
    return;
  }

  this->init_lvgl_display_();
  this->create_boot_screen_();

  ESP_LOGI(TAG, "LVGL bootstrap finished");
}

void LvglBenchmarkComponent::loop() {
  lv_timer_handler();
  canvas_->flush();
  delay(5);
}

void LvglBenchmarkComponent::flush_callback(lv_disp_drv_t *disp, const lv_area_t *area, lv_color_t *color_p) {
  auto *self = static_cast<LvglBenchmarkComponent *>(disp->user_data);
  if (self == nullptr) {
    lv_disp_flush_ready(disp);
    return;
  }
  self->flush_(area, color_p);
}

void LvglBenchmarkComponent::flush_(const lv_area_t *area, lv_color_t *color_p) {
  uint32_t w = (area->x2 - area->x1 + 1);
  uint32_t h = (area->y2 - area->y1 + 1);
  canvas_->draw16bitRGBBitmap(area->x1, area->y1, (uint16_t *)&color_p->full, w, h);
  lv_disp_flush_ready(&disp_drv_);
}

bool LvglBenchmarkComponent::allocate_draw_buffer_() {
  size_t buf_size = static_cast<size_t>(width_) * 40;  // few lines to conserve RAM
  buf1_ = reinterpret_cast<lv_color_t *>(heap_caps_malloc(sizeof(lv_color_t) * buf_size, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT));
  if (buf1_ == nullptr) {
    buf1_ = reinterpret_cast<lv_color_t *>(heap_caps_malloc(sizeof(lv_color_t) * buf_size, MALLOC_CAP_8BIT));
  }
  if (buf1_ == nullptr) {
    ESP_LOGE(TAG, "LVGL buffer allocation failed");
    return false;
  }
  lv_disp_draw_buf_init(&draw_buf_, buf1_, nullptr, buf_size);
  return true;
}

void LvglBenchmarkComponent::init_lvgl_display_() {
  lv_disp_drv_init(&disp_drv_);
  disp_drv_.hor_res = width_;
  disp_drv_.ver_res = height_;
  disp_drv_.flush_cb = &LvglBenchmarkComponent::flush_callback;
  disp_drv_.draw_buf = &draw_buf_;
  disp_drv_.user_data = this;
  lv_disp_drv_register(&disp_drv_);
}

void LvglBenchmarkComponent::create_boot_screen_() {
  lv_obj_t *label = lv_label_create(lv_scr_act());
  lv_label_set_text(label, "LVGL benchmark\nStage 1: display init");
  lv_obj_align(label, LV_ALIGN_CENTER, 0, 0);
}

void LvglBenchmarkComponent::dump_config() {
  ESP_LOGCONFIG(TAG, "LVGL Benchmark display:");
  ESP_LOGCONFIG(TAG, "  Resolution: %ux%u", width_, height_);
  ESP_LOGCONFIG(TAG, "  QSPI: cs=%u clk=%u d0=%u d1=%u d2=%u d3=%u", cs_, clk_, d0_, d1_, d2_, d3_);
  ESP_LOGCONFIG(TAG, "  Backlight pin: %u", backlight_pin_);
}

}  // namespace lvgl_benchmark
}  // namespace esphome

