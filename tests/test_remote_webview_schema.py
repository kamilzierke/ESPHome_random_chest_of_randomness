import importlib.util
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
COMPONENT = ROOT / "components" / "remote_webview" / "__init__.py"


def load_remote_webview():
    spec = importlib.util.spec_from_file_location("remote_webview_external", COMPONENT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class RemoteWebViewSchemaTest(unittest.TestCase):
    def test_accepts_optional_diagnostic_entities(self):
        remote_webview = load_remote_webview()

        config = remote_webview.CONFIG_SCHEMA(
            {
                "id": "rwv",
                "display_id": "panel_display",
                "touchscreen_id": "panel_touch",
                "server": "192.168.1.100:8081",
                "url": "http://127.0.0.1:8123/dashboard-tablet01/0",
                "sensors": {
                    "decode_avg_ms": {"name": "RWV Decode Avg"},
                    "last_decode_ms": {"name": "RWV Last Decode"},
                    "render_avg_ms": {"name": "RWV Render Avg"},
                    "decode_drops": {"name": "RWV Decode Drops"},
                    "reconnect_count": {"name": "RWV Reconnect Count"},
                    "last_frame_id": {"name": "RWV Last Frame ID"},
                    "bytes_received": {"name": "RWV Bytes Received"},
                    "frames_received": {"name": "RWV Frames Received"},
                    "tiles_received": {"name": "RWV Tiles Received"},
                    "fps": {"name": "RWV FPS"},
                    "queue_depth": {"name": "RWV Queue Depth"},
                },
                "binary_sensors": {
                    "connected": {"name": "RWV Connected"},
                    "stream_paused": {"name": "RWV Stream Paused"},
                    "touch_enabled": {"name": "RWV Touch Enabled"},
                },
            }
        )

        self.assertIn("sensors", config)
        self.assertIn("binary_sensors", config)
        self.assertEqual(remote_webview.AUTO_LOAD(config), ["sensor", "binary_sensor"])

    def test_does_not_autoload_diagnostic_components_without_entities(self):
        remote_webview = load_remote_webview()

        config = remote_webview.CONFIG_SCHEMA(
            {
                "id": "rwv",
                "display_id": "panel_display",
                "touchscreen_id": "panel_touch",
                "server": "192.168.1.100:8081",
                "url": "http://127.0.0.1:8123/dashboard-tablet01/0",
            }
        )

        self.assertEqual(remote_webview.AUTO_LOAD(config), [])

    def test_accepts_optional_control_entities(self):
        remote_webview = load_remote_webview()

        config = remote_webview.CONFIG_SCHEMA(
            {
                "id": "rwv",
                "display_id": "panel_display",
                "touchscreen_id": "panel_touch",
                "server": "192.168.1.100:8081",
                "url": "http://127.0.0.1:8123/dashboard-tablet01/0",
                "controls": {
                    "pause_switch": {"name": "RWV Pause Stream"},
                    "touch_switch": {"name": "RWV Touch Enabled"},
                    "request_keyframe_button": {"name": "RWV Request Keyframe"},
                    "reconnect_button": {"name": "RWV Reconnect"},
                    "debug_overlay_switch": {"name": "RWV Debug Overlay"},
                },
            }
        )

        self.assertIn("controls", config)
        self.assertEqual(remote_webview.AUTO_LOAD(config), ["switch", "button"])


if __name__ == "__main__":
    unittest.main()
