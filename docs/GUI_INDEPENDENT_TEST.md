# Fresh-session GUI test

**Passed: 3,723/3,723 interaction-GUI frames detected (100% recall), with
0/3,001 false detections on closed frames.** The frozen candidate recovers all
77 original-baseline misses, without tuning or regressions on this test.

This evaluates the previously frozen GUI-presence candidate on a new recording
session. No threshold sweep, model fitting, mask changes or test-based candidate
selection is performed. The comparison is the unchanged original detector
versus the single frozen candidate; exact GUI typing is not the metric.

## Results

| Detector | GUI detected / present | Recall | False detections / closed |
|---|---:|---:|---:|
| Original baseline | 3,646 / 3,723 | 97.93% | 0 / 3,001 |
| Frozen tooltip + 80% border / 70% interior | **3,723 / 3,723** | **100%** | **0 / 3,001** |

All 23 recorded interaction-screen IDs have zero misses with the candidate.
The original baseline misses 50 merchant, 21 dispenser/dropper, four container
and two creative-inventory frames. The candidate recovers them all. This test
also includes signed-book viewing (99 frames), absent from the development
recordings, and hanging-sign editing (112 frames), with no missed frames.

Renderer-weighted recall is also 100% (3,713/3,713). The 181 out-of-scope frames
have the same outcome for both detectors: 24 pause frames detected and 157
chat/debug frames abstained. They are not counted as closed-frame false positives.
Every input frame is aligned, stable and included in the appropriate scope.

Quality passes this fresh-session check. Runtime still needs production work:
the research candidate's median/p95 are 42.275/78.123 ms per frame, versus
16.348/24.502 ms for the original baseline. Both were measured sequentially on
each decoded frame; these are local research timings, not app pipeline latency
or a controlled speed benchmark. End-to-end evaluation took 416.5 seconds and
500.92 child-process CPU seconds, within its bounded test budget. The generated
research profiler is not a shipped or optimized production implementation.

Frozen implementation hashes passed their end-of-run checks. Video SHA256:
`6f477d5acfe36fa2c8c5963bbc5c263c0619639268d705a048d410e5a011741c`.
Private report SHA256:
`444cd429516b5d3e4d33cffcd5d5a9d39a20e1017e25f96f4ada01cc324034c3`.

## Inputs and protocol

- Video: `fire-detection/data/video/2026-10-20 22-10-14.mkv`, 115.084 seconds,
  1920x1080 at 60 fps. Every one of its 6,905 decoded frames is processed.
- Label session: `c436746c-3d22-4fbd-b5bd-11bf0a7582c8`, Minecraft 1.21.11 with
  Sodium. Complete normal-shutdown footer, zero dropped records. This is a new
  session, separate from the two development/calibration recordings.
- All 6,905 sync strips pass CRC and match renderer labels; zero backward IDs
  and unstable states. There are 6,811 distinct renderer IDs and 94 repeated
  observations. Adjacent frames remain correlated.
- Primary scope: 3,723 `inventory.*` GUI-present frames and 3,001 closed frames.
  The 181 chat/pause/debug-menu frames are processed and reported separately.
- Frozen candidate: independent tooltip mask, border agreement 80%, interior
  agreement 70%, regional floors disabled. Existing minimum support, colour
  tolerance, fixed-control identity, source bank and geometry remain unchanged.
  No renderer positions or titles are used as detector hints.
- Native RGB24, no temporal smoothing, frame skipping or added image enhancement.
  The single-candidate adapter reproduces frozen grid index 95 on four previously
  cached development failures before accessing this test's image stream.

The selected configuration and its original freeze hash are documented in
[GUI_CALIBRATION_RESULTS.md](GUI_CALIBRATION_RESULTS.md). Private evidence under
`.board/gui-independent-test/` retains the complete log snapshot, aligned rows,
source/label/video hashes, source coverage and both per-frame prediction streams.
These are evaluation artifacts, not new GUI-mask ground truth or training labels.
The source bank and frozen implementation hashes are checked for consistency.

This test measures one new local session on the same game/capture setup. It does
not establish perfect detection for every vanilla screen, version, scale,
resource pack or recording condition, nor a zero general false-positive rate.
