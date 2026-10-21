# V3: keep frame context and add verified fire crops

Research only. Excluded from 0.2.1. No app integration or saved-label changes.

## Result

Same 919 familiar survival frames and original width24 target, with the same
canonical automatic unveil and original purple/translucency guard.
Here **TP means a correct no-fire clear**, and **FP means fire wrongly cleared**.

| Model | TP / 542 eligible frames | Coverage | FP / 377 meaningful-fire frames |
| --- | ---: | ---: | ---: |
| V1 reference | 33 | 6.09% | 0 |
| V2 reviewed-crop model | 10 | 1.85% | 0 |
| V3 control: extra V1 bag fitting | 33 | 6.09% | 0 |
| V3: V1 bag fitting + positive crop loss | 44 | 8.12% | 0 |

V3 retains all 33 V1 clears and adds 11. This is a modest 2.03 percentage-point
gain. Five of its 44 clears contain recorded negligible fire below the existing
width24 target, so this is not a literal zero-fire benchmark. Contact sheets
of all 44 candidates were reviewed: scenes are mainly dark Nether gameplay,
chat and open screens; several added frames contain tiny recorded flame boxes.
Tiny-fire eligibility remains an approximate geometry proxy, not a demonstrated
sprite-readability cutoff.

Calibration improved from 8/93 to 14/93 correct clears, with no calibration-fire
clear by construction. Threshold remains strictly below the lowest of 125
meaningful-fire calibration scores. The threshold-limiting menu frame remains
clip2 #15840; it was neither removed nor used for fitting.

Development selection chose epoch1: BCE 0.31008 versus V1's 0.32443. The control
selected epoch0, reproducing V1 scores/metrics. The V3 survival ROC area fell from
0.7490 to 0.7409, so the conservative operating-point gain is not a broad ranking
improvement. At logit zero V3 wrongly clears 125 meaningful-fire frames: that
threshold is unsuitable. No score is a calibrated probability.

## Controlled continuation

The failed V2 experiment changed crop supervision, tile scale and data density
together. V3 keeps V1's 224px global view, eight 640px native tiles, raw/automatic
unveil maximum, width24 targets, split and abstention policy.

Two arms start from the same frozen V1 weights and replay the same 350 fitting
frame bags. Both use four epochs, four bags/update, AdamW 1e-5 backbone/1e-4 head,
weight decay .001, final three backbone blocks trainable and fixed batch stats.
The treatment adds weight .2 positive logistic loss on four of V2's 188 reviewed
positive crops/update. It uses no V2 negative crops or extra frame negatives.
Separate random streams keep bag ordering, branch choices and bag dropout paired.
Crop roles are checked against original joined labels: fitting only, meaningful
fire only, no clip2 or survival frames, no development frames.

Both checkpoint selections use the same 83 development frames, with epoch0
eligible. Each selected checkpoint is saved and hashed before independently
calibrating on clip2, and its threshold is saved before survival scoring.
The protocol was written before either arm ran. Nothing was selected by survival
coverage; no threshold was raised after seeing that evaluation.

## Limits and next step

Survival is familiar project data and has informed earlier experiments. These
are correlated sampled frames, not a fresh independent validation. Zero observed
FP does not establish a zero future error rate. Only four joined recordings are
currently available; no newly recorded material video has joined labels here.

V3 is a promising research candidate, while V1 stays the reproducible reference.
Before replacing anything, use a newly labelled recording, ideally from another
creator/compression pipeline. Diverse difficult positive scenes and transparent
materials matter more than denser adjacent samples from the same recordings.
The original guard does not infer arbitrary water/glass/ice and absence of a hit
does not establish opacity. This trial does not silently adopt the separate
desktop material detector or GUI masker, which would change the comparison.

## Reproduction and local artifacts

Run `refine_v3.py OUT --data-root DATA_ROOT --baseline-run RUN1 --crop-run RUN2`.
Use a fresh OUT; existing runs are refused. `test_refine_v3.py` checks crop review
and fitting-only supervision. `predict_v3.py RUN IMAGE --data-root DATA_ROOT`
runs independently decoded images with shared preprocessing and weight/hash
checks. All outputs remain review candidates.

Independent FFmpeg decoding of clip2 frame0 reproduces the saved V3 evaluation
logit exactly: `0.08787961304187775`. The three new supervision-boundary tests
pass; control prediction scores and all evaluation frame IDs/truth/guards were
checked against the original V1 artifacts.

Artifacts: primary checkout `.board/image-presence/continuation/run3/`, with
`protocol.json`, `comparison.json`, and `control/` / `positive_aux/` containing
histories, frozen checkpoints, calibration, prediction rows, per-recording
reports and all candidate contact sheets. Data and weights remain local/ignored.

Treatment weights SHA256:
`4542be2d4ac9f9f9df5dbb9b0a7d1a05a94241b6292cb7e7259ea8bed0d1548a`.
