# Nearby orange fragments: real-video result

2026-10-17. Positive means correctly clear no-fire/negligible fire; FP means
meaningful fire wrongly cleared. No CNN or learned model.

**Result: merging fragments alone did not improve the safe clearing rule.**
The clip2-selected radius4 primary produced **91 TP / 13 FP**, against the
unmerged component reference's 100 TP / 13 FP. Do not deploy this as confident
no-fire clearing. The current exploratory combination remains 46 TP / 0 FP;
these are familiar recordings, not independent validation.

## Frozen experiment

All four recordings were freshly decoded at native 1920 x 1080, stride 90. Clip2
provided 218 calibration frames (125 meaningful fire, 93 clear-eligible). Only
after freezing thresholds, clip1/quad1/survival1 were evaluated concurrently:
1,361 frames, 606 meaningful fire, 755 clear-eligible. The existing pragmatic
visible horizontal box width >= 24 px policy is applied; no height cutoff.

Orange rule: R >= 64, 0.23R <= G <= 0.88R, B <= 0.5R, R-B >= 24. White contributes nothing.
Square dilation radii 0/1/2/4 native pixels join nearby orange fragments; then
8-connected components are measured. Area counts ONLY original orange pixels,
never inserted dilation pixels. Radius r can bridge up to 2r missing pixels.
Raw and canonical auto-unveil scores combine by maximum. Top 12 rows are omitted
consistently with the old baseline. No independent unveil implementation.

Each variant uses score<threshold, with its threshold calibrated for zero FP on
clip2, then frozen. Reference all:r1 was predeclared in the decoding protocol.
Before evaluation readout, the primary was selected using clip2 ONLY: maximize
calibration TP among zero-FP variants, tie prefer fullframe then smaller radius.
That picks all:r4, 27 calibration TP / 0 FP, threshold 2,198. Selection is recorded in
`calibration-selection.json`; no evaluation thresholds were adjusted.

| Scope | Dilation radius | Frozen threshold | TP | FP |
| --- | ---: | ---: | ---: | ---: |
| Full frame | 0 | 1700 | 100 | 13 |
| Full frame | 1 | 1850 | 89 | 14 |
| Full frame | 2 | 1850 | 83 | 13 |
| Full frame | 4 | 2198 | 91 | 13 |
| Fixed-HUD proxy | 0 | 1700 | 118 | 13 |
| Fixed-HUD proxy | 1 | 1850 | 104 | 14 |
| Fixed-HUD proxy | 2 | 1850 | 98 | 13 |
| Fixed-HUD proxy | 4 | 2198 | 92 | 13 |

The masked rows exclude fixed rectangles: centre 50% of the bottom 12%, and the
right 15% of the top 18%. **This is a diagnostic GUI proxy, not an oracle mask.**
All real fire remains positive truth even inside those rectangles. Actual
per-piece GUI masking is separate work and was not assumed implemented here.

Merging increases component support, but also merges unrelated background
orange. Recalibrated largest-component thresholds still miss meaningful fire
on other videos; clipping or fragment breakup alone cannot explain the errors.
The per-frame false-clear boxes are saved for review; counts are not a claim
that these are intrinsically unlabelable flames.

## Reproduce and checks

```powershell
python fire-detection/bench/no_fire/fragment_pilot.py .board/no-fire-parallel/fragments --threads 2
rustc --edition 2021 --test fire-detection/bench/no_fire/fragment_rules.rs -o .board/no-fire-parallel/fragments/tests.exe
.board/no-fire-parallel/fragments/tests.exe
```

Four targeted tests pass: fragment joining, radius separation, original area
preservation, white rejection and boundary dilation. All 1,579 fresh frames have
exact radius 0 parity with the prior shared-auto orange baseline, across all
four raw/auto/full/HUD branches. Merged scores are monotonic with radius.

The run initially decoded calibration sequentially, then reused that cache only
after verifying helper source/shared-unveil hashes and stride, to parallelize
the three evaluation recordings. The final protocol records its cache hash and
fresh evaluation decoding. No source truth or app labels were changed.

Ignored evidence: `.board/no-fire-parallel/fragments/{report,protocol,
frozen-thresholds,calibration-selection}.json` and four per-recording JSON files.
Protocol records helper/Python/shared-veil hashes. Do not commit videos, assets,
native binaries or caches.
