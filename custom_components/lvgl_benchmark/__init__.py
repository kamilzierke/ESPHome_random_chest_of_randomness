import esphome.codegen as cg
import esphome.config_validation as cv
from esphome import pins
from esphome.const import CONF_ID

AUTO_LOAD = ["power_supply"]

lvgl_benchmark_ns = cg.esphome_ns.namespace("lvgl_benchmark")
LvglBenchmarkComponent = lvgl_benchmark_ns.class_("LvglBenchmarkComponent", cg.Component)

CONF_BACKLIGHT_PIN = "backlight_pin"
CONF_CS_PIN = "cs_pin"
CONF_CLK_PIN = "clk_pin"
CONF_D0_PIN = "d0_pin"
CONF_D1_PIN = "d1_pin"
CONF_D2_PIN = "d2_pin"
CONF_D3_PIN = "d3_pin"

CONFIG_SCHEMA = cv.Schema(
    {
        cv.GenerateID(): cv.declare_id(LvglBenchmarkComponent),
        cv.Required(CONF_BACKLIGHT_PIN): pins.gpio_output_pin_schema,
        cv.Required(CONF_CS_PIN): pins.internal_gpio_output_pin_number,
        cv.Required(CONF_CLK_PIN): pins.internal_gpio_output_pin_number,
        cv.Required(CONF_D0_PIN): pins.internal_gpio_output_pin_number,
        cv.Required(CONF_D1_PIN): pins.internal_gpio_output_pin_number,
        cv.Required(CONF_D2_PIN): pins.internal_gpio_output_pin_number,
        cv.Required(CONF_D3_PIN): pins.internal_gpio_output_pin_number,
    }
).extend(cv.COMPONENT_SCHEMA)


async def to_code(config):
    backlight_pin = await cg.gpio_pin_expression(config[CONF_BACKLIGHT_PIN])
    var = cg.new_Pvariable(
        config[CONF_ID],
        backlight_pin,
        config[CONF_CS_PIN],
        config[CONF_CLK_PIN],
        config[CONF_D0_PIN],
        config[CONF_D1_PIN],
        config[CONF_D2_PIN],
        config[CONF_D3_PIN],
    )
    await cg.register_component(var, config)
