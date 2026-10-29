# Remote WebView: source decision and audit (2026-10-29)

This records the audited sources and the prepared consolidation. It is not a
hardware validation or a claim that production has already been switched.

## Source decision

`kamilzierke/ESPHome_random_chest_of_randomness` is the canonical repository:
client in `components/remote_webview`, server in `remote_webview_server`, packages
and hardware examples in `examples/remote_webview_client`. It contains the shared
history and the superset of the locally modified upstream client features.
`RemoteWebViewClient` remains a preserved historical checkout, including its
separate staged and unstaged source changes. Do not develop two active clients.

Production uses a generated local deployment, with a source manifest, exact
revision/content identity, destination preconditions and an independent backup.
This fits the actual HA `my_components` layout and can deliver reviewed local
changes without publishing anything to GitHub. A pinned Git revision would also
work after publication, but mixing Git packages and a manually copied component
would reintroduce the problem. Neither method should follow moving `main`.

The wire protocol remains version 1; additive control/encoding capabilities are
documented separately. JPEG is the compatibility default. PNG and RAW565 require
the newer client; RLE/LZ4 must not be advertised as supported decoders. Server
changes must be validated with the existing JPEG client before firmware rollout.

## Preserved initial state

Verified remote branches using the GitHub connector and `git ls-remote`: each
repository has only `main`, no tags. Client HEAD:
`603fea906f2775a43a425f6e8d63851ecc2b9805`; canonical HEAD:
`b4927a21d227e2a650f23958536d78963dcdc3ac` (a commit, not a tree).

The private snapshot at `../.rwv-audit/20261029T094005Z` includes original Git
indexes, index entry manifests, separate HEAD-to-index and index-to-worktree
patches, source files, SHA-256 manifests and history bundles. Secrets and raw HA
YAML are separate private files and must never be committed. Generated toolchains
were not copied. The client index contained 54,361 `.platformio` entries,
12,656 `.venv-esphome` entries and one Python cache entry. Source staging is
preserved when removing those generated entries.

## Actual HA source

The user identified `N:/esphome` as HA's `config/esphome`. Read and hash-verified
17 relevant files there. No AGENTS.md/CLAUDE.md was found below that root.
Only `guitionhmi-03-verB.yaml` references RWV among current YAML files;
`guitionhmi-03.yaml` and `guitionhmi-04.yaml` do not. Profile filenames do not
establish additional deployed clients. Historical conversation attachments are
unavailable, so byte equality with the earlier uploaded YAML/log is unverified.

HA stable is 2026.10.1 and Remote WebView Server reports 1.1.10 through Supervisor.
This is version metadata, not a hash verification of the running server image.
ESPHome's MCP proxy returned 403; native/browser access was unavailable. The
user-provided filesystem path supplied actual sources instead.

HA is a mixed revision deployment. Normalizing CRLF and trailing whitespace:

| File/function | Local client | Actual HA | Canonical GitHub main | Decision |
| --- | --- | --- | --- | --- |
| `__init__.py` | power options; staged and unstaged variants | matches `50a11a2d` | runtime numbers/select, PNG library | keep canonical features; request TLS |
| `remote_webview.cpp` | power/telemetry | matches `0a73fc9a` | PNG/RAW565, runtime config | preserve features, repair failure paths |
| `remote_webview.h` | fewer entities | matches `50a11a2d` | newer public interface | deploy together with implementation |
| `protocol.h` | matches HA | matches `caf77975` | adds debug/config messages | deploy coherent header set |
| config header | same | same | same | retain |
| client package | different | matches `50a11a2d` | render mode option | retain device substitutions |
| diagnostics package | absent locally | matches `cd060ca5` | more controls/sensors | retain entity names and existing options |
| power/LVGL/inactivity | older power variant | matches current canonical | same as HA | add missing host hooks |
| Guition03/04 profiles | local variants | no exact history match | examples | preserve historical files, test real hardware separately |
| server | absent | version metadata only: 1.1.10 | source/tests present | canonical server; runtime image provenance pending |

The B configuration is ESP32-S3, 16 MB flash, octal 80 MHz PSRAM, ST7701S
480x480, GT911, rotation 270. It includes the power package but has neither a
startup wake/idle hook nor a touch activity hook. This is a source finding;
the installed firmware's behavior has not been tested.

## Priorities

1. Restore coherent dependency/linking declarations, reconnect ownership and
   bounded parsing; verify with ESPHome 2026.10.1 and a clean build.
2. Recover delta-image consistency after packet/decode loss. Exercise static
   keyframe requests, queue pressure and serialized processing in server tests.
3. Generate source-identified deployment and rollback, preserve all destination
   files until validation, and refuse changed destination preconditions.
4. Validate touch/rotation, sleep/wake and restart scenarios on hardware only
   after a separately approved firmware upload.

The original local venv is ESPHome 2026.4.0. It is not evidence for 2026.10.1.
The isolated `.venv-audit` uses 2026.10.1. Baseline: 3 Python schema tests pass;
server TypeScript build and existing Vitest suite pass. Windows sandbox blocks
some child processes (`spawn EPERM`); approved execution outside that sandbox
was needed for npm installation/tests. No production service was restarted.

## Feature inventory and decisions

Implementation references below are within the canonical component/server. The
actual HA use column describes source configuration, not observations of hardware.

| Feature | Implementation / configuration and protocol | Verification / actual HA use | Decision |
| --- | --- | --- | --- |
| WebSocket and reconnect | pinned Espressif 1.5.0; library auto reconnect; explicit reconnect queued to owner task | compiled S3/P4; server reconnect/restart integration; ESP32 network loss awaits hardware | remove callback stop/start and competing polling restart |
| Device identity | configured `device_id` or cached `esp32-<MAC>`; random bytes only if every MAC read fails | builds; B has automatic identity | cache once per boot; no text formatting into six-byte MAC storage |
| URL and runtime changes | OpenURL v1; ordered server input; ClientConfig message 7 | browser integration exercises URL sent immediately on connection | preserve URL/substitutions; retain numeric/select controls |
| Touch and coordinates | Touch v1, server inverse rotation; one Down and one Up; wake contact consumed by default | rotation corner tests; actual browser touch; B uses rotation 270 | remove duplicate Down; physical rotation and (0,0) wake remain hardware checks |
| JPEG / PNG / RAW565 | encodings 2/1/3; P4 HW JPEG with software fallback; bounded tile dimensions | full S3/P4 links, RAW565 browser colors, JPEG reconnect | JPEG remains default; preserve PNG/RAW565 as supported options |
| RLE / LZ4 | reserved enum values; no client decoder | schema rejects RLE; parser rejects unsupported image encodings | remove dead YAML acceptance; keep wire enum reservations |
| Full / delta / tiles | protocol v1 full/last flags, validated complete packet before drawing | host parser rejects truncations, overflow, invalid geometry/length/encoding; server tile tests | preserve v1; never call a single packet a complete frame |
| Fragmentation | bounded WS binary/continuation accumulation; sequential payload offsets and FIN required | client compiles; server integration receives fragmented touch | malformed client-side fragments still need host/hardware fault injection |
| Queue overload | both queue policies invalidate image; recovery waits for full frame beyond loss boundary | source review and builds; server bounded-send tests | latest packet may replace backlog only with subsequent full resync |
| Decode errors | checked JPEG/PNG results, intrinsic dimensions, PNG completion; request keyframe | builds and parser tests; damaged decoder input awaits client execution | count failures; stop the damaged frame and recover |
| Static keyframe | cached last screenshot; request bypasses unchanged-image hash | regression through actual device manager and real Chromium | fix reproduced server control failure |
| Pause / resume | ClientControl message 6; cached image replay on resume; invalidation of in-flight work | unit tests and real browser integration; B enables stream control | preserve controls and first-touch policy |
| Screen power | separate common power package, automatic boot and touchscreen hooks | configuration generation and full links; B lacked the host hooks before audit | add lifecycle hooks; preserve timings/brightness and entity IDs |
| Diagnostics / HA controls | optional sensors, binary sensors, switches/buttons/numbers/select; main-loop publishing and atomic counters | schema tests and linked generated entities | retain existing names and expose unsupported-encoding counter |
| Watchdog | optional missed-frame watchdog requests owner-task reconnect | B sets missed-interval limit 0, so watchdog is disabled there | preserve disabled setting; do not infer a static page is a hardware fault |
| Server adaptation | JPEG quality reduction and rect splitting before fallback | existing frame-processor tests | retain settings and pinned lockfile |
| Async processing / backpressure | one encode per device; ordered bounded encoded queue; send callback and timeout; disconnect on congestion | scheduler/broadcaster unit tests, browser integration | coalesce producer frames before encoding; never silently delete a dependent delta |
| Image change detection | hash includes every byte rather than only every fourth byte | regression detects changes in R/G/B/alpha; real browser blue-to-green transition | fix missed-color changes |
| Shared screens | one active socket per device ID; separate browser targets for different IDs, shared browser profile | replacement-socket regression | retain behavior; no new broadcast-sharing model claimed |

The PNG decoder's internal allocations are freed with `pngle_destroy`, including
error paths. Queue/mutex/task allocation failures are checked, hardware JPEG
initialization precedes task startup, and the 64-bit decode timing aggregate uses
a critical section. These are code fixes and build-verified paths, not measured
long-duration memory behavior on an ESP32.

## What was reproduced

The sanitized actual HA source snapshot was compiled under ESPHome 2026.10.1 / IDF
5.5.6 through the linker. Its generated sdkconfig had `CONFIG_MBEDTLS_TLS_DISABLED=y`
and linking failed with `mbedtls_ssl_read`, `mbedtls_ssl_write` and other missing
TLS symbols. The repaired build requests TLS through ESPHome and generates
`CONFIG_ESP_TLS_USING_MBEDTLS=y`, TLS 1.2 enabled, TLS-disabled unset. S3 and P4
profiles subsequently linked. This distinguishes a reproduced build failure
from the earlier historical log.

The upstream client has moved since the local fork. Read-only ref discovery found
`main` at `1dae5a280b6649514bed2b537b8c264e1d7a67aa` and a dedicated
`esphome-2026.10-tls` branch at `4133f746b30c4fdef474a84d2158377190c38af8`.
Its schema independently requests ESPHome TLS; it also exposes a substantially
different API and relies on newer client behavior. It was inspected as reference,
not silently substituted for the user's extended v1 client/server. A GitHub
repository search for `user:kamilzierke RemoteWebView` found the known client
fork; the separately named random-chest repository was inspected directly.

## Release and outstanding checks

Prepared server version: **1.1.11**. Changes remain local until the separately
confirmed GitHub publication. `docs/remote_webview_sources.json` records original
source hashes; private complete manifests and provenance matching remain in the
snapshot. `docs/testing.md` is the build/deployment/rollback procedure.

No HA application has been restarted, no firmware has been uploaded and no
GitHub-visible mutation has been performed. The actual running server's image
content was not read; only version 1.1.10 and options were read through Supervisor.
ANGLE/SwiftShader was not treated as a failure and performance was not measured.
Docker image build/start, target-app compilation after an approved source switch,
cold start and physical sleep/wake/touch/rotation/fault-injection tests remain
distinct checks. Working hardware and passing local compilation do not replace
those checks.

## Final local validation

Code commit: `ec3c21d`, on `rwv-consolidation-20261029`.
Source content ID: `c2934a9f66271ed6c7d1be2ee6b54bf242e249b289129b8fff39567eb92e33c6`.
Machine-readable commands, versions, log hashes and firmware hashes are in
`remote_webview_validation.json`. Private logs and the exact release are in
`.audit/verification/20261029T103142Z` and `.audit/release-ec3c21d`.

Executed from this repository:

```text
.venv-audit/Scripts/python scripts/verify.py --compile --p4 --integration --fresh --plan .audit/release-ec3c21d/plan.json
```

All 12 checks passed: 9 Python tests, host C++ compilation/bounds tests, 39 server
unit tests, TypeScript build, the real Chromium integration, clean S3/B, S3/03
and P4/04 builds, and the exact HA candidate build, plus version checks. The final
clean build root is `.b/20261029T103142Z`. The tested private candidate differs
from the audited B YAML in exactly four source/package path lines; all other
lines are unchanged. Its temporary build-time secrets copy was removed.

Production has **not** been switched. Server publication/update, the source
switch, target ESPHome application compilation and physical checks remain open.
The prepared script requires its exact successful build receipt and rechecks
HA drift before applying. Firmware upload still needs a separate user decision;
a verified known-good rollback firmware for variant B was not obtained in this
audit, and an older non-B firmware must not be substituted for it.
