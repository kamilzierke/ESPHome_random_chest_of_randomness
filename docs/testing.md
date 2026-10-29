# Remote WebView build, verification and controlled deployment

Reference: Python 3.12, ESPHome 2026.10.1, recommended ESP-IDF 5.5.6 and the
toolchain versions selected by that ESPHome release; Node 24.13.0 / npm 11.6.2.
The server uses `package-lock.json`, WebSocket client 1.5.0, esp-dsp 1.7.1,
JPEGDEC 1.8.4 and pngle 1.1.0. Build tool archives are checked by ESPHome.

## Setup and daily tests

Run from this repository. On Windows:

```powershell
python -m venv .venv-audit
$env:PIP_CACHE_DIR = "$PWD/.cache/pip"
.venv-audit/Scripts/python -m pip install -r requirements-test.txt
Push-Location remote_webview_server
$env:npm_config_cache = "$PWD/../.cache/npm"
npm.cmd ci --no-audit --no-fund
Pop-Location
.venv-audit/Scripts/python scripts/verify.py
```

Install a C++17 `g++` compiler on PATH for the host protocol tests. On Linux use
`.venv-audit/bin/python` and `npm`. No tests contact production HA or upload firmware.
The fast command runs Python tests, C++ bounds tests, server tests/build and YAML
validation/C++ generation. It is **not** a full firmware link test.

Full firmware checks use the real ST7701S/GT911 hardware at rotations 270 and 0:

```powershell
.venv-audit/Scripts/python scripts/verify.py --compile --fresh
```

`--fresh` creates a new build directory instead of deleting any previous build.
All tools, caches, logs and firmware remain in `.cache`, `.esphome`, `.b`,
`.platformio` and `.audit` inside this repository. Per-process Git settings select
OpenSSL and long-path support on Windows; certificate verification stays enabled.
If the sandbox rejects compiler/test child processes, request the corresponding
execution permission. Do not change authentication or Windows security settings.

The optional P4 overlay uses the actual JC8012P4A1 model (batch 2544), ESP32-C6
hosted interface and GSL3680 touch pins. It is not the currently deployed LVGL
configuration. Its local touch dependency has no verified public source URL, so
import an export of the audited dependency using its committed checksum manifest:

```powershell
.venv-audit/Scripts/python scripts/import_p4_dependency.py N:/esphome/my_components/gsl3680
.venv-audit/Scripts/python scripts/verify.py --compile --p4 --fresh
```

The P4 fixture tests the native ESP-IDF backend. The actual unrelated LVGL device
configuration explicitly selects PlatformIO; no hardware equivalence of those
build paths is claimed. The dependency import copies only seven pinned source
files into the ignored test area. It never modifies the HA dependency.

For an actual local server/browser integration test, install the exact Chromium
version required by the existing Playwright dependency, then run the test:

```powershell
Push-Location remote_webview_server
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD/../.cache/playwright"
node node_modules/playwright-core/cli.js install chromium
npm.cmd run build
npm.cmd run test:integration
Pop-Location
```

`scripts/verify.py --integration` includes that test. It creates an isolated
browser profile and synthetic HTTP page on loopback, and uses temporary ports.
It exercises initial URL delivery during CDP startup, static keyframe requests,
pause/resume, fragmented touch input, malformed messages, JPEG reconnect and
server restart. It closes only the browser instance it created. It proves no
ESP32 hardware behavior. Docker image/start tests require Docker and remain
separate from this Windows verification.

Each verification saves commands, exit codes, log hashes, tool versions and a
content identity in `.audit/verification/<UTC timestamp>/results.json`.
The identity binds client, server, packages, fixtures and verification scripts.

## Prepare a reviewable HA release

First read every consumer and snapshot the target component, packages, device
YAML and secrets separately. Preserve the initial manifest. The current audit's
baseline is `../.rwv-audit/20261029T094005Z/HA/manifest.json`.

```powershell
.venv-audit/Scripts/python scripts/rwv_deploy.py prepare `
  --target-root N:/esphome `
  --baseline ../.rwv-audit/20261029T094005Z/HA/manifest.json `
  --device guitionhmi-03-verB.yaml --output .audit/candidate-rwv
.venv-audit/Scripts/python scripts/verify.py --plan .audit/candidate-rwv/plan.json
```

Preparation is read-only toward HA. The output directory must be new. It contains
private original/candidate device YAML, a coherent component/package payload,
source hashes and the expected destination hashes. Do not commit or share it:
device YAML can contain credentials. The verifier compiles the exact candidate
without flashing and issues `verification.json` only on success.
The audited secrets file stays under `private/`; during this build the verifier
temporarily places it beside the candidate YAML for `!secret` resolution, then
removes that temporary copy. Generated firmware and build files are private too.

Review the device diff privately. Expected changes are the three package include
paths and the local external-component path. Hardware settings, entity names,
credentials and device substitutions stay intact. Automatic boot/touch power
hooks are provided by the new power package. The resulting paths are:

```text
rwv-releases/<content-id>/components/remote_webview/
rwv-releases/<content-id>/packages/
rwv-releases/<content-id>/manifest.json
```

Old `my_components/remote_webview` files remain available for rollback and are
inactive after the configuration switch. Never edit an immutable release in place.
The component logs its `source_id` so an eventual firmware upload can be matched
to the tested source. No GitHub publication is needed for this local method.

## Apply and roll back

Apply only after reviewing the prepared change and coordinating the matching
server update. Server 1.1.11 fixes keyframe replay and backpressure. Existing JPEG
firmware can use that server before uploading the new client. Publishing the
server/repository, changing HA sources and uploading firmware are distinct actions.
GitHub-visible actions require a concrete user confirmation under the workspace's
`agent_workflows/github_changes_standard.md`.

```powershell
.venv-audit/Scripts/python scripts/rwv_deploy.py apply .audit/candidate-rwv/plan.json `
  --verification .audit/candidate-rwv/verification.json
```

The command refuses changed destination sources, modified candidate bytes,
unverified configs and conflicting immutable releases. It verifies every copied
file, then atomically switches only the selected YAML and verifies it again.
The old YAML is stored in `private/original.yaml`; the generated `receipt.json`
records both checksums. To restore it without overwriting later user edits:

```powershell
.venv-audit/Scripts/python scripts/rwv_deploy.py rollback .audit/candidate-rwv/receipt.json
```

Rollback restores the previous YAML bytes and leaves the immutable release on
disk. If an apply process fails before it writes a receipt, the prepared original
and plan still hold the rollback data; compare the current YAML checksum before
manually restoring that exact original. Do not replace a file that has later edits.
The destination precondition check is optimistic: avoid concurrent ESPHome editor
changes during the final file switch.

After switching, re-read the source hashes through HA's filesystem and compile
in the target ESPHome application. A local successful link does not prove that
the application used the same files. This requires working app build access;
file/entity access alone is insufficient.

No flashing is performed by any script. Before an approved upload, retain the
previous known-good firmware and configuration. Test cold boot, server restart,
network loss, queue pressure, corrupted images, sleep/wake, wake-only versus
passthrough touches and physical coordinate rotation on the intended test hardware.
Restoring source YAML alone does not roll back firmware already flashed.
