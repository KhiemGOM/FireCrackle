# Canonical GUI exclusion Ã— learned occlusion: frozen ablation

2026-10-17. The completed shared GUI classifier was evaluated on the same held-out
native frames as the [all-video ownership experiment](../occlusion_all_videos/RESULTS.md).
It does **not** improve the strong matching references in this experiment. Keep it
out of the matcher's default path pending a more precise treatment of the crosshair.
No app defaults, weights, thresholds, project attestations or GUI detector rules
were changed by this experiment.

## Protocol

- Three compatible quad benchmarks, 432 cases each for exact and supplied rough
  geometry: quad1 310/28 frames, survival1 74/55 frames, new recording 48/6 frames.
  These are the same held-out pools, exclusions and partial-label limitations as
  the linked report. Clips 1/2 have no quad corners and remain unscorable here;
  bounding boxes were not substituted for quads.
- Four arms: baseline, frozen learned ownership mask, canonical GUI exclusion,
  and both. Six fixed scorers; 864 cases Ã— 24 outputs = 20,736 outcomes. No winner
  selection or threshold tuning on these results.
- `batch.rs` directly includes `fire-detection/core/src/gui_mask.rs`; there is no
  second GUI detector. It receives the same already-unveiled native RGB as the
  previous experiment. No extra colour inverse or unveil pass.
- All detected nonzero GUI classes (opaque, translucent and unknown) veto affected
  samples. The adapter checks all four source taps of the RGB bilinear footprint;
  this is a conservative veto even when a tap's interpolation coefficient is zero.
  The detector's class map supplies the spatial extent; no extra HUD boxes are
  invented by the adapter. Native pixel provenance is retained. Shifted hypotheses
  query the GUI map in image coordinates and the learned field in its original UV
  coordinates. With no surviving positive evidence, the GUI arm abstains.
- Unreliable GUI fits leave the original observations unchanged. This preserves
  control behavior; it is **not** a guarantee that such frames contain no GUI.
- These controlled vanilla recordings are an offline research assumption. Nothing
  writes a project's GUI attestation or bypasses the application's user gate.
- All **10,368 baseline/learned-only case-method results**, including top five
  rankings, exactly reproduce the previous run. GUI and veil source hashes also
  remain unchanged between preparation and summarization.

## Strong reference results

Counts are correct top-one sprite predictions, including wrong/abstained cases in
the denominator. Exact uses the previous `facing4` research leader; rough uses
`jitter_max_pairs4`, fixed across all videos. These were historical test-selected
references, not newly selected independent-validation winners. The previously
tuning-selected `facing1` and all other methods are included below.

| Video | Quad | Cases | Baseline | Learned only | GUI only | Both |
|---|---|---:|---:|---:|---:|---:|
| quad1 | exact | 310 | 95/310 (30.6%) | 94/310 (30.3%) | 94/310 (30.3%) | 93/310 (30.0%) |
| quad1 | rough | 310 | 68/310 (21.9%) | 73/310 (23.5%) | 67/310 (21.6%) | 70/310 (22.6%) |
| survival1 | exact | 74 | 31/74 (41.9%) | 30/74 (40.5%) | 28/74 (37.8%) | 27/74 (36.5%) |
| survival1 | rough | 74 | 22/74 (29.7%) | 24/74 (32.4%) | 19/74 (25.7%) | 21/74 (28.4%) |
| new_recording | exact | 48 | 29/48 (60.4%) | 31/48 (64.6%) | 28/48 (58.3%) | 30/48 (62.5%) |
| new_recording | rough | 48 | 22/48 (45.8%) | 21/48 (43.8%) | 22/48 (45.8%) | 21/48 (43.8%) |

Pooled exact: **155 â†’ 155 â†’ 150 â†’ 150 / 432** for baseline, learned, GUI, both.
Pooled rough: **112 â†’ 118 â†’ 108 â†’ 112 / 432**. Thus adding GUI exclusion loses five
correct exact matches relative to either control and six rough matches relative
to learned-only. This is a small, correlated sample; it does not establish general
accuracy or certify GUI pixel classification.

## Why it regresses

GUI exclusion touches positive fire probes in 37/39 exact/rough quad1 cases,
22/22 survival cases, and 9/9 new-recording cases. A visually audited mechanism is
the crosshair: the canonical module intentionally marks its **entire 15Ã—15 GUI-pixel
square Unknown**, before considering transparent sprite pixels. At the detected
3.75 scale, this can cover almost all of a distant fire quad.

The strong exact survival reference loses three previously correct cases in two
frames, with no gains. Case `43547-0-3` loses 639 positive probes and abstains;
`43547-0-4` loses 551 and changes its prediction; `43667-12-2` loses 281 and changes
its prediction. Within their rasterized quad polygons, respectively 2,513/2,540,
2,131/3,172 and 1,756/2,584 native pixels carry crosshair piece ID 5. The saved
before/overlay montage confirms that the square covers the labelled fire, including
world-visible area around the actual crosshair. This explains these losses without
assuming that every detected GUI pixel is correct or every excluded pixel is fire.

The next targeted change should be in the **canonical** crosshair classifier:
distinguish the actual inverted crosshair support from its transparent surroundings,
while retaining uncertainty at genuine mixed edges. Then rerun this exact protocol.
This report does not implement that change or retrain the ownership model on these
test examples.

## Detector coverage and runtime

89 unique frames, **88 reliable fits and one unreliable**. Reliable scales: 83
frames at 3.75 and five at 5.0. The unreliable frame is `new_recording/182660`;
its GUI arm falls back to the unchanged observation. A three-frame spot audit also
shows that a visible recipe toast is not covered by the current map. A reliable
scale fit is not complete GUI coverage or pixel-level ground truth.

Full-frame offline CPU detection (textures loaded once): two passes measured medians
**175.9 / 104.4 ms**, p95 **225.8 / 126.6 ms**, excluding RGB file I/O and subsequent
matcher inference. The second pass rebuilt the formatted runner and verified all
267 class/piece/reliability buffers were byte-identical. Runtime varies with machine
load and cache state. Detection is cached once per frame for this experiment. These
numbers are not a live-FPS claim. No independent GUI segmentation truth was available
for these footage frames.

## Reproduce and inspect

1. Prepare the frozen inputs with the linked all-video experiment.
2. Run `gui_occlusion_eval/prepare.py` with the existing local GUI textures and Rust.
3. For each video/mode, run `occlusion_all_videos/evaluate.mjs DATA OUT GUI_DIR`,
   pointing GUI_DIR at `.board/gui-occlusion-eval/VIDEO`.
4. Run `gui_occlusion_eval/summarize.py`. It asserts control prediction parity and
   canonical source hashes, writes paired gains/losses and frame-cluster bootstrap
   intervals, and emits the tables below.
5. Run Node tests for `gui.test.mjs` and `occlusion_all_videos/evaluate.test.mjs`.

Ignored local evidence lives in `.board/gui-occlusion-eval/`: `protocol.json`,
`detection.tsv`, `summary.json`, per-frame class/piece/reliability/hit records,
per-case rankings, `gui-audit.png`, and `gui-loss-audit.png`. Source hashes are
recorded there. Textures, footage, weights, binaries and masks are not committed.

## All six methods

Each cell is the number correct, with denominators 310, 74 and 48 by video. Both
the gains and regressions are retained; this is not an ensemble-selection table.

| Video | Quad | Method | Baseline | Learned only | GUI only | Both |
|---|---|---|---:|---:|---:|---:|
| quad1 | exact | colour | 87 | 90 | 86 | 89 |
| quad1 | exact | pairs4 | 92 | 91 | 93 | 91 |
| quad1 | exact | facing1 | 90 | 96 | 90 | 94 |
| quad1 | exact | facing4 | 95 | 94 | 94 | 93 |
| quad1 | exact | jitter_max_pairs1 | 87 | 91 | 87 | 88 |
| quad1 | exact | jitter_max_pairs4 | 87 | 89 | 87 | 88 |
| quad1 | rough | colour | 59 | 62 | 58 | 64 |
| quad1 | rough | pairs4 | 58 | 60 | 59 | 61 |
| quad1 | rough | facing1 | 54 | 60 | 54 | 59 |
| quad1 | rough | facing4 | 60 | 63 | 61 | 63 |
| quad1 | rough | jitter_max_pairs1 | 68 | 74 | 67 | 72 |
| quad1 | rough | jitter_max_pairs4 | 68 | 73 | 67 | 70 |
| survival1 | exact | colour | 27 | 28 | 24 | 25 |
| survival1 | exact | pairs4 | 30 | 28 | 27 | 25 |
| survival1 | exact | facing1 | 29 | 29 | 26 | 26 |
| survival1 | exact | facing4 | 31 | 30 | 28 | 27 |
| survival1 | exact | jitter_max_pairs1 | 29 | 28 | 26 | 25 |
| survival1 | exact | jitter_max_pairs4 | 30 | 29 | 27 | 26 |
| survival1 | rough | colour | 19 | 21 | 18 | 21 |
| survival1 | rough | pairs4 | 21 | 20 | 18 | 18 |
| survival1 | rough | facing1 | 19 | 20 | 18 | 19 |
| survival1 | rough | facing4 | 20 | 19 | 17 | 17 |
| survival1 | rough | jitter_max_pairs1 | 21 | 23 | 20 | 21 |
| survival1 | rough | jitter_max_pairs4 | 22 | 24 | 19 | 21 |
| new_recording | exact | colour | 28 | 27 | 28 | 26 |
| new_recording | exact | pairs4 | 29 | 30 | 28 | 28 |
| new_recording | exact | facing1 | 30 | 30 | 29 | 28 |
| new_recording | exact | facing4 | 29 | 31 | 28 | 30 |
| new_recording | exact | jitter_max_pairs1 | 28 | 26 | 27 | 26 |
| new_recording | exact | jitter_max_pairs4 | 28 | 26 | 28 | 26 |
| new_recording | rough | colour | 16 | 18 | 16 | 18 |
| new_recording | rough | pairs4 | 21 | 19 | 21 | 19 |
| new_recording | rough | facing1 | 18 | 18 | 18 | 18 |
| new_recording | rough | facing4 | 19 | 16 | 18 | 16 |
| new_recording | rough | jitter_max_pairs1 | 21 | 19 | 21 | 20 |
| new_recording | rough | jitter_max_pairs4 | 22 | 21 | 22 | 21 |
