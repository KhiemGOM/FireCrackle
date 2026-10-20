# Unified GUI production check

This is engineering parity/regression validation of the already frozen detector,
not another threshold calibration, AI fit or model selection. No synthetic
training data or new checkpoints were used.

## Shared implementation

- `gui_interaction_fast.rs`: the frozen tooltip-neutral 80% border / 70% interior
  policy, no regional gate, cached source geometry and deterministic CPU workers.
- `GuiDetector`: existing HUD mask plus independently confirmed neutral screen
  regions. HUD reliability and availability of a panel mask are separate.
- `studio_core::gui::interaction_detector`: one immutable 94-pack bank, used by
  the preview, first-person pipeline, no-fire pipeline and Misc video scan.
- `gui_scan.rs`: bounded frame workers, original frame indices, disk checkpoint,
  pause/resume, source/video invalidation and cross-instance writer lock. A
  completed compatible scan is reused without decoding the video again.
- No-fire remains conservative: a detected neutral screen causes abstention,
  rather than treating hidden world pixels as proof of no fire.

Version/artwork coverage and its limits are in `GUI_VERSION_COMPATIBILITY.md`.
The 90 endpoint packs match the previously tested local source packs byte for
byte; four additional intermediate artwork variants are built from official
1.17/1.18 clients. Assets remain private build inputs.

## GUI decision parity

All original frame decisions match the frozen research output with the expanded
bank, including frames excluded from the GUI-present/closed accuracy denominator.

| Recording | Frames | Changed GUI decisions | Median detector ms | p95 ms |
| --- | ---: | ---: | ---: | ---: |
| `2026-10-20 14-09-57.mkv` | 25,121 | 0 | 13.118 | 17.978 |
| `2026-10-20 14-22-45.mkv` | 2,264 | 0 | 13.308 | 17.677 |
| `2026-10-20 22-10-14.mkv` | 6,905 | 0 | 8.400 | 17.966 |

These timings use four template workers in a streaming adapter and include
concurrent local work; they are not a controlled isolated speedup estimate.
The independent research adapter previously measured median 42.275 ms on the
last recording. The actual application uses outer frame workers and a serial
shared detector to avoid nested thread pools.

The real application scan integration test scanned the independent 6,905-frame
recording, paused, recreated its job manager, resumed, and compared every stored
GUI result with the frozen frame result. It passed, as did completed-cache reuse
with unavailable video tools. The complete integration test took 73.33 seconds
while other local checks were running; this is not a standalone throughput claim.

Frozen accuracy remains 9,967/9,970 GUI-present calibration frames and
3,723/3,723 independent GUI-present frames; zero observed false positives in
12,958 + 3,001 closed frames. This does not establish accuracy on every Minecraft
version or resource pack. See the original calibration and independent-test notes.

## First-person labeller regression

The shared-mask production entry point was run on the six original, exactly
synchronised recording samples used by its existing regression suite:

| Recording alias | Scored frames | Fire samples | Accepted/correct | False positives | Wrong rows |
| --- | ---: | ---: | ---: | ---: | ---: |
| clip1 | 6,526 | 194 | 192 | 0 | 0 |
| clip2 | 3,911 | 932 | 922 | 0 | 0 |
| quad1 | 237 | 3 | 3 | 0 | 0 |
| survival1 | 2,757 | 384 | 380 | 0 | 0 |
| early | 1,880 | 5 | 5 | 0 | 0 |
| later | 653 | 344 | 338 | 0 | 0 |
| Total | 15,964 | 1,862 | 1,840 | 0 | 0 |

All accepted rows were correct; 98.82% of sampled first-person-fire frames were
labelled, with zero observed false positives in 14,102 non-overlay samples.
Samples are correlated and drawn from the familiar local setup.

There are three differences from the older archived regression output: clip1
29070 now abstains, and survival1 6240/10380 now correctly accept rows 29/1.
A source audit found the archived output predates other GUI/overlay changes.
The current baseline, run on lossless extracted versions of these three frames,
already abstains on clip1 29070 and abstains on both survival frames. The unified
detector finds no interaction GUI on clip1 29070. Thus that apparent loss is not
caused by the new bank; the two survival recoveries are correct. This targeted
baseline check is not claimed as a fresh paired baseline run over all frames.

Private reproducibility outputs: `.board/gui-production/version-check/`,
`.board/gui-production/pov-regression/{coverage,report}.json`, per-frame outputs,
source hashes and adapters. The coverage manifest accounts for original
recordings outside this frozen regression as exclusions; GUI recordings have
their separate full-frame check above. No recordings, labels or assets are committed.

Native tests cover deterministic worker selection, malformed bundles, neutral
panel merging, source geometry, interrupted cache tails, original indices and
interval boundaries. Frontend tests cover independent panel-mask availability
and opening GUI boundaries in the existing comparison view.
