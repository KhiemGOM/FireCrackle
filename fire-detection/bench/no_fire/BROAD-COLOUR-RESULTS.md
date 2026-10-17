# Broader orange colour ablation

2026-10-17. Positive = correctly clear no-fire/negligible; FP = meaningful fire
wrongly cleared. No learned model, white/pale evidence, forced unveil, or GUI
oracle was introduced. Shared `core/src/veil.rs` handles all automatic unveil.

Fresh native 1920x1080 decode at stride90:218 clip2 calibration frames;1,361
separate-recording evaluation frames (clip1=363,quad1=79,survival1=919).
Evaluation contains755 clear-eligible and606 meaningful-fire frames. Meaningful
uses the approved24-native-pixel horizontal visible-box proxy, no height cutoff.
These recordings are familiar and temporally correlated; zero observed FP does
not establish a guarantee.

Three predeclared nested colour supports:

| Support | RGB rule |
| --- | --- |
| Original orange | R>=64; .23R<=G<=.88R; B<=.5R; R-B>=24 |
| Dark | R>=32; .23R<=G<=.88R; B<=.5R; R-B>=20 |
| Dark/red | R>=32; .12R<=G<=.95R; B<=.6R; R-B>=20 |

The extensions were motivated by previous projected chromatic sprite-texel
samples. That historical sample has contamination/occlusion and predates shared
unveil; its coverage is diagnostic, not a newly validated colour envelope.
Clip2 yielded no sufficiently large qualifying projected texel centres under the
existing geometry sampler. No held-out colours were fitted to choose ranges.
All rules exclude achromatic white/grey. Top12 rows are excluded consistently
with the earlier pilot; no other GUI region is removed. Ideal GUI-piece masking
is still a future prerequisite, not something simulated by blanking rectangles.

Eight scores per support (pixel total, largest8-connected blob, overlapping
24/48/96-square local counts, and local orange-to-orange contrast counts) combine
raw and automatic-unveil evidence by maximum. Every threshold is zero-FP
calibrated on clip2 and frozen before evaluation. Primary selection, recorded
before reading evaluation metrics, chooses the expanded-colour score with most
clip2 TP, then lexicographic key: **dark:texture24 <123**,30 calibration TP/0FP.

| Frozen rule | TP | FP |
| --- | ---: | ---: |
| Primary dark texture24 <123 | 7 | 0 |
| Original local24 <440, parity reference | 24 | 0 |
| Dark local24 <562 | 65 | 19 |
| Dark/red local24 <576 | 39 | 13 |
| Original largest blob <1700 | 100 | 13 |
| Dark largest blob <10756 | 80 | 28 |

Broader colour support alone did not improve this task. The primary clears only
0.93% of eligible evaluation frames, versus3.18% for original local24. Broadening
support also admits warm background, which lifts calibrated count thresholds;
those more permissive thresholds transfer poorly. The prior exploratory
46TP/0FP combination remains a separate benchmark, not replaced by this pilot.
Primary source splits:clip1=0TP/0FP,quad1=1TP/0FP,survival1=6TP/0FP.

Local evidence lives under ignored `.board/no-fire-parallel/colours/`:
`protocol.json` records source hashes, `primary-selection.json` records selection,
`frozen-thresholds.json` records thresholds, `{source}.json` stores per-frame
scores and unchanged truth, and `report.json` contains all24 variants, source
splits and exact error frames/boxes. The false-clear lists permit later visual
review; these errors were not used to change thresholds.

Reproduce from repository root with local recordings/labels/assets present:

```powershell
python fire-detection/bench/no_fire/broad_colour_pilot.py .board/no-fire-parallel/colours --threads 2
```

Targeted checks:two native tests verify support nesting and rejection of every
achromatic grey/white value; Python syntax compilation passed. The original
local24 and largest-blob results reproduce the earlier shared-unveil benchmark.
No app labels, game assets, or recordings were changed or committed.
