# GUI-neutral first-person matching ablation

2026-10-18. Fixed threshold 0.5; paired inference on the same native frames.

GUI exclusion improves recall but introduces false positives. Keep the shipped automatic labeller on its existing unmasked decision rule. No app setting or automatic acceptance path was switched.

| Recording | Scored frames | Overlay truth | Baseline correct accepted | GUI-neutral correct accepted | Baseline false positives | GUI-neutral false positives |
|---|---:|---:|---:|---:|---:|---:|
| clip1 | 6526 | 194 | 174/194 (89.7%) | 192/194 (99.0%) | 0 | 6 |
| clip2 | 3911 | 932 | 895/932 (96.0%) | 917/932 (98.4%) | 0 | 5 |
| quad1 | 237 | 3 | 2/3 (66.7%) | 3/3 (100.0%) | 0 | 0 |
| survival1 | 2757 | 384 | 325/384 (84.6%) | 371/384 (96.6%) | 0 | 5 |
| Total | 13431 | 1513 | 1396/1513 (92.3%) | 1483/1513 (98.0%) | 0 | 16 |

All 87 additional correct acceptances are recoveries: no baseline-correct frame was lost. Neither mode accepted a wrong texture row on a truth-positive frame. The 16 GUI-neutral errors are first-person-presence false positives among 11,918 truth-negative sampled frames; several are adjacent frames from the same event, not 16 independent events.

## What changed

- Run canonical `gui_mask::detect_gui` with default options on the raw frame, using the local vanilla GUI textures. Use only reliable fits; otherwise exclude nothing.
- Exclude opaque/translucent GUI pixels and unknown hotbar-item, crosshair and effect-icon interiors, matching the existing GUI world-pixel policy. This is the actual detector, not an oracle mask or fixed HUD rectangle.
- Excluded probes contribute neither agreement nor disagreement to silhouette ranking, presence or chromaticity ranking. Colour evidence is normalized over the remaining expected opaque probes; the existing minimum of five usable colour probes remains. Fully excluded input stays below the acceptance threshold.
- Keep automatic shared veil reversal, FOV60/FOV70 selection, chromaticity constants and threshold 0.5 unchanged. No threshold sweep, temporal filling or label-assisted mask fitting.
- Ground truth is joined separately after inference, requiring tick-valid labelled frames. The inference executable receives no labels. Clip1/clip2 use stride 5; quad1/survival1 use stride 30. All 13,431 sampled frames have valid joined truth.

## Where the gains and errors are

In the original two clips, visibility below 0.15 improved from 97/136 to 129/136 correct acceptances. Clip2 veiled overlay frames improved from 114/135 to 122/135. These groups use recorded truth only for reporting.

Representative errors were visually inspected at clip1 frames 7685 and 13145: neither shows the first-person overlay. At 13145, ignoring GUI raises row 13 evidence from 0.2083 to 0.7785 on a netherrack background. Removing mismatching HUD probes can make coincidental remaining scene colours pass the old threshold. The changed score therefore needs separate confidence validation before automatic use.

All GUI-neutral false-positive frame indices (zero-based video frames):

- clip1: 7685, 13135, 13140, 13145, 13150, 13155.
- clip2: 15185, 15190, 15195, 15975, 15980.
- quad1: none.
- survival1: 8610, 8880, 25080, 25110, 82020.

## Cost and compatibility

With four CPU workers, mean GUI analysis was about206–223ms per sampled frame, versus5.5–5.9ms for the paired unmasked FOV matches under the same load. These are per-call wall times under concurrency, not isolated CPU benchmarks. The offline run includes both matcher paths plus GUI fitting and full-source decoding; sampled pipeline FPS must not be called full-frame scan throughput. GUI fitting is currently expensive enough to matter.

The initial prototype added overhead even when exclusion was unused. The final implementation specializes the unmasked path at compile time, avoiding mask allocations/filtering. A 900-frame clip2 comparison preserved every row, score, presence, evidence and FOV hash. CSV SHA256 before and after is `6be53450abaa94f1dc879c5b245f6f4de7808826ce5f0e639520b7136f3f0d26` (case-insensitive hex). Matching-time sums were 2874 ms original, 5659 ms prototype, 2801 ms optimized; overall wall times were 3.256 s, 3.802 s, 3.109 s. Background workloads were present, so treat timing as a regression check, not a precise speedup claim.

Historical `overlay5_*_h.csv` files are diagnostic comparisons, not the current baseline: clip1 had 2 candidate-row and 232 rounded-score differences; clip2 had 0 and 5. All changed scores coincided with changed shared veil decisions. The unchanged pre-experiment production binary agrees with the paired baseline on 180 sampled clip1 frames; its 900-frame clip2 full-score output also matches the optimized implementation exactly.

## Reproduce and limits

The full run used experiment revision `46ff33a`. Subsequent changes specialize only the unmasked path and check successful decoder termination; masked arithmetic is unchanged. Local `.board/pov-gui-ablation/` contains CSVs, reports, source/asset/label hashes, video hashes and inspected error frames; these private/generated inputs are not committed. The cache intentionally rejects different source hashes.

```powershell
cargo build --release --manifest-path fire-detection/core/Cargo.toml --example pov_gui_ablation
python fire-detection/bench/pov_gui_ablation.py
cargo test --manifest-path fire-detection/core/Cargo.toml --test silhouette
python -m unittest discover -s fire-detection/bench/tests -p test_pov_gui_ablation.py
```

Tests cover exact empty-mask parity, total-mask abstention, mask shape validation, masked-pixel colour invariance with and without veil reversal, and reporting that separates wrong rows from presence false positives.

This is a development comparison on existing recordings. The original matcher was developed on clips1/2, and GUI detection was also investigated on these recording collections. Quad1/survival1 add footage but are not pristine independent validation. No claim of universal zero error, YouTube robustness or performance on cropped/custom-GUI footage follows.

Final optimized helper check: all baseline/masked prediction fields, GUI reliability/fraction and veil decisions match the frozen experiment on 200 real clip1 frames.
