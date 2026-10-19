# Real-only normal-fire phase models

19 October 2026. **The 128px ResNet-101 is the best AI in this pilot:425/617
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

The [canonical catalogue](../docs/TRAINING_DATA_CATALOGUE.md) was refreshed during
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

The early, clip1 and clip2 recordings have boxes and phase labels but lack real
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

| Model | CPU median / p95 | CUDA median / p95 |
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
parity and recounts paired predictions. Preprocessing variants and ensembles are
requested follow-ups, in that order; neither has been run in this experiment.
