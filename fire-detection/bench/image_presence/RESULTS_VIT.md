# Vision transformer trial: ViT-B/16

**Keep the existing rules + MobileNetV3 ensemble. This ViT trial adds no clears.**
Research only; no app/release integration, label changes or pushed branch.

## Matched result

Same 919 familiar survival frames: 542 eligible no-fire/below-cutoff examples and
377 meaningful-fire examples. **TP = correct no-fire clear; FP = meaningful fire
wrongly cleared.** Identical GUI, weak-menu, material and purple safety gates from
`COMPARISON_RULES.md` apply to every method.

| Method | TP / 542 | FP / 377 | New TP beyond existing ensemble |
| --- | ---: | ---: | ---: |
| Existing rules + MobileNetV3 | 43 | 0 | reference |
| ViT-B/16 alone | 1 | 0 | 0 |
| Existing ensemble OR ViT | 43 | 0 | 0 |

The one clear is survival frame 42120, already covered by the existing ensemble.
There are no below-cutoff fire clears among the ViT's matched decisions. Without
the original purple guard, the model would also clear meaningful-fire frame
50670, which shows portal effects. The guard correctly retains it. These guards
are heuristics, not a GUI/translucency oracle or proof of fire absence.

Calibration yields 5 TP / 0 FP on 218 clip2 frames (93 eligible, 125 fire).
Survival ROC area is .77146. Ranking across thresholds is not the same as useful
performance at the strict no-fire-clear operating point. No threshold was relaxed
after viewing survival. The lowest-scoring calibration fire is clip2 frame 2880,
which itself has a purple-guard abstention; the unchanged calibration recipe uses
all meaningful calibration fires, including abstentions. This conservative policy
is preserved for comparability rather than changed after seeing results.

## Frozen recipe

- Official torchvision [ViT-B/16 ImageNet1K V1 weights](https://docs.pytorch.org/vision/main/models/generated/torchvision.models.vit_b_16.html),
  downloaded from `https://download.pytorch.org/models/vit_b_16-c867db91.pth` with
  hash-prefix verification. Removed ImageNet classifier; added 768–128–1 head,
  ReLU and dropout .2.
- Same 350 fitting bags, 83 development frames, 188 previously reviewed positive
  fitting crops, 218 calibration frames and 919 diagnostic frames as the CNN trials.
  No new fitting labels or negative mining.
- Same global view plus eight native 640px tiles, resized to 224px. Original
  ImageNet normalization, top-strip removal, shared canonical automatic unveil,
  random raw/auto branch and horizontal flip for fitting; max over all raw/auto
  views at inference. GUI pixels remain in model inputs; shared gates apply to
  decisions separately.
- Eight epochs, seed 321, four frame bags and four positive crops per update.
  Balanced bag BCE plus .2 positive-crop loss. AdamW backbone 1e-4, head 1e-3,
  weight decay .001, FP32. First two epochs head-only; then final two transformer
  blocks and final LayerNorm trainable. Backbone stays in eval mode; head dropout
  remains active during fitting. This reuses the ResNet training/evaluation loop.
- Minimum development BCE selects **epoch 1**, loss **.3147047173**. Fine-tuned
  epochs overfit: final training loss .0090 while development loss reaches .9406.
  Save and hash checkpoint before calibration; freeze strict minimum-positive
  clip2 threshold **-1.0490262508392334** before survival evaluation. Ties retain.

This is one pretrained ViT training recipe, not evidence that all transformers
fail. The selected checkpoint has a trained head over frozen ImageNet features.
More/better fitting footage and explicit difficult-case labels may help more than
another backbone swap. Survival is a familiar, correlated diagnostic, not a new
independent-video test; zero observed FP does not establish zero future FP.
The existing 24-native-pixel source-box width cutoff is an approximate benchmark
convention, not a visible-pixel/readability oracle. No labels or cutoff were
changed after evaluation.

## GPU model-stage speed

RTX4060 Laptop, FP32, same 32 sampled diagnostic frames, three passes after warm-up:

| Model | Median ms/frame | p95 ms/frame |
| --- | ---: | ---: |
| MobileNetV3 | 11.44 | 15.95 |
| ViT-B/16 | 59.89 | 117.94 |

Includes 9/18 cached image views, normalization and host-to-device transfer.
Excludes decoding, GUI fitting, automatic unveil and material checks. This is
local model-stage timing, not end-to-end app throughput.

## Verification and artifacts

Targeted ViT and existing ResNet model-contract tests passed, including image
logit shape and freeze/fine-tuning boundaries. Independent audit verifies all
role frame IDs/truth, development-only epoch selection, checkpoint/calibration
hashes, strict calibration and matched decisions. One additional candidate frame
received fresh native-resolution safety checks, bringing shared evidence to 137
frames; its cached views and original native orange score match exactly.

Reviewed the three lowest-scoring calibration fires, the one correct diagnostic
clear and the guarded portal false-clear candidate. Independent image inference
on freshly decoded clip2 frame 0 exactly reproduces cached logit
**-0.2699275314807892**. Executed training-source snapshots match frozen hashes.

Checkpoint SHA256:
`8e1220b7b421f05494e35cf14dde928a7455f9d2bfddae5ea0e5ce434861aef0`.

Local ignored artifacts: primary checkout `.board/image-presence/continuation/vit1/`:
protocol and source snapshots, `vit_b_16/` checkpoint/history/frozen threshold/
predictions/contact sheets, assessment, shared evidence and independent audit.
Tracked scripts: `vit_bench.py`, `test_vit_bench.py`, `audit_vit.py`; existing
`resnet_bench.py`, `assess_resnets.py`, `predict_resnet.py` accept the ViT without
changing their default ResNet behavior. No assets, recordings, caches or weights
are committed.
