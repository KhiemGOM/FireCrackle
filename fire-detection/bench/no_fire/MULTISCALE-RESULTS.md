# Multiscale no-fire ablation

2026-10-17. Positive = correctly clear no-fire/negligible fire. FP = meaningful
fire wrongly cleared. No CNN or learned classifier.

This experiment **reuses existing hashed pixel-score caches**, rather than
decoding the same recordings again. Those caches were freshly decoded with the
canonical shared Rust automatic unveil. Their protocol's veil source hash is
checked against current `core/src/veil.rs`; raw and automatically unveiled
scores already combine by maximum. No new colour or inverse math is introduced.

Calibration: 218 clip2 frames only. Evaluation: 1,361 stride90 frames from clip1,
quad1 and survival1, containing 755 clear-eligible and 606 meaningful-fire
examples. The existing width24 horizontal visible-box proxy remains unchanged;
there is no height cutoff. Familiar recordings and temporally correlated samples
limit generalization; this is not independent blind validation.

## Frozen method

Each local-orange or orange-texture count at 24/48/96-pixel window size is
divided by its minimum meaningful-fire score on clip2. The three scales, or all
six local/texture measurements, combine with min, mean or max. For each resulting
score, the clear threshold is **80% of its minimum calibration-fire score**;
clear requires strictly less. Missing/invalid evidence stays review.

All 18 ablations and the primary `all:both:max` were specified before evaluation.
Calibration and evaluation are separate invocations; evaluation verifies that
the script has not changed since the frozen configuration was written.
No evaluation false clear was used to adjust thresholds.

`min` means any sufficiently weak scale can clear a frame. `max` requires every
scale to be weak relative to the calibrated threshold. `mean` lies between them.
Thresholds differ between aggregates because each aggregate is calibrated
separately; max is not necessarily a subset of mean after recalibration.

## Evaluation

| Scope and measurements | Min TP / FP | Mean TP / FP | Max TP / FP |
| --- | ---: | ---: | ---: |
| Full frame, local orange | 51 / 6 | 12 / 0 | 8 / 0 |
| Full frame, orange texture | 7 / 0 | 7 / 0 | 7 / 0 |
| Full frame, both | 51 / 6 | 8 / 0 | **7 / 0** |
| HUD proxy excluded, local orange | 74 / 11 | 58 / 9 | 48 / 7 |
| HUD proxy excluded, orange texture | 28 / 0 | 25 / 0 | 22 / 0 |
| HUD proxy excluded, both | 78 / 11 | 30 / 0 | 30 / 0 |

Unchanged comparisons reproduced on the same cache:

| Existing rule | TP | FP |
| --- | ---: | ---: |
| Full-frame local24 | 24 | 0 |
| Previous exploratory union | 46 | 0 |

The primary conservative multiscale rule is worse than the existing local24
rule. Permissive full-frame min adds 13 correct clears beyond the old union,
but wrongly clears six meaningful-fire frames, including quad1 frame5310.
It is unsuitable for confident no-fire clearing.

The two HUD-proxy both/mean and both/max ablations each add only **one** correct
clear beyond the old union, with zero observed false clears. An exploratory
union would therefore produce 47 TP / 0 FP instead of 46 / 0. This is a tiny,
evaluation-selected increment, not a new independently validated best rule.

## GUI masking and limits

The user allows an oracle GUI-mask assumption for future method exploration.
These existing `nohud` scores **do not implement that oracle**: they omit fixed
rectangles, which can also contain world fire. All real fire remains positive
truth. The diagnostic numbers must be rerun using the forthcoming GUI-piece mask
before drawing conclusions about an actual oracle or production GUI handling.

Zero FP among 606 correlated fire samples is not a safety guarantee. Even an
independent-binomial interpretation would only put the one-sided 95% upper
false-clear rate near 0.5%; correlation and familiar-data selection weaken that
interpretation. No app labels, source truth or production algorithm changed.

## Reproduction

From the repository root, with the existing ignored caches present:

```powershell
python fire-detection/bench/no_fire/multiscale_pilot.py calibrate
python fire-detection/bench/no_fire/multiscale_pilot.py evaluate
python -m unittest discover -s fire-detection/bench/no_fire -p test_multiscale_pilot.py
```

Ignored evidence: `.board/no-fire-parallel/multiscale/frozen-config.json` and
`report.json`, including thresholds, source/cache/config hashes, all ablations,
false-clear frame IDs and incremental clears beyond the previous union.
Only the two targeted tests were run for this code.
