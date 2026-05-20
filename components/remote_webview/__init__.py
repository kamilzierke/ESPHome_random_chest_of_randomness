import re
import esphome.codegen as cg
import esphome.config_validation as cv
from esphome.components import binary_sensor, button, display, sensor, switch, touchscreen
from esphome.components.esp32 import add_idf_component
from esphome.components.display import validate_rotation
from esphome.const import (
    CONF_ID,
    CONF_DISPLAY_ID,
    CONF_URL,
    CONF_ROTATION,
    DEVICE_CLASS_CONNECTIVITY,
    DEVICE_CLASS_DURATION,
    ENTITY_CATEGORY_DIAGNOSTIC,
    ICON_COUNTER,
    ICON_TIMER,
    STATE_CLASS_MEASUREMENT,
    UNIT_BYTES,
    UNIT_MILLISECOND,
)


CONF_DEVICE_ID = "device_id"
CONF_TOUCHSCREEN_ID = "touchscreen_id"
CONF_SERVER = "server"
CONF_TILE_SIZE = "tile_size"
CONF_FULL_FRAME_TILE_COUNT = "full_frame_tile_count"
CONF_FULL_FRAME_AREA_THRESHOLD = "full_frame_area_threshold"
CONF_FULL_FRAME_EVERY = "full_frame_every"
CONF_EVERY_NTH_FRAME = "every_nth_frame"
CONF_MIN_FRAME_INTERVAL = "min_frame_interval"
CONF_JPEG_QUALITY = "jpeg_quality"
CONF_MAX_BYTES_PER_MSG = "max_bytes_per_msg"
CONF_BIG_ENDIAN = "big_endian"
CONF_LATEST_FRAME_WINS = "latest_frame_wins"
CONF_TOUCH_WAKE_PASSTHROUGH = "touch_wake_passthrough"
CONF_STREAM_CONTROL_ENABLED = "stream_control_enabled"
CONF_TELEMETRY_LOG_INTERVAL_MS = "telemetry_log_interval_ms"
CONF_SENSORS = "sensors"
CONF_BINARY_SENSORS = "binary_sensors"
CONF_DECODE_AVG_MS = "decode_avg_ms"
CONF_LAST_DECODE_MS = "last_decode_ms"
CONF_RENDER_AVG_MS = "render_avg_ms"
CONF_DECODE_DROPS = "decode_drops"
CONF_RECONNECT_COUNT = "reconnect_count"
CONF_LAST_FRAME_ID = "last_frame_id"
CONF_BYTES_RECEIVED = "bytes_received"
CONF_FRAMES_RECEIVED = "frames_received"
CONF_TILES_RECEIVED = "tiles_received"
CONF_FPS = "fps"
CONF_QUEUE_DEPTH = "queue_depth"
CONF_CONNECTED = "connected"
CONF_STREAM_PAUSED = "stream_paused"
CONF_TOUCH_ENABLED = "touch_enabled"
CONF_CONTROLS = "controls"
CONF_PAUSE_SWITCH = "pause_switch"
CONF_TOUCH_SWITCH = "touch_switch"
CONF_REQUEST_KEYFRAME_BUTTON = "request_keyframe_button"
CONF_RECONNECT_BUTTON = "reconnect_button"
CONF_DEBUG_OVERLAY_SWITCH = "debug_overlay_switch"

_SERVER_RE = re.compile(
    r"^(?P<host>[A-Za-z0-9](?:[A-Za-z0-9\-\.]*[A-Za-z0-9])?)\:(?P<port>\d{1,5})$"
)

DEPENDENCIES = ["display"]


def AUTO_LOAD(config):
    components = []
    if CONF_SENSORS in config:
        components.append("sensor")
    if CONF_BINARY_SENSORS in config:
        components.append("binary_sensor")
    controls = config.get(CONF_CONTROLS, {})
    if any(k in controls for k in (CONF_PAUSE_SWITCH, CONF_TOUCH_SWITCH, CONF_DEBUG_OVERLAY_SWITCH)):
        components.append("switch")
    if any(k in controls for k in (CONF_REQUEST_KEYFRAME_BUTTON, CONF_RECONNECT_BUTTON)):
        components.append("button")
    return components

DIAGNOSTIC_COUNT_SCHEMA = sensor.sensor_schema(
    accuracy_decimals=0,
    icon=ICON_COUNTER,
    state_class=STATE_CLASS_MEASUREMENT,
    entity_category=ENTITY_CATEGORY_DIAGNOSTIC,
)

DIAGNOSTIC_MS_SCHEMA = sensor.sensor_schema(
    unit_of_measurement=UNIT_MILLISECOND,
    accuracy_decimals=0,
    device_class=DEVICE_CLASS_DURATION,
    state_class=STATE_CLASS_MEASUREMENT,
    entity_category=ENTITY_CATEGORY_DIAGNOSTIC,
    icon=ICON_TIMER,
)

DIAGNOSTIC_BINARY_SCHEMA = binary_sensor.binary_sensor_schema(
    entity_category=ENTITY_CATEGORY_DIAGNOSTIC,
)

SENSOR_SETTERS = {
    CONF_DECODE_AVG_MS: "set_decode_avg_ms_sensor",
    CONF_LAST_DECODE_MS: "set_last_decode_ms_sensor",
    CONF_RENDER_AVG_MS: "set_render_avg_ms_sensor",
    CONF_DECODE_DROPS: "set_decode_drops_sensor",
    CONF_RECONNECT_COUNT: "set_reconnect_count_sensor",
    CONF_LAST_FRAME_ID: "set_last_frame_id_sensor",
    CONF_BYTES_RECEIVED: "set_bytes_received_sensor",
    CONF_FRAMES_RECEIVED: "set_frames_received_sensor",
    CONF_TILES_RECEIVED: "set_tiles_received_sensor",
    CONF_FPS: "set_fps_sensor",
    CONF_QUEUE_DEPTH: "set_queue_depth_sensor",
}

BINARY_SENSOR_SETTERS = {
    CONF_CONNECTED: "set_connected_binary_sensor",
    CONF_STREAM_PAUSED: "set_stream_paused_binary_sensor",
    CONF_TOUCH_ENABLED: "set_touch_enabled_binary_sensor",
}

CONTROL_SWITCH_SETTERS = {
    CONF_PAUSE_SWITCH: "set_pause_switch",
    CONF_TOUCH_SWITCH: "set_touch_switch",
    CONF_DEBUG_OVERLAY_SWITCH: "set_debug_overlay_switch",
}

CONTROL_BUTTON_SETTERS = {
    CONF_REQUEST_KEYFRAME_BUTTON: "set_request_keyframe_button",
    CONF_RECONNECT_BUTTON: "set_reconnect_button",
}


def validate_host_port(value):
    s = cv.string_strict(value).strip()
    m = _SERVER_RE.match(s)
    if not m:
        raise cv.Invalid("server must be in 'host:port' format (no IPv6, no trailing colon)")

    host = m.group("host")
    port = int(m.group("port"), 10)

    if not (1 <= port <= 65535):
        raise cv.Invalid("port must be between 1 and 65535")

    return f"{host}:{port}"


ns = cg.esphome_ns.namespace("remote_webview")
RemoteWebView = ns.class_("RemoteWebView", cg.Component)
RemoteWebViewPauseSwitch = ns.class_("RemoteWebViewPauseSwitch", switch.Switch)
RemoteWebViewTouchSwitch = ns.class_("RemoteWebViewTouchSwitch", switch.Switch)
RemoteWebViewDebugOverlaySwitch = ns.class_(
    "RemoteWebViewDebugOverlaySwitch", switch.Switch
)
RemoteWebViewRequestKeyframeButton = ns.class_(
    "RemoteWebViewRequestKeyframeButton", button.Button
)
RemoteWebViewReconnectButton = ns.class_("RemoteWebViewReconnectButton", button.Button)

CONFIG_SCHEMA = cv.Schema(
    {
        cv.GenerateID(): cv.declare_id(RemoteWebView),
        cv.GenerateID(CONF_DISPLAY_ID): cv.use_id(display.Display),
        cv.GenerateID(CONF_TOUCHSCREEN_ID): cv.use_id(touchscreen.Touchscreen),
        cv.Required(CONF_SERVER): validate_host_port,
        cv.Required(CONF_URL): cv.string,
        cv.Optional(CONF_DEVICE_ID): cv.string,
        cv.Optional(CONF_TILE_SIZE): cv.int_,
        cv.Optional(CONF_FULL_FRAME_TILE_COUNT): cv.int_,
        cv.Optional(CONF_FULL_FRAME_AREA_THRESHOLD): cv.float_,
        cv.Optional(CONF_FULL_FRAME_EVERY): cv.int_,
        cv.Optional(CONF_EVERY_NTH_FRAME): cv.int_,
        cv.Optional(CONF_MIN_FRAME_INTERVAL): cv.int_,
        cv.Optional(CONF_JPEG_QUALITY): cv.int_,
        cv.Optional(CONF_MAX_BYTES_PER_MSG): cv.int_,
        cv.Optional(CONF_BIG_ENDIAN): cv.boolean,
        cv.Optional(CONF_ROTATION): validate_rotation,
        cv.Optional(CONF_LATEST_FRAME_WINS, default=False): cv.boolean,
        cv.Optional(CONF_TOUCH_WAKE_PASSTHROUGH, default=False): cv.boolean,
        cv.Optional(CONF_STREAM_CONTROL_ENABLED, default=False): cv.boolean,
        cv.Optional(CONF_TELEMETRY_LOG_INTERVAL_MS, default=0): cv.int_range(min=0),
        cv.Optional(CONF_SENSORS): cv.Schema(
            {
                cv.Optional(CONF_DECODE_AVG_MS): DIAGNOSTIC_MS_SCHEMA,
                cv.Optional(CONF_LAST_DECODE_MS): DIAGNOSTIC_MS_SCHEMA,
                cv.Optional(CONF_RENDER_AVG_MS): DIAGNOSTIC_MS_SCHEMA,
                cv.Optional(CONF_DECODE_DROPS): DIAGNOSTIC_COUNT_SCHEMA,
                cv.Optional(CONF_RECONNECT_COUNT): DIAGNOSTIC_COUNT_SCHEMA,
                cv.Optional(CONF_LAST_FRAME_ID): DIAGNOSTIC_COUNT_SCHEMA,
                cv.Optional(CONF_BYTES_RECEIVED): sensor.sensor_schema(
                    unit_of_measurement=UNIT_BYTES,
                    accuracy_decimals=0,
                    icon=ICON_COUNTER,
                    state_class=STATE_CLASS_MEASUREMENT,
                    entity_category=ENTITY_CATEGORY_DIAGNOSTIC,
                ),
                cv.Optional(CONF_FRAMES_RECEIVED): DIAGNOSTIC_COUNT_SCHEMA,
                cv.Optional(CONF_TILES_RECEIVED): DIAGNOSTIC_COUNT_SCHEMA,
                cv.Optional(CONF_FPS): sensor.sensor_schema(
                    unit_of_measurement="fps",
                    accuracy_decimals=1,
                    icon=ICON_COUNTER,
                    state_class=STATE_CLASS_MEASUREMENT,
                    entity_category=ENTITY_CATEGORY_DIAGNOSTIC,
                ),
                cv.Optional(CONF_QUEUE_DEPTH): DIAGNOSTIC_COUNT_SCHEMA,
            }
        ),
        cv.Optional(CONF_BINARY_SENSORS): cv.Schema(
            {
                cv.Optional(CONF_CONNECTED): binary_sensor.binary_sensor_schema(
                    device_class=DEVICE_CLASS_CONNECTIVITY,
                    entity_category=ENTITY_CATEGORY_DIAGNOSTIC,
                ),
                cv.Optional(CONF_STREAM_PAUSED): DIAGNOSTIC_BINARY_SCHEMA,
                cv.Optional(CONF_TOUCH_ENABLED): DIAGNOSTIC_BINARY_SCHEMA,
            }
        ),
        cv.Optional(CONF_CONTROLS): cv.Schema(
            {
                cv.Optional(CONF_PAUSE_SWITCH): switch.switch_schema(
                    RemoteWebViewPauseSwitch,
                    entity_category=ENTITY_CATEGORY_DIAGNOSTIC,
                ),
                cv.Optional(CONF_TOUCH_SWITCH): switch.switch_schema(
                    RemoteWebViewTouchSwitch,
                    entity_category=ENTITY_CATEGORY_DIAGNOSTIC,
                ),
                cv.Optional(CONF_REQUEST_KEYFRAME_BUTTON): button.button_schema(
                    RemoteWebViewRequestKeyframeButton,
                    entity_category=ENTITY_CATEGORY_DIAGNOSTIC,
                ),
                cv.Optional(CONF_RECONNECT_BUTTON): button.button_schema(
                    RemoteWebViewReconnectButton,
                    entity_category=ENTITY_CATEGORY_DIAGNOSTIC,
                ),
                cv.Optional(CONF_DEBUG_OVERLAY_SWITCH): switch.switch_schema(
                    RemoteWebViewDebugOverlaySwitch,
                    entity_category=ENTITY_CATEGORY_DIAGNOSTIC,
                ),
            }
        ),
    }
).extend(cv.COMPONENT_SCHEMA)


async def to_code(config):
    cg.add_library("JPEGDEC", "1.8.4", "https://github.com/bitbank2/JPEGDEC#1.8.4")
    add_idf_component(name="espressif/esp_websocket_client", ref="1.5.0")
    add_idf_component(name="espressif/esp-dsp", ref="1.7.1")

    var = cg.new_Pvariable(config[CONF_ID])

    disp = await cg.get_variable(config[CONF_DISPLAY_ID])
    cg.add(var.set_display(disp))
    cg.add(var.set_server(config[CONF_SERVER]))
    cg.add(var.set_url(config[CONF_URL]))

    if CONF_TOUCHSCREEN_ID in config:
        ts = await cg.get_variable(config[CONF_TOUCHSCREEN_ID])
        cg.add(var.set_touchscreen(ts))

    if CONF_DEVICE_ID in config:
        cg.add(var.set_device_id(config[CONF_DEVICE_ID]))
    if CONF_TILE_SIZE in config:
        cg.add(var.set_tile_size(config[CONF_TILE_SIZE]))
    if CONF_FULL_FRAME_TILE_COUNT in config:
        cg.add(var.set_full_frame_tile_count(config[CONF_FULL_FRAME_TILE_COUNT]))
    if CONF_FULL_FRAME_AREA_THRESHOLD in config:
        cg.add(var.set_full_frame_area_threshold(config[CONF_FULL_FRAME_AREA_THRESHOLD]))
    if CONF_FULL_FRAME_EVERY in config:
        cg.add(var.set_full_frame_every(config[CONF_FULL_FRAME_EVERY]))
    if CONF_EVERY_NTH_FRAME in config:
        cg.add(var.set_every_nth_frame(config[CONF_EVERY_NTH_FRAME]))
    if CONF_MIN_FRAME_INTERVAL in config:
        cg.add(var.set_min_frame_interval(config[CONF_MIN_FRAME_INTERVAL]))
    if CONF_JPEG_QUALITY in config:
        cg.add(var.set_jpeg_quality(config[CONF_JPEG_QUALITY]))
    if CONF_MAX_BYTES_PER_MSG in config:
        cg.add(var.set_max_bytes_per_msg(config[CONF_MAX_BYTES_PER_MSG]))
    if CONF_BIG_ENDIAN in config:
        cg.add(var.set_big_endian(config[CONF_BIG_ENDIAN]))
    if CONF_ROTATION in config:
        cg.add(var.set_rotation(config[CONF_ROTATION]))

    cg.add(var.set_latest_frame_wins(config[CONF_LATEST_FRAME_WINS]))
    cg.add(var.set_touch_wake_passthrough(config[CONF_TOUCH_WAKE_PASSTHROUGH]))
    cg.add(var.set_stream_control_enabled(config[CONF_STREAM_CONTROL_ENABLED]))
    cg.add(var.set_telemetry_log_interval_ms(config[CONF_TELEMETRY_LOG_INTERVAL_MS]))

    for key, setter in SENSOR_SETTERS.items():
        if key in config.get(CONF_SENSORS, {}):
            sens = await sensor.new_sensor(config[CONF_SENSORS][key])
            cg.add(getattr(var, setter)(sens))

    for key, setter in BINARY_SENSOR_SETTERS.items():
        if key in config.get(CONF_BINARY_SENSORS, {}):
            sens = await binary_sensor.new_binary_sensor(config[CONF_BINARY_SENSORS][key])
            cg.add(getattr(var, setter)(sens))

    controls = config.get(CONF_CONTROLS, {})
    for key, setter in CONTROL_SWITCH_SETTERS.items():
        if key in controls:
            ctrl = await switch.new_switch(controls[key])
            cg.add(ctrl.set_parent(var))
            cg.add(getattr(var, setter)(ctrl))

    for key, setter in CONTROL_BUTTON_SETTERS.items():
        if key in controls:
            ctrl = await button.new_button(controls[key])
            cg.add(ctrl.set_parent(var))
            cg.add(getattr(var, setter)(ctrl))

    await cg.register_component(var, config)
