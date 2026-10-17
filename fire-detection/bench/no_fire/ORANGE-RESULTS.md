# Orange-only no-fire pilot, shared-unveil rerun

2026-10-17. Positive means **correctly clear no-fire/negligible fire**.
FP means meaningful fire wrongly cleared; keeping FP low is the priority.

Fresh RGB decoding of all four recordings at stride 90 (every 1.5 seconds at
60 fps), at native 1920 x 1080. 218 clip2 calibration frames are excluded from
evaluation. Evaluation has 1,361 frames: 755 clear-eligible and 606 meaningful-fire
frames, spanning clip1, quad1 and survival1. This is full-duration sampling,
not every-frame validation. Meaningful fire uses the owner-approved pragmatic
24-pixel horizontal visible-box width proxy, with no height threshold.

Both the orange-only rules and the earlier orange/pale baseline were rerun from
pixels using the canonical `core/src/veil.rs`. Raw and automatic-unveil evidence
are combined by maximum: either branch can retain a frame for review. No
truth-driven unveil or forced-on correction. Original calibration thresholds
were frozen before this rerun; no threshold was adjusted to fix evaluation errors.

| Rule | TP: correct clears | FP: fire cleared | Clear recall |
| --- | ---: | ---: | ---: |
| Largest orange blob < 1,700 | 100 | 13 | 13.25% |
| Full-frame local orange, 24px window < 440 | 24 | 0 | 3.18% |
| Earlier guarded orange/pale baseline | 25 | 0 | 3.31% |
| HUD-excluded orange texture, 96px window < 16 (diagnostic) | 28 | 0 | 3.71% |
| Local-orange OR HUD-excluded texture (exploratory) | 44 | 0 | 5.83% |
| That exploratory combination OR guarded baseline | 46 | 0 | 6.09% |

Full-frame orange texture alone adds no clears beyond the local-orange rule.
The exploratory 46-clear combination adds 21 clears to the previous 25-clear
baseline on these familiar recordings, but is not independent validation.

## Interpretation and error review

The largest-blob rule remains unsuitable: a zero-FP calibration threshold does
not transfer. Its 13 evaluation false clears include six clip1 frames, two quad1
frames and five survival1 frames. Some capture boxes are much wider than the
24px cutoff (e.g. quad1 frame 5310 has a roughly 104px-wide visible fire box),
so treating every error as negligible-size fire would be incorrect. A scene's
largest orange component is also often background, rather than the actual flame.
Local orange support retains every one of those 13 errors in this sample.
The four-frame visual review confirms distant world flames and, in quad1,
flame fragments partly hidden by large smoke particles. Shared automatic unveil
correctly stays off for these scenes; forcing a menu correction is not the fix.
The local review image is `shared-auto/largest-blob-failures.png`.

The safest orange-only result currently remains the **full-frame local24** rule,
which approximately matches, rather than improves on, the earlier baseline.
Automatic unveil fixes the menu regression but does not solve the low clear rate.

HUD-excluded rules still remove fixed screen regions, not recognized GUI pieces.
They remain diagnostic even when observed FP is zero. Real fire in those regions
must remain positive truth. Do not ship the exploratory union as confident
automatic clearing until it has been checked with recognized GUI/unknown masks
and separate recordings. GUI-neutral colours in the shared unveil are neutral
only for veil detection; they are never counted as fire evidence.

The recordings and selected rules have been inspected repeatedly; samples are
temporally correlated. Zero observed FP is not a guarantee. No app labels or
source truth files were changed.

## Reproduction and local evidence

From the repository root, with the existing local videos, joined labels and
historical frozen configurations present:

```powershell
python fire-detection/bench/no_fire/orange_pilot.py .board/no-fire-orange/shared-auto --thresholds-from .board/no-fire-orange/frozen-thresholds.json
python fire-detection/bench/no_fire/blob_pilot.py .board/no-fire-orange/shared-baseline --pale-mode yellow
python fire-detection/bench/no_fire/orange_compare.py .board/no-fire-orange/shared-auto .board/no-fire-orange/shared-baseline .board/no-fire-width24/frozen-config.json
```

`orange_compare.py` applies the 24px policy consistently to both fresh caches;
the baseline pilot's own legacy summary uses a different size policy and must
not be substituted for the comparison. The baseline configuration stays at
all-pair <112 OR (HUD-excluded pair <5 AND largest remaining warm blob <4096).

The ignored `shared-auto/comparison.json` records per-cache hashes, canonical
veil source hash, counts, all rule variants and primary error frames/boxes.
`shared-auto/protocol.json` records a fresh decode and preprocessing source hash.
The orange and baseline helper binaries are regenerated from current source.
Keep historical results separate; do not overwrite them with changed preprocessing.
