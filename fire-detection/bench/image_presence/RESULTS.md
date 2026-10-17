# First tiled image-CNN run — 2026-10-17

Research only; explicitly excluded from version 0.2.1. No application integration,
saved-label changes, bundled model or release changes.

The ImageNet-pretrained MobileNetV3-Small completed ten epochs on the RTX4060.
Development loss selected epoch4, before calibration or evaluation. Training took
47seconds; video preparation took about8minutes. This is a real image-feature
model with limited backbone fine-tuning, rather than a network on colour counts.

1,579 frames from four labelled recordings were sampled every90frames. The split
contained350 fit frames (160 meaningful fire),83 development (63 fire),218
calibration (125 fire),919 evaluation (377 fire), and9 boundary-guard exclusions.
See README.md for recording identities, preprocessing, training and target rules.

| Set | Frames | Clear-eligible | Meaningful fire | Correct clear candidates | Meaningful fire wrongly cleared |
| --- | ---: | ---: | ---: | ---: | ---: |
| Development | 83 | 20 | 63 | 3 (15.0%) | 0 |
| Calibration, clip2 | 218 | 93 | 125 | 8 (8.6%) | 0 |
| Evaluation, survival1 | 919 | 542 | 377 | 33 (6.1%) | 0 |

“Clear-eligible” combines no-fire frames and the owner's negligible-fire policy
(source box narrower than24px at1080p). Of the33 evaluation clears,32 have no
recorded fire and1 has only negligible fire. These are candidate outputs for
manual review, not automatic confirmations.

The threshold was frozen at fire logit **−1.5221151113510132**, the lowest
meaningful-fire calibration score; clearing uses strict less-than. The existing
purple/supplied-translucency guard vetoed216 evaluation frames. Without that
guard the same frozen model/threshold gives48/542 correct clears (8.9%) and0/377
meaningful-fire misses. No guard hit does not prove opacity; water/glass/ice are
not automatically recognized by this guard.

At the default logit-zero threshold, the unguarded model would clear356/542
eligible frames but also120/377 meaningful-fire frames. That threshold is unsafe
for this task. Evaluation ROC area is0.749 (development0.913), showing substantial
generalization loss across recordings. The conservative threshold has modest
coverage; this run does not demonstrate a useful automatic no-fire system.

The candidate contact sheet includes many adjacent chat-open frames, so33 clears
are not33 independent situations. Capture boxes are approximate visibility truth.
The recordings were familiar to earlier project research, although survival1 was
excluded from fitting, checkpoint selection and threshold calibration in this
run. Zero observed misses in377 correlated positive samples is not a guarantee.

The next experiment should add varied training recordings and inspect the
lowest-scoring training/development fire cases, particularly small/occluded fire
and menus. Freeze that experiment before assessing a fresh recording; do not
retune this threshold against survival1 and present it as independent validation.

Local artifacts in the primary workspace:

- `.board/image-presence/run1/best.pt`
- `.board/image-presence/run1/protocol.json`, `freeze.json`, `calibration.json`
- `.board/image-presence/run1/report.json`, `test-predictions.json`
- `.board/image-presence/run1/training-preview.png`, `test-correct-clears.png`

Selected checkpoint SHA256:
`14697bdc90bbbfcaed94e552314ed007234e052c5ae8716de155a6eed567cdbc`.
PyTorch2.10.0+cu128, torchvision0.25.0+cu128. The five targeted contract tests
pass. An independently decoded full-resolution evaluation frame run through
`predict.py` reproduced its cached logit exactly: −1.1341776847839355.
