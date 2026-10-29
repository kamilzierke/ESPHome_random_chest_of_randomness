import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("rwv_deploy", Path(__file__).resolve().parents[1] / "scripts/rwv_deploy.py")
DEPLOY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DEPLOY)


class DeploymentTest(unittest.TestCase):
    def setUp(self):
        audit = Path(__file__).resolve().parents[1] / ".audit"
        audit.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=audit)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "ha"
        self.root.mkdir()
        self.device = "device.yaml"
        self.original = ("external_components:\n  - source:\n      type: local\n      path: my_components\n"
                         "packages:\n" + "".join(f"  p{i}: !include my_components/remote_webview/{name}\n" for i, name in enumerate([
                             "common-rwv-client.yaml", "common-rwv-diagnostics.yaml", "common-rwv-power.yaml"])) +
                         "wifi:\n  password: private-test-only\n").encode()
        (self.root / self.device).write_bytes(self.original)
        self.baseline = Path(self.temp.name) / "baseline.json"
        DEPLOY.write_json(self.baseline, [{"path": self.device, "sha256": DEPLOY.sha(self.original)}])

    def prepare(self):
        return DEPLOY.prepare(self.root, self.baseline, self.device, Path(self.temp.name) / "candidate")

    def verification(self, plan):
        data = DEPLOY.read_json(plan)
        receipt = plan.parent / "verification.json"
        DEPLOY.write_json(receipt, {"source_id": data["source_id"], "config_sha256": data["new_config_sha256"], "compile_exit_code": 0})
        return receipt

    def test_prepare_is_read_only_and_roundtrip_restores_exact_original(self):
        plan = self.prepare()
        self.assertEqual(list(self.root.iterdir()), [self.root / self.device])
        self.assertEqual((self.root / self.device).read_bytes(), self.original)
        receipt = DEPLOY.apply(plan, self.verification(plan))
        new = (self.root / self.device).read_bytes()
        self.assertIn(b"private-test-only", new)
        self.assertIn(b"rwv-releases/", new)
        DEPLOY.rollback(receipt)
        self.assertEqual((self.root / self.device).read_bytes(), self.original)

    def test_changed_destination_aborts_before_creating_release(self):
        plan = self.prepare()
        (self.root / self.device).write_bytes(b"later edit")
        with self.assertRaisesRegex(ValueError, "changed since audit"):
            DEPLOY.apply(plan, self.verification(plan))
        self.assertFalse((self.root / "rwv-releases").exists())

    def test_tampered_payload_or_failed_compile_is_rejected(self):
        plan = self.prepare()
        verification = self.verification(plan)
        value = DEPLOY.read_json(verification)
        value["compile_exit_code"] = 1
        DEPLOY.write_json(verification, value)
        with self.assertRaisesRegex(ValueError, "successful compile"):
            DEPLOY.apply(plan, verification)
        verification = self.verification(plan)
        (plan.parent / "payload" / self.device).write_bytes(b"tampered")
        with self.assertRaisesRegex(ValueError, "YAML changed"):
            DEPLOY.apply(plan, verification)

    def test_rollback_does_not_overwrite_later_edits(self):
        plan = self.prepare()
        receipt = DEPLOY.apply(plan, self.verification(plan))
        (self.root / self.device).write_bytes(b"later edit")
        with self.assertRaisesRegex(ValueError, "later device edits"):
            DEPLOY.rollback(receipt)

    def test_rejects_path_escape(self):
        with self.assertRaises(ValueError):
            DEPLOY.confined(self.root, "../outside.yaml")


if __name__ == "__main__": unittest.main()
