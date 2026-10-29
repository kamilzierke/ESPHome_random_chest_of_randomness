"""Copy the audited GSL3680 dependency into the isolated build area, with hashes."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Exported my_components/gsl3680 directory")
    args = parser.parse_args()
    manifest = json.loads((ROOT / "tests/fixtures/gsl3680-manifest.json").read_text())
    payload = {}
    for name, digest in manifest["files"].items():
        data = (args.source / name).read_bytes()
        if hashlib.sha256(data).hexdigest() != digest:
            raise SystemExit(f"Dependency changed: {name}; review and update the manifest first")
        payload[name] = data
    target = ROOT / ".audit/test-components/gsl3680"
    target.mkdir(parents=True, exist_ok=True)
    for name, data in payload.items(): (target / name).write_bytes(data)
    print("Verified GSL3680 dependency imported; no HA files changed")


if __name__ == "__main__": main()
