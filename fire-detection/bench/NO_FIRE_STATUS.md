# Conservative no-fire detector pilot

## Deterministic colour-support follow-up (2026-10-17)

User superseded the learned-model approach: sample opaque fire texels from the
known sprites and recorded quads, inspect contaminants, then test a simple
colour-count gate. **The strict colour-only gate cleared no held-out no-fire frames.**

`no_fire/colour_support.py` sampled 6,930 projected opaque texel centres from 229
frames spanning quad1 and survival1 (one frame per second, up to 32 randomly
selected centres per eligible frame, fixed seed 7103). Sampling uses the actual
sprite alpha and UV-to-screen homography, recorded visibility >= 0.999, and a
projected texel-size screen. Transparent sprite holes and quad backgrounds are
not intentionally sampled. The logs do not retain per-pixel occlusion masks:
smoke, other fire planes, held items and blaze bodies can still contaminate these
candidate points. Older clip1/clip2 logs lack quad corners, so they are tests,
not sources of per-texel colour truth.

I inspected one marked representative from each of the 66 occupied coarse RGB
groups in the quad1 fit sample. Thirty-seven representatives visibly landed on
flame; their groups retained 753 fit points. Ambiguous/background, smoke, portal,
blaze-body and hand/UI representatives were omitted. This is **colour-group
screening, not a claim that every retained point was individually verified**.
Review selections and contact sheets are kept locally under
`.board/fire-color-support/`, outside version control.

The retained fit colours ranged from RGB [128, 46, 0] to [255, 227, 233]. These
componentwise bounds are not an RGB box classifier: arbitrary combinations of
those channel values need not be fire colours. The largest distance to the
nearest opaque original sprite-palette colour was **68/255**, measured as the
largest absolute channel difference (Chebyshev RGB distance). Median was 17,
95th percentile 39, and 99th percentile 54. The 37 individually reviewed
representatives also had maximum 68. This is an empirical fit-sample maximum,
**not an upper bound on every fire pixel in every recording**. Edges, distant
fire, fog, portal effects and veils are not exhaustively represented.

Two lookup tables were frozen from quad1 only, before held-out scoring: recorded
RGB, and conditional-unveil RGB. Colours are quantized to eight-level bins,
then expanded by one bin in each direction. This admits differences of up to
15 channel levels depending on bin boundaries. The cleaned raw table occupies
4.55% of the RGB cube. No threshold was fitted to the test recordings.

Full-resolution 1920x1080 frames were scored every 90 frames (1.5 seconds),
covering the complete duration of all four videos. Every pixel below the
12-pixel sync-strip exclusion participates in the count; no thumbnail,
morphological opening or minimum fire-size filter is used. Tiny/occluded labelled
fires remain in the test denominator. Capture-mod fire/no-fire labels have
known imperfections and are not exhaustive human verification.

| Recording | Role | Frames | Fire | No fire | Cleared at <1 matching pixel | Missed fire |
|---|---|---:|---:|---:|---:|---:|
| clip1 | Held out | 363 | 230 | 133 | 0 | 0 |
| clip2 | Held out | 218 | 138 | 80 | 0 | 0 |
| survival1 | Held out | 919 | 417 | 502 | 0 | 0 |
| quad1 | Fit-recording diagnostic | 79 | 50 | 29 | 0 | 0 |

Both raw and conditional-unveil branches produced these results. Across the
**1,500 held-out frames**, the strict absence gate cleared **0/715 no-fire
frames**, with **0/785 labelled fire frames missed**. At cutoffs of 2, 4 or 16
matching pixels, coverage was also zero. At <64 pixels it cleared one clip2
no-fire frame, still with zero observed misses (1/715 = 0.14% coverage).
The fewest matches in a held-out fire frame was 762, but these are whole-frame
candidate-colour counts, **not 762 verified fire pixels**; background matches
can hide failures of the fire-colour envelope.

Keeping all unreviewed samples included near-black background/smoke colours and
made the gate even less selective. That baseline also cleared nothing. A raw
maximum from these contaminated samples is not a meaningful fire-colour bound.

Conclusion: the proposed sampling is practical, but this first conservative
colour-union/count rule is not useful for clearing footage. White/yellow/orange
fire colours also occur throughout ordinary scenery. Zero observed misses here
does not establish reliable fire-pixel coverage or justify a larger automatic
clear threshold. Nothing was integrated into the app or used to write labels.

Reproduction with local recordings/assets:

```powershell
python fire-detection/bench/no_fire/colour_support.py sample .board/fire-color-support
python fire-detection/bench/no_fire/colour_support.py review .board/fire-color-support
# Inspect fit-bin-review contact sheets; preserve explicit review selections.
python fire-detection/bench/no_fire/colour_support.py evaluate .board/fire-color-support --reviewed-bins .board/fire-color-support/reviewed-bins.json --threads 6
python -m unittest discover -s fire-detection/bench/no_fire -p test_colour_support.py
```

The review JSON supplies `accepted_rgb_bins_32` and `reviewed_positive_pixels`
(indices in the saved pixel arrays); source and per-frame count artifacts remain
local. Only the two targeted projection/UV and colour-support boundary tests
were run for this follow-up.

## Earlier learned-model pilot (superseded)

2026-10-17. **Research result: none of these variants is ready to auto-clear frames.**
The objective is useful—accept only easy no-fire frames, leave everything else for review—but the present models either
abstain almost everywhere or clear real fire. Nothing was added to the desktop app or used to change saved labels.

## Previous progress

The historical colour/blob detectors worked mainly for big, nearby fire. Small/distant fire remained weak; temporal
flicker did not fix it. The first-person matcher is strong for the overlay, but a rejected overlay does not establish
absence of world fire. See [historical experiments](../core/DETECT_PLAN.md) and
[first-person status](FIRST_PERSON_STATUS.md). Conditional GUI-veil reversal already exists in the native detector and app;
this pilot uses the same vanilla gradient and margin-based detection rule.

## What was tested

Five new models, plus 41 historical detector variants rescored for the no-fire objective:

- Raw full-frame statistics: colour-candidate counts, local maxima at several scales, colour distributions and brightness.
- The same statistics with **raw plus conditionally unveiled** evidence; no truth veil flag is fed to the model.
- Learned **16-cluster RGB k-means**, using whole-frame and local cluster occupancy; raw and conditional-unveil variants.
- Cluster occupancy combined with native-pixel raw/unveil statistics.
- Historical palette-distance counts, morphological opening/largest blobs, learned patch scores, temporal flicker,
  first-person evidence, and refitted shallow blob-shape trees for the three old mask configurations.

The five learned frame models use a 64-unit ReLU MLP, dropout during fitting, and one fire-evidence score. This is **not**
a pretrained image CNN. RGB clusters are learned only on the fitting portion of clip1. Clustering operates on 256×144
thumbnails and can lose tiny fires; the combined variant also receives original-pixel colour evidence. Original-pixel
counts never remove a candidate just because its region is small. There is no world-fire localization model here.
Known-quad sprite matching remains separate; an oracle-box sprite matcher cannot establish whole-frame absence.

## Split and acceptance rule

| Recording | Role | Sampled frames | Fire | No fire |
|---|---|---:|---:|---:|
| clip1, 2026-10-15 14-48-36 | Fit/development | 1,088 | 685 | 403 |
| clip2, 2026-10-15 18-18-16 | Acceptance calibration | 652 | 392 | 260 |
| quad1, 2026-10-16 00-40-22 | Held out from fitting/calibration | 237 | 157 | 80 |
| survival1, 2026-10-16 18-23-42 | Held out from fitting/calibration | 2,757 | 1,258 | 1,499 |

Fixed stride 30 at 60 fps: **2 sampled frames/second**, 4,734 frames total. Clip1 uses a temporal 70/30 split with
an eight-sample guard: 757 fitting frames, 323 development frames. Seeds, architecture, features and epoch-selection
rule were fixed before test results. The initial two models' weights were saved before the test recordings were scored;
final evaluation verifies exact equality with those frozen parameters. Clustering was the later user-requested family;
its three variants were predefined and were not retuned from test results. These recordings have been used by other
project research, so this is held-out fitting data for this pilot, not a pristine benchmark for the whole project.

Accept a no-fire candidate only when the fire score is **strictly below the lowest fire score in calibration**. Ties
remain review. The threshold is calibrated using the exact portable inference path; scores are not calibrated
probabilities and zero calibration errors do not imply zero future errors. All labelled fire stays positive, including
small, distant and heavily occluded examples. Unknown/unsynchronized labels are excluded. Neither game tick, texture row,
label geometry nor label area is a model input. The sync strip is cropped out of pixel features.

## New-model results

Each entry below is **true no-fire frames cleared / real fire frames wrongly cleared**. Calibration has 260 no-fire and
392 fire frames. The combined tests have 1,579 no-fire and 1,415 fire frames.

| Model | Calibration | quad1 test | Survival test | Combined test no-fire coverage |
|---|---:|---:|---:|---:|
| Raw statistics | 9 / 0 | 0 / 0 | 3 / 1 | 0.19% |
| Raw + auto-unveil statistics | 2 / 0 | 0 / 0 | 0 / 0 | 0% |
| RGB clusters, raw | 0 / 0 | 0 / 0 | 13 / 8 | 0.82% |
| RGB clusters, raw + auto-unveil | 1 / 0 | 0 / 0 | 13 / 7 | 0.82% |
| Clusters + native raw/unveil statistics | 14 / 0 | 0 / 0 | 0 / 0 | 0% |

The raw-statistics error occurs under a strong purple portal effect. The clustering variants clear multiple real-fire
frames despite clearing only 13 no-fire frames. Keeping unveil evidence makes some models more cautious, but does not
produce useful held-out coverage. **Do not raise thresholds on these test recordings and then claim independent results.**

## Historical families under the new objective

These reuse historical feature/prediction CSVs; they are not fresh pixel reruns or independent recordings. Acceptance
uses an earlier temporal section and evaluation a later section. Learned blob trees use separate 60% fit, 20% calibration,
20% test sections. Tiny fire is included now, unlike earlier big/near-only summaries.

| Representative historical method | No-fire cleared | Fire wrongly cleared |
|---|---:|---:|
| Raw palette count | 0 / 504 | 1 / 801 |
| Always-unveiled palette count | 27 / 504 | 0 / 801 |
| Palette D24 + opening radius2, largest blob | 35 / 504 | 3 / 801 |
| Palette D40, largest blob | 46 / 504 | 3 / 801 |
| Learned patch scores | 0 / 63 | 0 / 198 |
| Temporal flicker, threshold60 total | 0 / 946 | 0 / 1,566 |
| First-person evidence as whole-frame absence | 0 / 1,022 | 0 / 1,588 |
| Learned blob variants A/B/C | 0 / 307 | 0 / 998 |

Always-unveiled palette count is an interesting **same-recording diagnostic**, not an approved winner. It was one of many
reported variants on clips used to develop those cues; it needs a separately frozen cross-recording test. Morphological
opening can delete exactly the tiny fire we need to protect. The complete 41-variant results remain in the local JSON.

## Limits

Labels come from synchronized game logs, not exhaustive human pixel review. Previous visual audits found some no-fire
logs with visible fire; this pilot does not silently repair labels using model predictions. Menu/portal/occluded cases
may be visually ambiguous. Area buckets use summed visibility-weighted boxes, not exact segmentation. Samples are
correlated and can miss short transitions between sampled frames. Clearing a sampled frame must never clear a whole
interval. Full-frame-rate, transformed/YouTube video, other resource packs and other game versions are not established.

## Reproduce

Run from the repository root. Python requires numpy/Pillow; fitting also requires PyTorch. No scikit-learn or GPU is
required. Existing local research Python: `.board/fire-ai/venv/Scripts/python.exe`.

```powershell
$py = '.board/fire-ai/venv/Scripts/python.exe'
& $py -m unittest discover -s fire-detection/bench/no_fire -p 'test_*.py'
& $py fire-detection/bench/no_fire/prepare.py .board/no-fire-pilot --stride 30
& $py fire-detection/bench/no_fire/train.py .board/no-fire-pilot
& $py fire-detection/bench/no_fire/clustering.py .board/no-fire-pilot
& $py fire-detection/bench/no_fire/legacy.py .board/no-fire-pilot
# Research-only frame-statistic CLI, without labels. Clustering remains an offline ablation.
& $py fire-detection/bench/no_fire/predict.py .board/no-fire-pilot/raw_plus_auto_unveil.json `
  'fire-detection/data/video/2026-10-15 18-18-16.mkv' `
  --ffmpeg FireCrackle/src-tauri/runtime/ffmpeg.exe --stride 30 --limit 3
```

Ignored `.board/no-fire-pilot/` contains decoded-feature NPZs, provenance manifests, frozen portable models, score arrays,
`report.json`, `clustering-report.json`, `legacy-report.json`, calibration previews and false-clear contact sheets.
Raw images, labels, assets, models and video are not committed or bundled. Application source and the other model's
known-quad files are untouched.
