# Larger direct-phase models

**Historical synthetic-assisted experiment; superseded by the owner's real-only
request.** ResNet-101 completed before the redirect: normal42/99 (43%); soul46/115
(40%). The normal deterministic phase control was59/99, soul45/115. ViT-B/16
weights were loaded and its forward pass checked, but it was **not trained** in
this experiment. The protocol below records the proposed comparison; it is not
evidence that both architectures completed. Current real-only work is separate
in `FIRE-PHASE-REAL-RESULTS.md` and starts from generic ImageNet weights, not these
synthetic-fire checkpoints.

19 October2026. Research comparison of **separate normal-fire and soul-fire
models**, each predicting animation phase0–31. No app matcher or automatic
labelling change. Results are phase accuracy, not exact sheet/mirror matching.

## Protocol frozen before training

Compare the preceding ResNet-18 recipe with:

- **ResNet-101:**42,762,336 parameters, about3.8x the preceding11,242,080.
  ImageNet-pretrained, stride1 input convolution, no initial max-pool,2x2 final
  spatial pooling and32 phase logits. The spatial changes match the small CNN.
- **ViT-B/16:**85,685,024 parameters, about7.6x the small CNN. ImageNet-pretrained
  vision transformer with a32-logit head. Its position embeddings are interpolated
  with Torchvision's utility for64x64 input:16 image patches plus a class token.
  Input pixels are not enlarged to224x224.

Both receive the same64x64 RGB rectification and ImageNet normalization as the
preceding trial. Colour-specific checkpoints are independently trained. They do
not receive timestamps, frame numbers, expected alpha, candidate phase, source
type, sheet or mirror as inputs. Caller selection determines which colour model
is used. The transformer is an initial architecture trial, not an exhaustive
transformer or training-hyperparameter search.

## Data and training

The frozen corpus, preprocessing and target conventions are described in
[the small-model report](FIRE-PHASE-CNN-RESULTS.md). Same geometry rule: fully
on-screen, >=3 native output pixels per texture texel in the most compressed
direction, local directional stretch <=2.5. All retained test cases stay in the
denominators, including overlapping fire faces.

- **Normal:**175 fitting crops from155 frames of the additional recording,
  including153 entity and22 block crops;15 calibration crops from14 later frames.
  The99 test crops from18 frames come from the separate original quad recording.
  This exactly reuses the final ResNet-18 normal experiment's cohorts.
- **Soul:**87 fitting crops from16 early frames,91 calibration crops from6 later
  early-segment frames, and115 test crops from13 later frames. Fitting/calibration
  and calibration/test are separated by at least240 video frames. This is a
  temporal test from one recording, not independent-video validation.
- Actual test phases cover14 normal and9 soul classes. All32 phases are covered
  synthetically; the real test is not a measurement across every possible phase.
- The additional normal training cache was historically filtered by label-assisted
  template-colour consistency and recorded visibility. It preferentially contains
  easy/template-consistent examples; it is not oracle ownership supervision.
  Test crops receive no such quality filter. Cached training pixels are reused
  unchanged, with their existing provenance, rather than claimed equivalent to
  newly reprocessed full-frame pixels.

Same-colour synthetic rendering includes both sheets/mirrors, native raster and
rectification, independent no-fire backgrounds, lighting, fog, foreign flame
layers, foreground occlusion, blur, noise and small outline errors. It is not a
complete Minecraft renderer. Each model sees8x64x128 =65,536 generated views.
A fixed1,024-example synthetic check set selects the pretraining checkpoint.
Real adaptation uses12 epochs x12 updates, half real and half generated views,
balancing real frames rather than their number of captured quads.

Each effective128-example update accumulates four32-example microbatches to fit
the8GB GPU. Synthetic batch-normalization statistics therefore use32 examples,
whereas the previous small CNN used128. Batch normalization is frozen for real
adaptation. AdamW learning rates are.0005 for synthetic fitting and.00005 for
real adaptation, with.03 label smoothing. These are comparable-budget recipes,
not strict causal isolation of parameter count: architecture, normalization and
optimization behavior also differ.

Generated synthetic batches and real-adaptation data draws use fixed seeds
independent of architecture. Checkpoints minimize calibration cross entropy,
with the synthetic checkpoint eligible as adaptation epoch0. Test data is
evaluated only after selection. The test segments have been reused by earlier
research and this model-family comparison is exploratory, not a new blind test.

Preprocessing reuses the prior shared-native-unveiled corpus and retained data
hashes. No GUI inverse, colour eligibility, native geometry or frame decode is
changed. All game textures, recording pixels, checkpoints and caches remain local
and ignored; only research code, numeric predictions and this report are saved.

## Reproduction

Requires the prepared `.board/row32` corpus and existing research Python
environment. Official pretrained transformer weights are cached under the ignored
`.board/row32-large/torch` directory. The CNN uses the existing local official
`resnet101-63fe2227.pth` checkpoint.

```text
python FireCrackle/scripts/fire-ai/row32/large/test_large.py
python FireCrackle/scripts/fire-ai/row32/large/compare.py resnet101 .board/row32-large
python FireCrackle/scripts/fire-ai/row32/large/compare.py vit_b16 .board/row32-large
python FireCrackle/scripts/fire-ai/row32/large/audit.py .board/row32-large
python FireCrackle/scripts/fire-ai/row32/large/benchmark.py resnet101 .board/row32-large/resnet101/orange/best.pt
python FireCrackle/scripts/fire-ai/row32/large/benchmark.py vit_b16 .board/row32-large/vit_b16/orange/best.pt
```

The targeted model test checks both architectures accept native-size64x64 crops,
produce32 finite phase logits, and exceed40million parameters. A separate local
check verifies the pretrained transformer loads with its resized position bank
and replacement head. Frozen train/calibration/test cohorts and prediction
recounts are audited after training. No broad application test suite is run.
