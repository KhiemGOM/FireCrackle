# Real-only normal-fire phase models

19 October 2026. **The 128px ResNet-101 is the best individual model in this pilot:425/617
(68.9%), versus 393/617 (63.7%) at 64px.** It still loses to the deterministic
matcher on entity fire. The initial 64px architecture comparison is below;
the approved 128px follow-up and measured trade-offs are at the end.
No production matcher or automatic confirmation was changed. Outputs are the
32 animation phases; sheet and mirror are not prediction targets.

| Method | Correct phase / 617 | Accuracy | Blocks / 425 | Entities / 192 |
|---|---:|---:|---:|---:|
| Existing deterministic shared-gain matcher | 363 | 58.8% | 222 (52.2%) | 141 (73.4%) |
| Real-only ResNet-18 | 288 | 46.7% | 209 (49.2%) | 79 (41.1%) |
| **Real-only ResNet-101** | **393** | **63.7%** | **288 (67.8%)** | 105 (54.7%) |
| Real-only ViT-B/16 | 212 | 34.4% | 141 (33.2%) | 71 (37.0%) |

On the old 99-case paired benchmark the same models score 35, 42 and 28,
respectively, versus 59 for the deterministic matcher. The broader test changes
the scene/source mix; the 63.7% result does not mean the old failures disappeared.
The larger CNN's top-three recall is 483/617 (78.3%). This is a candidate-ranking
experiment, not a claim of reliable automatic labels.

## Real data and coverage

The [canonical catalogue](../../docs/TRAINING_DATA_CATALOGUE.md) was refreshed during
preparation (commit `2b9a4a4`). The run's `coverage.json` accounts for all 12
original clips and relevant derived families. Seven older normal recordings plus
the newest mixed normal/soul recording were inspected. The newest recording
contributes **normal fire only** here; soul-fire fitting is deferred.

| Role | Actual source recordings | Crops | Distinct frames | Phase coverage |
|---|---|---:|---:|---:|
| Fit | Survival 2026-10-16 18-23-42; partial ownership RGB from 2026-10-17 18-28-42; normal fire in 2026-10-19 16-49-48 | 3,006 | 915 | 32/32 |
| Calibration / checkpoint selection | 2026-10-17 17-04-31 | 157 | 53 | 27/32 |
| Held-out recording | Quad capture 2026-10-16 00-40-22 | 617 | 179 | 32/32 |

All phases in the held-out recording are measured. Whole recording identities
remain disjoint; repeated OBS render-frame IDs and identical crops are removed.
There are five source recording identities, with only one test recording. These
are familiar development recordings, not a new globally blind benchmark, and
multiple quads from one frame are correlated observations.

Fresh joins use stride 11 to avoid the old stride-60 phase aliasing, recorded
visibility >=95%, fully onscreen geometry, >=3 native output pixels per sprite
texel in the most compressed direction, and directional stretch <=2.5. At most
eight quads per sampled frame are chosen by minimum edge size. Eligibility is
frozen before examining image/model scores. The shared geometry checker is
`scripts/soul-quad-size-audit.mjs`; neither small, distant nor squashed quads are
silently added to increase the denominator.

Fresh video data provides 2,818 survival and 120 newest-recording fit candidates.
One exact duplicate in the latter is removed. Another 69 readable fit crops use
the existing locally audited partial-ownership pool, re-extracted from original
RGB sidecars with current shared preprocessing. This pool was historically
screened for ownership/alpha consistency; it is not a global oracle, and its
warning counts and provenance remain in the manifest. Final fit source counts
are 2,818 + 119 + 69. Neither pixels nor model inputs contain the ownership mask.

The early, clip 1 and clip 2 recordings have boxes and phase labels but lack real
per-plane corners; they are explicitly excluded from this **true outlined-quad**
pilot. Boxes are not passed off as quad corners. Four short pilots lack qualified
aligned quad truth. Two older ownership prototypes are pending a compatible local
ownership audit, outside the frozen audited pool; they are not claimed to contain
zero usable data. Old caches, rough variants and codec descendants are overlapping
data rather than additional independent recordings. Presence predictions, GUI
clock readings and app auto-labels are not substituted for renderer phase truth.

## Training and preprocessing

**No generated fire, rendered/composited training examples, or synthetic-fire
checkpoint is used.** All three start from generic ImageNet weights. Only ordinary
horizontal flips, mild brightness variation and pixel noise augment real crops.

Native full frames pass through the one shared automatic unveil implementation
(`fire-detection/core/src/veil.rs` via `veil_native.apply`), followed by bilinear
64x64 RGB quad rectification. Shared source hashes are stored. Nothing implements
a separate inverse, replaces the background, or uses an expected sprite to
select fresh video crops. New normal-video pixels are decoded from their original
recording; the partial-ownership training subset uses lossless captured RGB.

All networks receive only a crop and predict 32 phases. Frame/time, target phase,
sheet, source category, geometry metadata and material are not model inputs.
The ResNets preserve spatial detail with stride-1 input convolution, no first
max-pool and 2x2 pooling. The transformer uses 64x64 input, 16x16 patches and the
official interpolated ImageNet position bank. Sizes are 11.24M, 42.76M and 85.69M
parameters respectively.

Frozen comparison budget: seed 219, 12 epochs x 32 updates, batch 64 accumulated
as two microbatches of 32, AdamW initial LR .0002, cosine decay, weight decay .02,
label smoothing .03. Sampling weights reduce repeated-quads-per-frame dominance
and temper phase imbalance. Checkpoints minimize calibration cross entropy:
epochs 8 / 11 / 12. Only afterward is the held-out recording evaluated. This is
one finite pilot recipe, not an exhaustive architecture or hyperparameter search.

## Confidence and speed

Confidence thresholds use calibration only: lowest .01 step accepting >=5 crops
from >=2 frames with no wrong calibration phases. That empirical condition is
not a statistical safety guarantee and leaves unseen calibration phases.

| Model | Threshold | Correct accepted | Wrong accepted | Abstained / 617 |
|---|---:|---:|---:|---:|
| ResNet-18 | .71 | 102 | 4 | 511 |
| ResNet-101 | .83 | 165 | 2 | 450 |
| ViT-B/16 | .78 | 91 | 1 | 525 |

The ResNet-101 gate offers 26.7% correct coverage with 2/167 wrong accepted
guesses (1.2%). This is **phase-guess** error, not no-fire false-clear rate.
None of these outputs automatically confirms a label.

Warm batch-one latency includes native RGB-to-quad rectification, normalization,
transfer, inference, softmax and return to CPU. It excludes video decoding,
full-frame unveil, checkpoint loading and cold GPU initialization. CPU uses four
threads; GPU is this machine's RTX 4060 Laptop. These timings are specific to this
run and should not be compared as controlled speedups against historical timings.

| Model | CPU median / p 95 | CUDA median / p 95 |
|---|---:|---:|
| ResNet-18 | 35.3 / 38.1 ms | 6.1 / 10.1 ms |
| ResNet-101 | 164.9 / 176.1 ms | 17.9 / 25.6 ms |
| ViT-B/16 | 35.7 / 39.8 ms | 6.8 / 13.5 ms |

## Reproduction and checks

Local recordings and caches are required; no game textures, video pixels,
annotations, tensors or checkpoints are committed. Per-case predictions and truth
remain private in `.board/row32-real/results.csv`; aggregate metrics are saved in
`scripts/fire-ai/row32/real/results.json`.

```text
python FireCrackle/scripts/fire-ai/row32/real/inventory.py
node FireCrackle/scripts/fire-ai/row32/real/select.mjs
python FireCrackle/scripts/fire-ai/row32/real/prepare.py
python FireCrackle/scripts/fire-ai/row32/real/coverage.py
python FireCrackle/scripts/fire-ai/row32/real/train.py resnet18
python FireCrackle/scripts/fire-ai/row32/real/train.py resnet101
python FireCrackle/scripts/fire-ai/row32/real/train.py vit_b16
node FireCrackle/scripts/fire-ai/row32/real/baseline.mjs
python FireCrackle/scripts/fire-ai/row32/real/audit.py --timing
```

Three targeted split/phase tests and the two-architecture shape/finite-output
test pass. The prediction audit recounts metrics, checks exact test targets and
dataset hashes, and rejects any recording crossing fit/calibration/test roles.
No broad app test suite is needed for this offline research-only change.

## Approved resolution follow-up: 128x128

The owner approved a native 128px ResNet-101 comparison using the same 3,006 fit,
157 calibration and 617 test crops, generic ImageNet initialization, and no
synthetic fire. The existing 64px crop cache is **not enlarged**. Every full native
frame is first checked to reproduce its old 64px crop SHA-256 exactly, then sampled
directly at 128px. All 3,780 case identities, phases, outlines, source roles and
shared-unveil hashes remain identical.

The original 12-epoch/32-update/batch 64/microbatch 32 recipe is retained as a cap.
The owner additionally requested manual early stopping: calibration loss is
reviewed each epoch; after at least 4 epochs, three consecutive epochs without a
new calibration-loss minimum trigger a graceful stop and evaluation of the best
checkpoint. No held-out test result influences this decision.

A naive 128px microbatch exceeds the 8GB GPU's dedicated memory. Chunked activation
checkpointing avoids spilling into system memory while retaining microbatch 32.
Recomputation preserves BatchNorm running means, variances and observation counts;
a targeted full-backbone test verifies identical outputs, parameter gradients and
buffers. A 75% allocator limit leaves room for the desktop. This is a memory
implementation change, not a smaller training batch.

The run completed the 12-epoch cap in 837.5 seconds. Early stopping was manually
checked: epochs 8/9 worsened after 7, but 10 recovered to a new minimum;12 produced
another minimum. Three consecutive non-improving checks never occurred, so no
early stop was triggered. Checkpoint 12 was selected using calibration loss 1.5746,
before evaluating the held-out set once.

| Input | Correct /617 | Accuracy | Blocks /425 | Entities /192 | Top 3 /617 |
|---|---:|---:|---:|---:|---:|
| 64x64 | 393 | 63.7% | 288 (67.8%) | 105 (54.7%) | 483 (78.3%) |
| **128x128** | **425** | **68.9%** | **305 (71.8%)** | **120 (62.5%)** | **495 (80.2%)** |

That is 32 additional correct guesses, +5.2 percentage points. Paired cases:
352 correct with both models,73 correct only at 128px,41 correct only at 64px,
and 151 wrong with both. These disagreements justify testing an ensemble later;
they are not evidence that a particular ensemble will attain their combined
correct-case count. The deterministic matcher remains stronger on entities:
141/192 (73.4%), compared with 120/192 (62.5%) for the 128px model.

Using the same calibration-only zero-error selection rule for confidence gates:

| Input | Threshold | Correct accepted | Wrong accepted | Abstained /617 |
|---|---:|---:|---:|---:|
| 64x64 | .83 | 165 | 2 | 450 |
| 128x128 | .69 | 246 | 5 | 366 |

The 128px gate increases correct coverage to 39.9%, but 5/251 accepted guesses are
wrong (2.0%). Higher overall accuracy does not remove the need for review.

Controlled warm latency was remeasured for both checkpoints in the same audit,
with four CPU threads,10 warmups and 30 timed calls per device:

| Input | CPU median /p 95 | CUDA median /p 95 |
|---|---:|---:|
| 64x64 | 169.0 /184.7 ms | 18.1 /23.8 ms |
| 128x128 | 516.8 /555.7 ms | 21.7 /28.4 ms |

This includes native-frame quad sampling through probabilities returned to CPU;
decoding, full-frame unveil and cold loading remain excluded. Training peaked at
3,574 MiB allocated /5,850 MiB reserved GPU memory. Checkpoint recomputation adds
training work, and changing input shape also changes augmentation/random draws;
this single-seed comparison is not an exhaustive causal architecture study.

New scripts live in `scripts/fire-ai/row32/resolution/`; aggregate comparison
metrics and all-source coverage are saved there. Reproduction after catalogue
refresh and exact source availability:

```text
python FireCrackle/scripts/fire-ai/row32/resolution/test_resolution.py
python FireCrackle/scripts/fire-ai/row32/resolution/test_checkpointing.py
python FireCrackle/scripts/fire-ai/row32/resolution/prepare.py
python FireCrackle/scripts/fire-ai/row32/resolution/register.py
python FireCrackle/scripts/fire-ai/row32/real/train.py resnet101 --data .board/row32-128 --no-historical --checkpoint --memory-fraction 0.75 --stop-file .board/row32-128/STOP
python FireCrackle/scripts/fire-ai/row32/resolution/audit.py --timing
```

The stop-file is a manual graceful-stop request, checked at epoch boundaries;
leave it absent for the 12-epoch cap. Two crop tests and the full-backbone
output/gradient/BatchNorm parity test pass. The audit checks exact cohort/target
parity and recounts paired predictions. The subsequent approved inference-only
preprocessing and cached-ensemble follow-up is recorded below.

## Inference-only preprocessing and cached ensemble

The owner approved this fixed batch after the resolution comparison. All CNN
weights stayed frozen. Only the 157 calibration crops were used to select the
input transform, ensemble weight and confidence gate. There was no retraining,
new recording, synthetic fire, new inverse or change to the shared unveil.

| 128px input | Calibration correct /157 | Calibration cross entropy |
|---|---:|---:|
| **Unchanged** | **97** | **1.5746** |
| Gamma .8 (brighter) | 79 | 1.9676 |
| Gamma 1.25 (darker) | 72 | 2.1225 |
| Median 3x3 | 95 | 1.6213 |
| Mild unsharp | 92 | 1.7251 |

**None of these preprocessing options helped calibration.** The minimum-loss
selection therefore retained unchanged input. The four altered inputs were not
evaluated on the held-out set to find a more flattering result; cached unchanged
test predictions were reused. This does not test retraining with preprocessing
or every possible enhancement method.

Gamma used `round(255*(x/255)**exponent)` independently on RGB channels. Median
used Pillow's 3x3 filter; unsharp used radius 1, amount 100%, threshold 3. Measured
transform costs per calibration crop were .17/.19 ms for the two gamma options,
2.34 ms for median, and .64 ms for unsharp. Four calibration-only inference passes,
weight selection and cached test scoring took 17.4 seconds total; unchanged
probabilities were reused without another inference pass.

The subsequent ensemble averaged **probabilities**, not logits, using a fixed
128px-weight bank of 0,.25,.5,.75,1. Minimum calibration cross entropy selected
**75% 128px + 25% 64px**. This choice and its calibration-fitted confidence threshold
were frozen before scoring the held-out ensemble; no new CNN inference was
needed for the ensemble calculation.

| Method | Correct /617 | Accuracy | Blocks /425 | Entities /192 | Top 3 /617 |
|---|---:|---:|---:|---:|---:|
| Unchanged 128px | 425 | 68.9% | 305 (71.8%) | 120 (62.5%) | 495 (80.2%) |
| **75/25 ensemble** | **429** | **69.5%** | **306 (72.0%)** | **123 (64.1%)** | **509 (82.5%)** |

The top-one gain is four net cases (+.65 percentage points). A deployed ensemble
would need both models, so this small observed gain has an additional inference
cost; joint runtime was not benchmarked in this cached-output experiment.

| Method | Calibrated threshold | Correct accepted | Wrong accepted | Abstained /617 |
|---|---:|---:|---:|---:|
| Unchanged 128px | .69 | 246 | 5 | 366 |
| Ensemble | .57 | 288 | 9 | 320 |

The ensemble covers more cases but its accepted-phase error is 9/297 (3.0%),
versus 5/251 (2.0%) for 128px alone. These are phase-classification errors, not
no-fire false clears. The original calibration-zero-error gate is not a guarantee
of zero errors elsewhere. All results remain a development comparison on one
familiar test recording, with correlated quads per frame; no app behavior or
automatic-confirmation policy changed.

Code and aggregate metrics are in `scripts/fire-ai/row32/preprocessing/`.
Per-case probabilities, input variants and truth stay private under
`.board/row32-preprocessing`. The three targeted transform/ensemble tests and an
independent calibration-selection/prediction recount pass.

```text
python FireCrackle/scripts/fire-ai/row32/preprocessing/test_preprocessing.py
python FireCrackle/scripts/fire-ai/row32/preprocessing/run.py
python FireCrackle/scripts/fire-ai/row32/preprocessing/audit.py
```

## Frozen 128px CNN + deterministic matcher

The owner approved agreement acceptance and confidence selection on the same
157 calibration crops from V10/later, then one evaluation on the same617 test
crops from V06/quad1. This is normal-fire phase classification with frozen
weights and the existing shared-gain deterministic matcher, not the64px CNN
ensemble above. No synthetic fire, additional training or preprocessing change.
All other source roles/exclusions inherit the128px coverage manifest; training
sources supply checkpoint provenance only in this inference experiment.

Native calibration frames were redecoded and unveiled through the canonical
Rust binding. All157 original64px crop hashes match. The deterministic control
reproduces all617 historical test top phases and scores exactly, with unchanged
matcher source hashes. Test observations were already familiar development
data; this is not fresh blind validation.

Calibration selects a global hard selector: retain the CNN guess except when
the methods disagree, CNN maximum probability is below .50, and the matcher's
relative distinct-phase score margin is at least .03. The margin is
`(best_score - best_other_phase_score) / abs(best_score)`; it is a heuristic,
not a calibrated probability. Selection searches CNN thresholds0,.25,.5,.75,1.01
and matcher margins0,.01,.03,.1, maximizing calibration exact-phase accuracy.
Ties prefer fewer overrides, lower CNN threshold, then higher matcher margin.
No per-source or per-phase rules were selected using test outcomes. This is
decision routing, not an average of incompatible CNN probabilities and template
similarity scores. The selection is saved before test predictions are loaded.

Calibration correct counts: CNN97/157, matcher98/157, selected ensemble115/157.

| Method | Correct /617 | Accuracy | Block /425 | Entity /192 |
|---|---:|---:|---:|---:|
| Deterministic matcher | 363 | 58.8% | 222 | 141 |
| 128px CNN | 425 | 68.9% | 305 | 120 |
| **Selected hybrid** | **443** | **71.8%** | **299** | **144** |

The selector overrides173 CNN predictions:57 repairs and39 spoiled correct
predictions, for18 net additional correct cases (+2.92 percentage points).
The block result drops6 while entity improves24. The gain therefore does not
establish universal improvement, and source-based routing would need a separate
agreed calibration experiment rather than choosing from these test outcomes.

Correctness cross-tab on all617 test crops:

| | Matcher correct | Matcher wrong |
|---|---:|---:|
| CNN correct | 295 | 130 |
| CNN wrong | 68 | 124 |

Of the124 cases where both are wrong,6 share the same wrong phase and118
disagree. They agree on301/617 crops (48.8% coverage):295 correct,6 wrong,
**98.0% accepted accuracy**. Among316 disagreements, CNN alone is correct130
times, matcher alone68, neither118. The union493/617 (79.9%) is an oracle upper
bound, not an achieved ensemble. Aggregate32-phase confusion matrices are saved
in `scripts/fire-ai/row32/hybrid/results.json`: rows are true animation phase,
columns predicted phase0..31 plus an abstain column. No control abstains here.

A separate agreement gate picks the lowest CNN probability threshold with zero
calibration errors, at least5 accepted crops and at least2 frames. It selects.24
(74/74 correct calibration). On test it accepts287:282 correct,5 wrong,
330 abstained,98.3% accepted accuracy at46.5% coverage. That small improvement
over plain agreement rejects14 crops, including13 correct ones; there is little
benefit in this extra threshold. Neither agreement rule guarantees correctness
or changes automatic-confirmation policy in the app.

Preparation took4.93seconds; rescoring774 calibration/test crops with the frozen
matcher took22.02seconds, including cached-frame loading and RGBA assembly.
Cached CNN decision analysis took under1second; no new CNN inference was needed.
These are batch research timings, not a jointly measured app latency benchmark.
The benchmark remains one familiar test recording with correlated quads and a
small calibration recording. No app integration was made.

Two targeted selector tests plus an independent cached-prediction, confusion
matrix and calibration-choice recount pass. Per-case predictions, native frames
and labels remain ignored/private in `.board/row32-hybrid`.

```text
python FireCrackle/scripts/fire-ai/row32/hybrid/prepare.py
node FireCrackle/scripts/fire-ai/row32/hybrid/matcher.mjs
python FireCrackle/scripts/fire-ai/row32/hybrid/run.py
python FireCrackle/scripts/fire-ai/row32/hybrid/audit.py
```

## One fused top-three list: 128px CNN + deterministic scores

After the owner clarified that the app is a shortlist helper, they approved
recovering the full deterministic phase scores and combining them with the128px
CNN. This run returns exactly three distinct animation phases from one fused
ranking, rather than concatenating two top-three lists into up to six candidates.
The source recordings,157 calibration crops and617 test crops are unchanged.
All other catalogue sources retain the frozen128px coverage roles/exclusions;
training data provides checkpoint provenance only. No retraining, synthetic
fire, new CNN inference or change to shared preprocessing was needed.

Each deterministic phase receives its maximum similarity across appearances.
Softmax with a temperature converts these32 scores to a normalized distribution;
an unusable deterministic observation supplies a uniform distribution. The
fused probability is `w * CNN_probability + (1-w) * matcher_probability`.
The calibration-only bank uses temperatures .01,.03,.1,.3 and CNN weights
0,.25,.5,.75,1. Maximum calibration top-three coverage selects the combination;
ties use lower cross entropy, higher CNN weight, then lower temperature.
The selected settings are saved before test arrays are loaded. Ranking ties
use ascending animation phase.

Calibration selects **25% CNN +75% deterministic**, with deterministic
temperature **.01**:127/157 correct in the top three (80.9%),106/157 top one.
These percentages apply after score normalization; raw template similarities
are not interpreted as probabilities. Calibration has only53 source frames and
the search can overfit it.

| Method | Top-three correct /617 | Top-three accuracy | Block /425 | Entity /192 |
|---|---:|---:|---:|---:|
| Frozen deterministic control, distinct phases | 420 | 68.1% | 270 | 150 |
| 128px CNN | 495 | 80.2% | 354 | 141 |
| **One fused three-phase ranking** | **514** | **83.3%** | **353** | **161** |

Relative to the CNN,473 test crops retain correct-phase coverage,41 gain it,
22 lose it and81 remain misses. The net gain is19 cases (+3.08 percentage points).
Block coverage drops one case; entity improves20. The earlier two-CNN64/128
ensemble reached509/617 (82.5%); the five-case difference is a development
comparison, not evidence of a statistically reliable advantage on new videos.

Top-one accuracy is419/617 (67.9%), below128px alone425/617 (68.9%): the selected
fusion optimizes the requested three-candidate helper rather than automatic
top-one decisions. The prior hybrid confidence-routing result443/617 optimized
top one and is a different method. The88.2% union result needed up to six slots
and must not be presented as a three-slot result.

Rescoring774 crops took19.36seconds, with all617 historical deterministic top
phases and top scores reproduced exactly. Cached CNN calibration/analysis took
under one second. Joint app latency was not benchmarked. This is still one
familiar test recording with correlated quads; the frozen deterministic control
does not include the app's geometry refinement. No production app changes were
made by this research experiment.

Two targeted probability/ranking tests and an independent calibration-selection
and prediction recount pass. Aggregate metrics are in
`scripts/fire-ai/row32/fusion/results.json`; full phase scores and per-case
predictions remain private in `.board/row32-fusion`.

```text
node FireCrackle/scripts/fire-ai/row32/fusion/scores.mjs
python FireCrackle/scripts/fire-ai/row32/fusion/run.py
python FireCrackle/scripts/fire-ai/row32/fusion/audit.py
```

## Native ONNX integration and eager model preparation

The owner approved integrating the128px CNN + deterministic top-three ensemble
through the existing no-fire Rust/ONNX Runtime path, with eager loading. The
normal-fire checkpoint is exported with RGB float32 NHWC input `[1,128,128,3]`
and32 animation-phase logits; normalization is inside the graph. The app does
not use Python or PyTorch. No new fitting or synthetic fire was introduced.

Exported weights SHA-256:
`432c12518e0dc80818c965b7e785b14ed4138a98c47b9990e037fcaea6b7faf8`.
The model is170,892,279bytes (163.0MiB). It stays outside Git. Versioned metadata
is `release/quad-phase-model.json`; both staging and native loading verify its
hash. The same metadata supplies the frontend fusion constants.

On all157 calibration and617 test crops, ONNX CPU differs slightly from the
older cached CUDA output (maximum logit difference .00831; probability .00136).
Of774 crops,773 retain top one and772 retain the same full top-three set. Direct
CPU PyTorch checks on the six largest CUDA-difference cases instead match ONNX
within .0000043 logits, identifying the earlier GPU arithmetic as the relevant
reference difference. Do not claim bitwise cached-GPU equivalence.

Rechecking the original calibration bank on ONNX outputs selects the same .01
temperature and25% CNN weight (127/157 top three). The deployed-score fusion
still reaches **514/617 test top-three correct** and419/617 top one. Only one full
test top-three set changes from the cached-CUDA fusion; correctness totals do
not change. These are the same familiar recordings, not new validation.

The production matcher uses shared Rust/WASM automatic unveil and native128px
rectification for the model. Eligibility matches the geometry gate: fully
onscreen, at least3 native pixels per texel and anisotropy at most2.5. Smaller,
clipped or squashed quads retain the deterministic helper. Soul/other textures
are not routed through this normal-fire model. Browser-only mode also retains
the deterministic helper.

Phase fusion uses original-outline deterministic evidence. Optional per-sprite
corner fitting still provides each proposed phase's best appearance/geometry;
atlas filters remain enforced. The helper displays three distinct animation
phases, retaining preview shortcuts and explicit confirmation. Native inference
errors are reported and the colour matcher remains available. Stale responses
after frame/quad changes are discarded.

The no-fire ORT engine now exposes phase inference through the same dynamic
library loader and platform backends. Existing no-fire backend selection and
CPU fallback are preserved. Phase GPU selection validates numerical agreement
and speed, then stops after finding a faster valid adapter. Runtime GPU failures
retry on CPU. No second platform-specific inference stack was added.

Preparation starts on a background blocking task during native app setup. A CPU
session is published first; CPU warmup and first-crop smoke measured2.75seconds
total in the debug build, including model read/hash/session creation. GPU
compilation/probing happens outside the match mutex, and a simultaneous second
match completed in329ms on CPU. The session remains resident and switches to GPU
once ready; F5 does not require recreating it.

Native release-mode ORT measurement on this RTX4060 Laptop selected DirectML0:
mean14.44ms per128px inference over20 warm requests, maximum CPU/GPU logit
difference .0000029. Initial exhaustive two-adapter preparation took75seconds,
which motivated the CPU-first/off-lock design and first-fast-adapter selection.
That historical preparation time is not a blocking first-click requirement.
Python ORT CPU measured session creation .334seconds and mean312.9ms per crop
(four threads,774 sequential crops). These are component measurements, not
complete click-to-preview app latency.

Real frontend rectification was audited on nine native crops:4,206 of442,368
channels differ by one code value from NumPy's homography/truncation arithmetic;
all nine preserve ONNX top-one and top-three predictions. The frontend fusion
also reproduces every one of772 usable real calibration/test score-vector
rankings. Two no-evidence calibration cases are outside that ranking audit.

Targeted checks pass:20 frontend tests including real-pixel/ranking audits,
shared no-fire preprocessing/runtime tests (with the actual native DLL/model),
two native phase tests including actual-model/CPU-during-GPU-preparation smoke,
two staging/tamper tests, frontend production build and native debug build.
Linux code reuses the existing provider path; a Linux binary was not built on
this Windows host.

The models are not packaged (0.4.2-0.6.0 shipped them, 300 MB of every
download): like FFmpeg and yt-dlp, the app downloads each one on first use from
the `quad-phase-model-v1` release, verifies its pinned SHA-256 and caches it
(`external_tools::install_model`, used by `src-tauri/src/quad_phase.rs`); Match
uses the colour matcher until then. `prepare-quad-phase.py` stages them in
`src-tauri/runtime/models/` for the build's model tests only, and the release
checks (`release.test.ps1`, `verify-linux.sh`, `publish_release.py`) reject any
package that contains them. A local export can be supplied through
`FIRECRACKLE_PHASE_MODEL_SOURCE`.

Reproduction (from the repo root except the frontend test):

```text
python FireCrackle/scripts/fire-ai/row32/onnx/export.py
python FireCrackle/scripts/fire-ai/row32/onnx/fixtures.py
# From FireCrackle, with FIRECRACKLE_PHASE_PARITY=1:
npm test -- --run src/lib/quadPhase.test.ts src/lib/quadMatch.test.ts
npx vitest run --config scripts/fire-ai/row32/onnx/vitest.config.ts
python FireCrackle/scripts/fire-ai/row32/onnx/fixtures.py --verify
python FireCrackle/scripts/prepare-quad-phase.py
```
