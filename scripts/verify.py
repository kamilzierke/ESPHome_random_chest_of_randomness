"""Run isolated tests, optionally compile fixtures or an exact deployment plan.

Usage: .venv-audit/Scripts/python scripts/verify.py [--compile] [--fresh]
       .venv-audit/Scripts/python scripts/verify.py --plan .audit/candidate/plan.json
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

from rwv_deploy import source_identity, read_json, write_json, sha, validate_plan

ROOT = Path(__file__).resolve().parents[1]


def environment() -> dict[str, str]:
    env = os.environ.copy()
    for key, directory in {"ESPHOME_ESP_IDF_PREFIX": ".cache/idf", "UV_CACHE_DIR": ".cache/uv",
                           "PIP_CACHE_DIR": ".cache/pip", "PLATFORMIO_CORE_DIR": ".platformio",
                           "ESPHOME_DATA_DIR": ".esphome", "ESPHOME_BUILD_PATH": ".b",
                           "npm_config_cache": ".cache/npm"}.items():
        env[key] = str(ROOT / directory)
    if os.name == "nt":
        # Per-process Git configuration; certificate verification remains on.
        count = int(env.get("GIT_CONFIG_COUNT", "0"))
        for key, value in (("http.sslBackend", "openssl"), ("core.longpaths", "true")):
            env[f"GIT_CONFIG_KEY_{count}"] = key
            env[f"GIT_CONFIG_VALUE_{count}"] = value
            count += 1
        env["GIT_CONFIG_COUNT"] = str(count)
    return env


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compile", action="store_true")
    parser.add_argument("--fresh", action="store_true", help="Build in a new directory, without deleting any old builds")
    parser.add_argument("--build-root", type=Path, help="Reuse a selected build directory under this repository's .b")
    parser.add_argument("--p4", action="store_true", help="Also verify the optional P4 overlay; import its pinned GSL3680 dependency first")
    parser.add_argument("--integration", action="store_true", help="Run the local Chromium/WebSocket smoke test")
    parser.add_argument("--plan", type=Path)
    args = parser.parse_args()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = ROOT / ".audit" / "verification" / stamp
    out.mkdir(parents=True)
    env = environment()
    if args.fresh: env["ESPHOME_BUILD_PATH"] = str(ROOT / ".b" / stamp)
    if args.build_root:
        chosen = args.build_root.resolve()
        if not chosen.is_relative_to((ROOT / ".b").resolve()):
            raise SystemExit("--build-root must be below this repository's .b")
        if args.fresh: raise SystemExit("Use --fresh or --build-root")
        env["ESPHOME_BUILD_PATH"] = str(chosen)
    identity, hashes = source_identity()
    results = []

    def run(name: str, command: list[str], cwd: Path = ROOT) -> None:
        log = out / (name + ".log")
        with log.open("wb") as stream:
            result = subprocess.run(command, cwd=cwd, env=env, stdout=stream, stderr=subprocess.STDOUT)
        results.append({"name": name, "command": command, "cwd": str(cwd), "exit_code": result.returncode,
                        "log": str(log), "log_sha256": sha(log.read_bytes())})
        write_json(out / "results.json", {"source_id": identity, "source_files": hashes, "results": results})
        print(name + (": PASS" if result.returncode == 0 else f": FAIL ({log})"), flush=True)
        if result.returncode:
            raise SystemExit(result.returncode)

    run("python-tests", [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-v"])
    compiler = shutil.which("g++")
    if not compiler: raise SystemExit("Install a C++17 compiler (g++); protocol tests were not run")
    binary = out / ("protocol-test.exe" if os.name == "nt" else "protocol-test")
    run("protocol-compile", [compiler, "-std=c++17", "-Wall", "-Wextra", "-Werror", "tests/protocol_test.cpp", "-o", str(binary)])
    run("protocol-tests", [str(binary)])
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not npm: raise SystemExit("npm is required")
    server = ROOT / "remote_webview_server"
    run("server-tests", [npm, "run", "test:run"], server)
    run("server-build", [npm, "run", "build"], server)
    if args.integration:
        run("server-integration", [npm, "run", "test:integration"], server)
    configs = [ROOT / "tests/fixtures/guition03-b.yaml", ROOT / "tests/fixtures/guition03.yaml"]
    if args.p4:
        dependency = read_json(ROOT / "tests/fixtures/gsl3680-manifest.json")
        for name, expected in dependency["files"].items():
            path = ROOT / ".audit/test-components/gsl3680" / name
            if not path.is_file() or sha(path.read_bytes()) != expected:
                raise SystemExit("Import the pinned GSL3680 dependency before --p4")
        configs.append(ROOT / "tests/fixtures/guition04.yaml")
    for config in configs:
        command = [sys.executable, "-m", "esphome", "compile", str(config)]
        if not args.compile: command += ["--only-generate"]
        run(config.stem + ("-build" if args.compile else "-generate"), command)
    if args.plan:
        plan_path = args.plan.resolve()
        plan = read_json(plan_path)
        validate_plan(plan)
        if identity != plan["source_id"]: raise SystemExit("Sources changed since preparation")
        config = plan_path.parent / "payload" / plan["device"]
        digest = sha(config.read_bytes())
        if digest != plan["new_config_sha256"]: raise SystemExit("Candidate changed")
        for name, expected in plan["files"].items():
            if sha((plan_path.parent / "payload" / name).read_bytes()) != expected:
                raise SystemExit("Candidate payload changed")
        secret = plan_path.parent / "private/secrets.yaml"
        temporary_secret = config.parent / "secrets.yaml"
        if secret.is_file():
            if sha(secret.read_bytes()) != plan["expected"].get("secrets.yaml"):
                raise SystemExit("Prepared secrets changed")
            if temporary_secret.exists(): raise SystemExit("Candidate already contains a secrets file")
            temporary_secret.write_bytes(secret.read_bytes())
        try:
            run("deployment-build", [sys.executable, "-m", "esphome", "compile", str(config)])
        finally:
            if secret.is_file(): temporary_secret.unlink(missing_ok=True)
        if sha(config.read_bytes()) != digest or source_identity()[0] != identity:
            raise SystemExit("Sources changed during verification")
        write_json(plan_path.parent / "verification.json", {"source_id": identity, "config_sha256": digest,
                   "compile_exit_code": 0, "results": str(out / "results.json"), "python": sys.version})
    if source_identity()[0] != identity: raise SystemExit("Sources changed during verification")
    run("esphome-version", [sys.executable, "-m", "esphome", "version"])
    run("node-version", [shutil.which("node"), "--version"])
    print(f"Evidence: {out / 'results.json'}", flush=True)


if __name__ == "__main__": main()
