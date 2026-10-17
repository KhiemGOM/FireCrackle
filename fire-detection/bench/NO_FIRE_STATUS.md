# Conservative no-fire detector pilot

## Connected orange/pale regions follow-up (2026-10-17)

User proposed blobs with separate orange and white/pale regions and explicitly
allows negligible fire to count as no fire. Implemented an offline deterministic
prototype in `no_fire/colour_blobs.rs`, driven by `no_fire/blob_pilot.py`.
No trained model, application integration or automatic label writes.

The detector finds **two individually connected colour regions** (8-neighbour
connectivity) that actually touch. Each region must contribute >=2 pixels and
>=5% of their combined area. Scattered matching pixels elsewhere in the frame
do not count as a pair. The main candidate cutoff tested was 16 combined pixels;
4 and 64 were also reported. A stricter diagnostic requires colour-region
centroids to differ by >=12% of the combined bounding-box diagonal, without a
fixed direction. That extra condition can reject a pale core surrounded by an
orange rim even though the two regions are visually distinct; it is not a
necessary definition of a valid flame.

Raw and conditionally unveiled branches are both checked: either may retain a
frame for review. Colour bands are explicit and disjoint. The original pale
band required R>=110, G/R>=0.65 and B/R>=0.35, with broad warm-neutral limits;
the orange band uses R>=64, G/R in [0.23,0.88], B/R<=0.5 and R-B>=24. Pale takes
precedence where bands overlap. A warmer variant permits yellow cores with
G/R>=0.6 and R/G>=0.9, without a minimum blue fraction. This was motivated by
visually obvious first-person flames whose translucent cores were yellow,
not literal white. These are new fixed-band baselines, not the earlier sampled
RGB lookup table; total-count and single-component baselines use the same bands
for a fair comparison of the spatial rule.

All four recordings were evaluated over their full duration at stride90,
1920x1080 native resolution: **1,579 frames**, with 744 labelled no-fire and
835 labelled fire. There are 831 non-negligible and four negligible fire
frames under the configurable size proxy. A source counts as non-negligible
when its recorded visible box is at least four screen pixels wide AND tall.
This is a pragmatic box-footprint proxy, not an exact visible-flame pixel count.
No fire samples are silently removed from results; negligible clears and larger
misses have separate fields. The four tiny examples are too few to evaluate
that size policy well.

Hotbar items repeatedly produced convincing pairs: e.g. clip1 frame180's strongest
pair occupied [832,1008]-[904,1070], inside the HUD. A diagnostic therefore masks
the middle half of the bottom12% of the image and the right15% of the top18%
(status icons). This is a fixed vanilla-HUD guess, not general UI segmentation.
Actual fire in excluded regions remains in truth and counts as a miss.

| Variant, cutoff16 | No-fire frames cleared /744 | Larger fire missed /831 |
|---|---:|---:|
| Total matching pixels, same bands | 0 | 0 |
| Largest single-colour region, same bands | 0 | 0 |
| Orange + literal pale pair, full frame | 19 (2.6%) | 0 |
| Orange + yellow/pale pair, full frame | 19 (2.6%) | 0 |
| Yellow/pale pair plus centroid separation, full frame | 20 (2.7%) | 0 |
| Literal pale pair, HUD excluded | 79 (10.6%) | 14 |
| Literal pale pair + separation, HUD excluded | 80 (10.8%) | 16 |
| Yellow/pale pair, HUD excluded | 68 (9.1%) | 7 |
| Yellow/pale pair + separation, HUD excluded | 68 (9.1%) | 8 |

No variant in this table cleared any of the four negligible-fire frames: unrelated
candidate regions kept them in review. Allowing tiny fire therefore does not
explain away the reported misses. The literal pale rule missed obvious large
first-person overlays (e.g. clip2 frames5850 and13500); yellow-core handling
rescued those examples, but other large overlays remained misses. Distant/fogged
fire was another failure. At cutoff4 the yellow/pale + separation/HUD rule cleared
62 negatives and missed four larger fires; cutoff64 cleared82 and missed20.
Increasing the blob-size cutoff is not a free gain in coverage.

The two-region idea improves discrimination over counts and single-colour blobs.
However, full-frame zero-miss results are partly propped up by false HUD
candidates, and removing those exposes incomplete flame sensitivity. A useful
next conservative safeguard is to retain strong orange-only blobs for review
when a pale core is absent. This pilot does not justify automatic no-fire labels.

The warmer band and HUD variant were developed after inspecting failures from
the initial runs. These comparisons use familiar recordings and approximate
capture-mod labels; they are **diagnostic results, not an untouched holdout or
a guarantee of no missed fire**. Example frames with label boxes, per-frame
measurements, frozen protocols and executable/source snapshots are local under
`.board/fire-blob-support/`. Data, media and binaries remain outside version control.

Reproduce either colour variant with local recordings and Rust installed:

```powershell
python fire-detection/bench/no_fire/blob_pilot.py .board/fire-blob-support/repro-literal --pale-mode literal
python fire-detection/bench/no_fire/blob_pilot.py .board/fire-blob-support/repro-yellow --pale-mode yellow --min-fire-side 4
rustc --edition 2021 --test fire-detection/bench/no_fire/colour_blobs.rs -o .board/fire-blob-support/blob-tests.exe
.board/fire-blob-support/blob-tests.exe
python -m unittest discover -s fire-detection/bench/no_fire -p test_blob_pilot.py
```

Only four native tests and one Python metrics test were run for this follow-up:
connected/contact requirements, isolated pixels and single-colour rejection,
colour-band distinction including yellow cores, HUD exclusion boundaries, and
separate tiny/larger-fire accounting with raw/unveil review logic.

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

## Current practical training target and resumed blobs (2026-10-17)

The user authorized a reasonable practical cutoff and continuation of the original deterministic
colour/blob algorithm. Adopt **horizontal visible-source box width >=24 native pixels** at
1920x1080 as meaningful fire; smaller sources are negligible for this training task. A frame
is meaningful if any source meets the cutoff. This is an intentionally pragmatic proxy,
not a claim that width guarantees distinguishable sprite columns. Raw joined labels remain
unchanged; derived targets preserve no-fire versus negligible-fire classes and exclude unknowns.

All 141,959 labelled frames across four recordings now have derived target files in
`.board/no-fire-width24/*-targets.jsonl`: 65,077 meaningful fire, 9,506 negligible fire,
67,376 no-fire. The positive class for this filter is **clear no-fire/negligible**; FP is
**meaningful fire incorrectly cleared**.

Reused real-video yellow/pale connected-region evidence (raw and conditional unveil combined
with max). Freeze pair thresholds on clip2 at zero observed calibration FP: full-frame pair
score <112, or HUD-excluded pair score <5. The new guarded branch additionally requires the
largest remaining single warm component <4,096 pixels; large warm blobs stay review because
the pale region may be obscured/merged. These are connected-region scores, not total pixels.

| Rule | Evaluation TP | Evaluation FP | Correct clear recall |
| --- | ---: | ---: | ---: |
| Full-frame pair | 7 | 0 | 0.9% |
| HUD-excluded pair, unguarded | 34 | 1 | 4.5% |
| Full-frame OR guarded HUD-excluded pair | 25 | 0 | 3.3% |

Evaluation is clip1+quad1+survival1: 1,361 sampled frames, 755 clear-eligible targets and 606
meaningful fire. Calibration clip2 is excluded from this table. This is **post-hoc diagnostic
evidence**: the 4,096 guard was chosen after examining an evaluation false clear (clip1 frame6660),
so this is not blind validation or a zero-FP guarantee. That frame contains a roughly34px
orange flame; the guard keeps it for review. Eight additional sampled cleared frames were
visually reviewed; no obvious meaningful fire was found. Very low clear coverage remains the
main weakness. No application labels or whole intervals are automatically cleared.

```powershell
python -m unittest discover -s fire-detection/bench/no_fire -p test_blob_calibration.py
python fire-detection/bench/no_fire/blob_calibration.py .board/fire-blob-support/yellow .board/no-fire-width24
```

The report includes input hashes, original detector protocol, frozen thresholds, per-recording
TP/FP and derived full-recording training targets. Only source/tests/report prose are committed.

## Registered temporal baseline (2026-10-17, historical size proxy)

An offline registered three-frame burst test (frames n,n+3,n+6; anchors every90frames)
was completed across all four recordings. Low warm-texture activity is treated as a
candidate no-fire clear; registration failures remain review. Clip2 calibrates thresholds,
then clip1/quad1/survival1 evaluate them without retuning.

These results use the **old 4px minimum-side box proxy**, not the user's subsequently clarified
sprite-readability definition. On 1,361 evaluation anchors, strict zero-FP and 1%-FP calibration
budgets both produced **TP0/FP0** (abstain). Allowing a 5% calibration FP budget produced
**TP157/FP51** for repeated change, or **TP120/FP38** for brightness reversal. Positive means
**clear no fire**; FP means meaningful fire wrongly cleared. Thus temporal inactivity is not
safe absence evidence, and this baseline is not adopted. Small flames can remain static in
short bursts. Saved per-frame boxes/scores support later relabelling without decoding again;
no width8 relabelling was applied. Local provenance: `.board/fire-positive-temporal/`.

## Sprite readability correction (2026-10-17)

The user means **distinguishable horizontal sprite columns after scaling and compression**,
not a flame box narrower than 8 native video pixels. Eight distinguishable columns is the
proposed lenient reference, sixteen the full-detail reference. Neither the old 4px minimum-side
rule nor a new 8px width rule establishes this. No benchmark labels were changed to width8.

`no_fire/sprite_readability.py` audits 32 real block-fire examples in the two recordings with
quad geometry, spanning about 0.4–6 decoded video pixels per sprite texel. It compares strong
opaque horizontal sprite colour edges with actual native decoded pixel samples. Logged
visibility is imperfect: visual inspection found foreground blocks/portal effects in some
supposedly fully visible examples. Such failures are **unknown**, not proof of compression loss
and never permission to clear meaningful fire.

A controlled sensitivity test uses a visibly clear real flame (survival1 frame 3030, sheet1
row14), downsampled to six projected texel pitches and optionally re-encoded as single-frame
H.264 yuv420p at CRF18/28/38. At roughly 3 video px/texel, 30/41 eligible strong horizontal edge
pairs survived without additional encoding, versus 13/41 at CRF28 and 6/41 at CRF38. At roughly
0.5 px/texel, those counts were 9/41, 7/41 and 4/41. These are **edge-pair diagnostics, not a
count of distinguishable columns**; sampling alignment is non-monotonic and a universal
human-readability cutoff has not been validated. Added encodes are stress tests, not claims
about the original recording's encoder settings.

Local visual outputs: `.board/fire-size-gallery/controlled.html`, `controlled-comparison.png`,
`readability.html` and corresponding JSON provenance. Source/tests only are suitable for git.

```powershell
python -m unittest discover -s fire-detection/bench/no_fire -p test_sprite_readability.py
python fire-detection/bench/no_fire/sprite_readability.py .board/fire-size-gallery --per-target 4
python fire-detection/bench/no_fire/sprite_readability.py .board/fire-size-gallery --controlled-only
```

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
