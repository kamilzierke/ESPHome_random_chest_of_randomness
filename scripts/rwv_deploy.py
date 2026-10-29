"""Prepare an immutable RWV release, verify drift, apply, or restore one YAML.

Raw device YAML and backups stay in the ignored .audit directory. Preparation
never writes to HA. Applying requires a successful build receipt for this exact
candidate configuration and source identity. No flashing or service restarts.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

REPO = Path(__file__).resolve().parents[1]


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf8"))


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf8")


def confined(root: Path, relative: str) -> Path:
    root = root.resolve()
    candidate = (root / relative).resolve()
    if candidate == root or not candidate.is_relative_to(root):
        raise ValueError("Path leaves the selected root")
    return candidate


def sources(repo: Path = REPO) -> dict[str, bytes]:
    result = {}
    for directory in ("components/remote_webview", "examples/remote_webview_client"):
        for file in sorted((repo / directory).iterdir()):
            if file.suffix in {".py", ".h", ".cpp", ".yaml", ".yml"} and "secret" not in file.name.lower():
                result[file.relative_to(repo).as_posix()] = file.read_bytes()
    return result


def source_identity(repo: Path = REPO) -> tuple[str, dict[str, str]]:
    owned = sources(repo)
    # Bind test evidence to both sides of the protocol and the propagation
    # implementation, not just to the firmware's files.
    patterns = ["remote_webview_server/src/*.ts", "remote_webview_server/test/*.mjs", "remote_webview_server/package*.json",
                "remote_webview_server/tsconfig.json", "remote_webview_server/config.yaml",
                "remote_webview_server/Dockerfile", "remote_webview_server/run.sh",
                "scripts/*.py", "tests/*.py", "tests/*.cpp", "tests/fixtures/*.yaml",
                "tests/fixtures/*.json", "requirements-test.txt"]
    for pattern in patterns:
        for path in repo.glob(pattern):
            if path.is_file(): owned[path.relative_to(repo).as_posix()] = path.read_bytes()
    hashes = {name: sha(data) for name, data in owned.items()}
    return sha(json.dumps(hashes, sort_keys=True).encode()), hashes


def check_expected(root: Path, expected: dict[str, str]) -> None:
    for name, digest in expected.items():
        path = confined(root, name)
        if not path.is_file() or sha(path.read_bytes()) != digest:
            raise ValueError(f"Destination changed since audit: {name}")


def prepare(root: Path, baseline: Path, device: str, output: Path, repo: Path = REPO) -> Path:
    if Path(device).name != device or not device.endswith(".yaml"):
        raise ValueError("Device must be a root YAML filename")
    if output.exists():
        raise ValueError("Use a new preparation directory")
    expected = {row["path"]: row["sha256"] for row in read_json(baseline)}
    if device not in expected:
        raise ValueError("Device is absent from the audit manifest")
    check_expected(root, expected)
    original = confined(root, device).read_bytes()
    text = original.decode("utf8")
    identity, hashes = source_identity(repo)
    release = f"rwv-releases/{identity}"
    text, count = re.subn(r"(?m)^([ \t]*path:[ \t]*)my_components([ \t]*)(?=\r?$)",
                         lambda match: match[1] + release + "/components" + match[2], text)
    if count != 1:
        raise ValueError("Expected exactly one local my_components source; review this device manually")
    # This migration supports the audited B configuration. Other custom external
    # component selections must be reviewed instead of being silently rewritten.
    for package in ("common-rwv-client.yaml", "common-rwv-diagnostics.yaml", "common-rwv-power.yaml"):
        old = f"my_components/remote_webview/{package}"
        if text.count(old) != 1:
            raise ValueError(f"Expected exactly one include of {package}")
        text = text.replace(old, f"{release}/packages/{package}")
    output.mkdir(parents=True)
    (output / "private").mkdir()
    (output / "private/original.yaml").write_bytes(original)
    # ESPHome resolves !secret beside the root YAML. Keep the audited secret
    # file separate; the verifier exposes it there only during the private build.
    secret = root / "secrets.yaml"
    if secret.is_file():
        if "secrets.yaml" not in expected:
            raise ValueError("Secrets file is absent from the audit manifest")
        (output / "private/secrets.yaml").write_bytes(secret.read_bytes())
    files: dict[str, str] = {}
    for name, data in sources(repo).items():
        relative = ("components/remote_webview/" + Path(name).name
                    if name.startswith("components/") else "packages/" + Path(name).name)
        if relative == "packages/common-rwv-client.yaml":
            data = data.replace(b'rwv_source_id: "development"', f'rwv_source_id: "{identity}"'.encode())
        dest_name = release + "/" + relative
        dest = confined(output / "payload", dest_name)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        files[dest_name] = sha(data)
    manifest = {"source_id": identity, "source_files": hashes,
                "base_revision": subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip()}
    manifest_name = release + "/manifest.json"
    write_json(confined(output / "payload", manifest_name), manifest)
    files[manifest_name] = sha(confined(output / "payload", manifest_name).read_bytes())
    (output / "payload" / device).write_text(text, encoding="utf8", newline="")
    plan = {"format": 1, "target_root": str(root.resolve()), "device": device,
            "source_id": identity, "release": release, "files": files,
            "expected": expected, "old_config_sha256": sha(original),
            "new_config_sha256": sha((output / "payload" / device).read_bytes())}
    write_json(output / "plan.json", plan)
    return output / "plan.json"


def atomic_write(path: Path, data: bytes) -> None:
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".rwv-", suffix=".tmp", delete=False) as temp:
        temporary = Path(temp.name)
        try:
            temp.write(data)
            temp.flush()
            os.fsync(temp.fileno())
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def validate_plan(plan: dict) -> None:
    if plan.get("format") != 1 or not re.fullmatch(r"[0-9a-f]{64}", plan["source_id"]):
        raise ValueError("Unknown plan format")
    if plan["release"] != "rwv-releases/" + plan["source_id"]:
        raise ValueError("Invalid immutable release directory")
    if Path(plan["device"]).name != plan["device"] or not plan["device"].endswith(".yaml"):
        raise ValueError("Invalid device path")
    if any(not name.startswith(plan["release"] + "/") for name in plan["files"]):
        raise ValueError("Payload contains a file outside its release")


def apply(plan_path: Path, verification_path: Path) -> Path:
    plan = read_json(plan_path)
    validate_plan(plan)
    verification = read_json(verification_path)
    if (verification.get("source_id") != plan["source_id"] or
            verification.get("config_sha256") != plan["new_config_sha256"] or
            verification.get("compile_exit_code") != 0):
        raise ValueError("No successful compile receipt for this exact candidate")
    root = Path(plan["target_root"])
    stage = plan_path.parent
    check_expected(root, plan["expected"])
    payload = stage / "payload"
    candidate = (payload / plan["device"]).read_bytes()
    if sha(candidate) != plan["new_config_sha256"]:
        raise ValueError("Prepared YAML changed")
    for name, digest in plan["files"].items():
        src, dst = confined(payload, name), confined(root, name)
        if sha(src.read_bytes()) != digest:
            raise ValueError("Prepared payload changed")
        if dst.exists() and (not dst.is_file() or sha(dst.read_bytes()) != digest):
            raise ValueError("Immutable release already exists with different bytes")
    # All checks precede any target mutation. Partially prepared releases remain
    # inactive until the final YAML switch and can safely be resumed.
    for name, digest in plan["files"].items():
        src, dst = confined(payload, name), confined(root, name)
        dst.parent.mkdir(parents=True, exist_ok=True)
        if not dst.exists(): atomic_write(dst, src.read_bytes())
        if sha(dst.read_bytes()) != digest: raise ValueError("Target readback mismatch")
    device = confined(root, plan["device"])
    original = device.read_bytes()
    if sha(original) != plan["old_config_sha256"]:
        raise ValueError("Device changed before final switch")
    backup = stage / "private/original.yaml"
    if sha(backup.read_bytes()) != plan["old_config_sha256"]:
        raise ValueError("Original backup changed")
    atomic_write(device, candidate)
    if sha(device.read_bytes()) != plan["new_config_sha256"]:
        raise ValueError("Device YAML readback mismatch")
    receipt = stage / "receipt.json"
    write_json(receipt, {**plan, "backup": str(backup.resolve()), "applied": True})
    return receipt


def rollback(receipt_path: Path) -> None:
    receipt = read_json(receipt_path)
    validate_plan(receipt)
    device = confined(Path(receipt["target_root"]), receipt["device"])
    if sha(device.read_bytes()) != receipt["new_config_sha256"]:
        raise ValueError("Refusing to overwrite later device edits")
    original = Path(receipt["backup"]).read_bytes()
    if sha(original) != receipt["old_config_sha256"]:
        raise ValueError("Backup checksum mismatch")
    atomic_write(device, original)
    if sha(device.read_bytes()) != receipt["old_config_sha256"]:
        raise ValueError("Rollback readback mismatch")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    prep = sub.add_parser("prepare")
    prep.add_argument("--target-root", type=Path, required=True)
    prep.add_argument("--baseline", type=Path, required=True)
    prep.add_argument("--device", required=True)
    prep.add_argument("--output", type=Path, required=True)
    deploy = sub.add_parser("apply")
    deploy.add_argument("plan", type=Path)
    deploy.add_argument("--verification", type=Path, required=True)
    restore = sub.add_parser("rollback")
    restore.add_argument("receipt", type=Path)
    sub.add_parser("identity")
    args = parser.parse_args()
    if args.command == "prepare":
        print(prepare(args.target_root, args.baseline, args.device, args.output))
    elif args.command == "apply": print(apply(args.plan, args.verification))
    elif args.command == "rollback": rollback(args.receipt); print("Original YAML restored; immutable release retained")
    else: print(source_identity()[0])


if __name__ == "__main__": main()
