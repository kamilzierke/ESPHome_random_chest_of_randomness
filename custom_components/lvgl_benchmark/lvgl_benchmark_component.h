#pragma once

#include "esphome.h"
#include <Arduino_GFX_Library.h>
#include <lvgl.h>

namespace esphome {
namespace lvgl_benchmark {

class LvglBenchmarkComponent : public Component {
 public:
  LvglBenchmarkComponent(uint8_t backlight_pin, uint8_t cs, uint8_t clk, uint8_t d0, uint8_t d1, uint8_t d2, uint8_t d3);

  void setup() override;
  void loop() override;
  void dump_config() override;

 protected:
  static void flush_callback(lv_disp_drv_t *disp, const lv_area_t *area, lv_color_t *color_p);
  void flush_(const lv_area_t *area, lv_color_t *color_p);
  bool allocate_draw_buffer_();
  void init_lvgl_display_();
  void create_boot_screen_();

  const uint8_t backlight_pin_;
  const uint8_t cs_;
  const uint8_t clk_;
  const uint8_t d0_;
  const uint8_t d1_;
  const uint8_t d2_;
  const uint8_t d3_;

  Arduino_DataBus *bus_{nullptr};
  Arduino_GFX *panel_{nullptr};
  Arduino_Canvas *canvas_{nullptr};

  lv_disp_draw_buf_t draw_buf_{};
  lv_color_t *buf1_{nullptr};
  lv_disp_drv_t disp_drv_{};

  uint16_t width_{480};
  uint16_t height_{272};
};

}  // namespace lvgl_benchmark
}  // namespace esphome

