# Stronger CNN trials: ResNet-18 and ResNet-50

**Neither trial is an upgrade for the current low-false-clear goal. Keep the
existing rules + MobileNetV3 ensemble as the reference.** Research only, excluded
from 0.2.1, with no app integration or saved-label changes.

## Same-frame, same-safety-policy result

All methods use the same919 familiar survival frame IDs:542 eligible no-fire /
below-width24 targets and377 above-cutoff fire targets. TP means a correct
eligible no-fire clear. FP means above-cutoff fire wrongly cleared. The fixed
GUI, automatic-unveil, weak-menu, material and purple guard policy from
`COMPARISON_RULES.md` applies identically. No threshold was tuned on survival.

| Candidate | TP / 542 | FP / 377 | Extra TP beyond existing43-clear ensemble | Extra FP |
| --- | ---: | ---: | ---: | ---: |
| MobileNetV3 | 30 | 0 | already included | — |
| ResNet-18 | 35 | 1 | 14 | 1 |
| ResNet-50 | 19 | 1 | 11 | 1 |
| Existing rules + MobileNetV3 | 43 | 0 | reference | — |

Adding ResNet-18 by OR would produce57TP/1FP; adding ResNet-50 would produce
54TP/1FP. Adding both produces68TP/2FP. These are descriptive post-hoc combinations,
not adopted policies. Additional clears do not justify silently accepting the
new errors when false clears are the priority.

Both false clears survive the common safety gates. ResNet-18's error is
survival #41940, a recorded26.55px-wide flame under chat/partial darkening,
near the existing24px proxy cutoff. ResNet-50's error is #49500, an open inventory
with recorded flames clipped along the top of the viewport. These are difficult
visibility/geometry cases, but the existing benchmark counts them as fire: no
relabeling, exclusion, threshold change or post-hoc size adjustment was made.
Recorded source boxes are not perfect visible-pixel masks or readability truth.

The two false-clear contact images and all25 new TP thumbnails were inspected.
New candidates include warm Nether, menus, particles and a few brighter Overworld
views. As in earlier work, tiny recorded fire below the fixed cutoff counts as
eligible rather than as an above-cutoff error; exact counts are in local audit.json.

## Original model policy and ranking

Before adding the common GUI/material/weak-menu vetoes, retaining each model's
original purple guard:

| Model | TP | FP | Survival ROC area |
| --- | ---: | ---: | ---: |
| MobileNetV3 | 44 | 0 | .7409 |
| ResNet-18 | 44 | 1 | .8280 |
| ResNet-50 | 22 | 1 | .8259 |

The ResNets rank frames better overall on this sample, but that does not establish
better performance at our strict conservative operating point. Logit-zero
thresholds would wrongly clear61 and82 above-cutoff fires respectively and are
unsuitable. Zero calibration errors follow from the strict minimum-positive
threshold and do not guarantee zero unseen-video errors.

## Training recipe

- Official torchvision ImageNet pretrained ResNet18 (`resnet18-f37072fd.pth`) and
  ResNet50 (`resnet50-11ad3fa6.pth`); downloads verified against hash prefixes.
- Same350 fitting bags,83 development frames and188 previously reviewed positive
  fitting crops. Same218 clip2 calibration and919 survival evaluation frame IDs.
  No extra labels, new negative mining or calibration/test fitting.
- Same global224px view plus eight native640px tiles resized to224px. Same raw /
  canonical automatic-unveil branches, top-strip removal and frame max pooling.
- Balanced frame BCE plus .2 positive-crop loss, four bags and four crops per
  update; horizontal flips, fixed pretrained batch statistics, dropout .2.
- Eight epochs, first two head-only; then fine-tune layer3+4. AdamW backbone1e-4,
  head1e-3, decay.001. ResNet18 uses a512–128–1 head; ResNet50 uses2048–128–1.
- Development BCE selected epoch7 (0.31957) for ResNet18 and epoch4 (0.28115) for
  ResNet50. Each checkpoint was saved/hashed before calibration, and the strict
  clip2 threshold was frozen before survival scoring.

This compares actual stronger-backbone training recipes, not a clean causal
architecture-only ablation against V3: V3 started from the already task-trained
MobileNetV1 checkpoint, whereas the ResNets started from ImageNet. One seed and
limited fitting recordings are insufficient to conclude that ResNets cannot
improve this task. No seed search or test-driven hyperparameter retry was run.

## Measured inference speed

RTX4060 Laptop GPU, FP32,32 fixed sampled frames, three passes after warm-up:

| Model | Median ms / frame | p95 ms / frame |
| --- | ---: | ---: |
| MobileNetV3 | 12.04 | 16.32 |
| ResNet-18 | 9.24 | 15.87 |
| ResNet-50 | 19.41 | 40.20 |

Includes9/18 cached224px views, normalization and host-to-device transfer.
Excludes video decoding, GUI fitting, automatic unveil and material checks.
This is model-stage timing, not end-to-end app scan speed. GPU kernels, batch
shapes, clock/thermal state and background work affect timing; ResNet18 being
faster here is a measured local result, not a general architecture claim.

## Verification and artifacts

`resnet_bench.py` trains both models; `assess_resnets.py` applies unchanged gates,
computes additions and benchmarks; `predict_resnet.py` checks independent images.
The targeted test verifies both models return one score/image and the intended
freeze/unfreeze boundaries. An independent audit confirms all fitting/evaluation
role frame IDs/truth, checkpoint hashes and strict thresholds.

45 additional candidate frames received fresh native-resolution safety checks,
bringing the shared evidence cache to136 verified frames. Their raw/automatic CNN
views and original orange scores match the earlier caches. Independently decoded
clip2 frame0 reproduces the saved score exactly for both ResNets:
- ResNet18: `-1.0623365640640259`
- ResNet50: `-0.11802557855844498`

Local artifacts: primary checkout `.board/image-presence/continuation/resnets/`,
including the frozen protocol, executed-source snapshot, per-model histories /
checkpoints / calibration / predictions, assessment, audit, all candidate sheets
and both false-clear sheets. The frozen protocol text had a head-width typo
(`576` instead of actual `512` for ResNet18); local metadata-errata.json records
that correction. Model construction/training/scores were unaffected, historical
hashes are preserved, and the future script text is corrected.

Weights SHA256:
- ResNet18: `d6a9c72074393ea1196a68b6292ff55d7e525f22dd54800d86c0eb1319d4bb4e`
- ResNet50: `33a918c1a1225db54bcb0cc37c54254e5e13a7efba777c1720a38f332198713e`

All data/weights remain ignored local artifacts. No source was merged to main.
Next useful evidence is new independently labelled footage and explicit review
of partial/edge-clipped fire, rather than treating a larger network as an automatic
improvement. The current safety masks remain heuristic, not a GUI/translucency oracle.
