# Automatic occlusion masking pilot

17 October 2026. Research only; the app matcher and its defaults are unchanged.

## Outcome

**We trained on survival patches**, compared synthetic-only training and a 50/50 mixture, and completed all downstream comparisons. Automatic masks learn useful rejection of white UI and smoke-like overlays in controlled scenes. They still remove genuine fire and retain other fire on real footage. No regime gives a reliable overall gain over the current colour matcher.

The validation-selected mixed model improves the synthetic ownership/matching test, but scores 85/310 exact and 56/310 rough on Quad1, against the existing matcher's 87/59. Survival-only training scores 83/61: a small rough gain and an exact regression. Its improvements on separated survival cases are small, mixed and not independent cross-video evidence. We did not choose a new model, mask threshold, duration or data filter after viewing these downstream outcomes.

## Training data and supervision

- **100 real survival training patches**, already visually screened in the earlier experiment, from frames 3168..40865. Review was by the assistant, not human certification. These are coherent/easier examples selected using geometry, visibility and label-colour agreement, not a representative heavily occluded dataset.
- **15 later survival patches**, frames 48026..53922, used for weak-label validation and model selection. Results on these 15 are selection diagnostics, not held-out evidence.
- Existing reviewed no-fire backgrounds: 344 training patches from clip1 and 230 validation patches from clip2. These are the same reviewed background pools documented in FIRE-AI-RESULTS.md. Backgrounds/foreign textures are independent of the target appearance.
- Real weak target masks use the recorded sprite and quad **only to construct training labels**. Expected transparent texels are negatives for that plane; expected opaque texels are positives only when observed G/R and B/R agree within .08/.12 and brightness is within .25 stops of a robust plane-wide median. Other opaque pixels stay **ignored**, not negative. Only inner 2x2 samples of each 4x4 rectified texel are supervised.
- Neither the recorded sprite identity nor its image is an input to the network at inference. The input is observed 64x64 RGB plus a broad fire-colour channel. There is no candidate-dependent learned masking or label-assisted inference search.
- Known injected occluders provide exact foreign coverage: textured patches, rods, white patches, mixed smoke-like rectangles and separately transformed fire. They add known negatives without treating unknown real occlusion as ground truth. Real images receive consistent mild translation/scale/mirroring, intensity/noise augmentation. The real base image does not become a fully labelled oracle just because synthetic occluders are added.

The capture JSON contains geometry, sprite labels and visibility/veil summaries. It does **not** contain a dense target-plane ownership map for these saved frames. Weak labels can themselves retain a same-colour foreign flame inside the expected opaque area. This is a central limitation of the pilot, not evidence that survival footage should be excluded from training.

## Model and fixed protocol

Custom small U-Net: **72,209 parameters**, RGB+colour-mask input, one target-visible probability per rectified pixel. Two encoder downsamplings, skip connections, GroupNorm and SiLU; no pretrained weights. BCE plus Dice, AdamW .0015, cosine schedule, batch64, seed1701. Eight epochs x128 steps = **65,536 augmented training examples per regime**, 196,608 total across the three models. The survival-only model repeatedly augments 100 unique real crops; the count is not 65,536 independent real observations. Mixed uses 32 real and 32 synthetic per update.

Synthetic training uses physically projected nearest-sampled fire planes at native160x160 over actual no-fire backgrounds, rectified to64x64. Conditions: clean; opaque background patch; narrow rod; white UI rectangle; partially transparent grey smoke-like rectangle; separately projected overlapping fire; exactly aligned overlapping fire; no target. It is a simplified renderer, not a complete Minecraft renderer. In particular smoke is not actual animated particle geometry, rods are rectangles, lighting is simplified, and foreground render order is explicitly assigned. Half the synthetic supplied quads have corner perturbations; the others are exact.

Identical checkpoint selection for all regimes: first maximum of 0.5 * mean synthetic validation IoU over seven target-present conditions +0.5 * weak survival validation IoU. Synthetic validation has512 balanced scenes; weak-real validation has256 fixed augmentations of the15 selection crops. No-target false positives are reported separately. The synthetic-training control also uses weak-real validation for checkpoint selection; it is not an experiment with zero real-data influence at every stage.

| Training regime | Selected epoch | Synthetic validation IoU | Weak survival validation IoU | Combined selection score |
|---|---:|---:|---:|---:|
| survival | 6 | 0.561 | 0.870 | 0.715 |
| synthetic | 8 | 0.742 | 0.394 | 0.568 |
| mixed | 8 | 0.725 | 0.747 | 0.736 |

Each checkpoint was frozen before its downstream tests. The aggregate comparison record was saved after initial survival diagnostics were already visible; it explicitly records this, so it is not presented as a completely blind preregistration. Model weights and the common selection rule were not changed in response. Mixed had the highest validation score.

## How the masks affect matching

The existing native-frame sampler, eligibility checks, all128 appearance templates and shared-gain similarity remain unchanged. A mask only multiplies existing sample weights, preserving native-pixel duplicate caps. There is no renormalization by retained area and no replacement of hidden fire pixels. The same mask is used for every candidate.

Six prespecified methods: current colour mask; 3x3 opening; 3x3 majority; learned probability; conservative blend .5+.5*p; learned threshold p>=.5. Spatial baselines are formed from the same broad RGB gate used as the model's fourth input and intersect existing native mask evidence. All mask fields are bilinearly sampled at the unchanged matcher's four texel probes. The native palette mask remains the final colour eligibility gate. The broad gate used for network inputs/pixel metrics is not claimed to be byte-identical to that native palette gate.

All scores remain nonnegative with the original fixed denominator. For a fixed learned mask, revealing an additional independent matching probe can add evidence without diluting previous evidence. A learned mask can nevertheless change globally if its input image changes; there is no claim of global monotonicity of the neural network itself.

## Real downstream results

Top-one exact appearance counts (sheet, row and mirror all correct). Denominators: Quad1 310 each; survival36 each; reviewed15 each; additional38 each.

| Method | quad1-exact | quad1-rough | survival-exact | survival-rough | reviewed-exact | reviewed-rough | additional-exact | additional-rough |
|---|---|---|---|---|---|---|---|---|
| Current colour | 87 | 59 | 14 | 9 | 15 | 15 | 13 | 10 |
| survival/learned_soft | 83 | 61 | 15 | 8 | 15 | 15 | 14 | 10 |
| survival/learned_half | 84 | 59 | 15 | 8 | 15 | 15 | 13 | 11 |
| survival/learned_hard | 83 | 61 | 14 | 9 | 15 | 15 | 14 | 10 |
| synthetic/learned_soft | 86 | 56 | 12 | 8 | 15 | 14 | 14 | 10 |
| synthetic/learned_half | 87 | 57 | 14 | 9 | 15 | 15 | 14 | 9 |
| synthetic/learned_hard | 82 | 50 | 12 | 8 | 15 | 13 | 12 | 8 |
| mixed/learned_soft | 85 | 56 | 13 | 9 | 15 | 15 | 14 | 9 |
| mixed/learned_half | 88 | 55 | 14 | 9 | 15 | 15 | 14 | 10 |
| mixed/learned_hard | 83 | 56 | 13 | 9 | 15 | 14 | 13 | 8 |
| opening | 87 | 58 | 14 | 9 | 15 | 15 | 13 | 10 |
| majority | 87 | 58 | 14 | 9 | 15 | 15 | 13 | 10 |

Quad1 is a different recording and has28 correlated validation frames. The original supplied baseline is reproduced exactly:87/310 and59/310. The model crop uses float32 projection; exported scoring quads have float32 coordinates, but baseline outcomes reproduce the original double-coordinate experiment exactly here. Survival36 excludes every frame within60 frames of either training or selection crops. The additional38 quads are from19 previously unused survival frames and pass the same separation guard; they remain in the same recording. They are not a new independent video. Reviewed15 are the selection pool and must not be counted as final validation.

The conservative mixed blend gets88/310 exact but55/310 rough. Selecting that post-hoc exact result would hide its regression. No single tested combination wins across these real columns.

Paired frame-cluster bootstrap (10,000 resamples, seed1701), percentage-point difference versus colour. These intervals do not account for all temporal dependence, multiple-method selection or same-recording bias.

| Training / data | Net correct | 95% interval, percentage points |
|---|---:|---:|
| survival / quad1-exact | -4 | -2.74 to +0.00 |
| survival / quad1-rough | +2 | -2.73 to +3.47 |
| survival / survival-exact | +1 | +0.00 to +8.33 |
| mixed / quad1-exact | -2 | -2.76 to +1.35 |
| mixed / quad1-rough | -3 | -3.86 to +0.93 |
| mixed / additional-exact | +1 | +0.00 to +8.11 |

## Real codec diagnostics

These are the same1,024 saved synthetic rectified64x64 crops per codec from previous research, not native160 scenes. Their target ownership maps were not saved, so only downstream matching is measured. No new encoding is implied by these rows.

| Method | codec-uncompressed | codec-h264-crf24 | codec-h264-crf32 |
|---|---|---|---|
| Current colour | 1024 | 921 | 483 |
| survival/learned_soft | 982 | 877 | 492 |
| survival/learned_half | 1024 | 921 | 497 |
| survival/learned_hard | 968 | 875 | 487 |
| synthetic/learned_soft | 1024 | 916 | 450 |
| synthetic/learned_half | 1024 | 918 | 478 |
| synthetic/learned_hard | 1023 | 882 | 439 |
| mixed/learned_soft | 1024 | 916 | 487 |
| mixed/learned_half | 1024 | 916 | 492 |
| mixed/learned_hard | 1024 | 915 | 486 |
| opening | 1024 | 921 | 483 |
| majority | 1024 | 921 | 483 |

The aggressive survival mask loses perfect clean-control performance (1024 to982), demonstrating removal of genuine evidence. The half-strength mask preserves that control and improves CRF32 from483 to497, but does not establish a real-data overall winner.

## New controlled ownership test

1,024 scenes:128 appearances for each of eight conditions, same seeds/native RGB across the three models.896 target-present scenes and128 no-target scenes. Test seeds are disjoint from training/selection, but held-out test backgrounds reuse the validation background pool with new composites; they are not independent background recordings. All three regimes see the exact same cases.

Counts out of128 per target-present condition:

| Condition | Colour | Survival soft | Synthetic soft | Mixed soft | Oracle |
|---|---|---|---|---|---|
| clean | 115 | 109 | 115 | 115 | 115 |
| background_patch | 114 | 103 | 114 | 116 | 115 |
| rod | 117 | 106 | 116 | 117 | 117 |
| white_ui | 89 | 101 | 111 | 111 | 111 |
| smoke | 113 | 113 | 117 | 118 | 118 |
| other_fire | 62 | 49 | 67 | 67 | 99 |
| aligned_fire | 0 | 15 | 7 | 22 | 88 |
| no_target | 0 | 0 | 0 | 0 | 0 |

No-target rows have no correct appearance by definition. All masks produced zero clear matches on the128 no-target fixtures; this limited result is not a general zero-false-positive claim.

Mixed improves target-present matching from610/896 to666/896; synthetic-training control647/896; survival-only596/896. The native ownership oracle reaches763/896. This oracle **only excludes known foreign coverage**, not background or known target silhouette. It is a reference intervention, not a strict upper bound on every conceivable mask; an automatic mask can occasionally suppress other confusing background pixels and beat it on a particular scene.

Aligned overlapping fire is deliberately difficult: the target and foreign flame share the same projected pixel grid. The mixed model reaches22/128 versus oracle88/128. Single-frame RGB may not uniquely identify which flame owns a pixel when grids, colours and brightness agree. Learning a generic orange mask cannot remove that ambiguity.

Pixel metrics below use p>=.5 for the learned probabilities; numbers are fractions. Visible target means target alpha survived and foreign opacity<.1. Smoke mixtures above.1 are deliberately discarded, not reconstructed. This ownership convention is explicit and is not a physical claim that a .11-alpha particle fully hides the target.

| Training | Condition | Mask | Target recall | Foreign retained | IoU |
|---|---|---|---|---|---|
| survival | other_fire | colour | 0.956 | 0.966 | 0.283 |
| survival | other_fire | learned_soft | 0.556 | 0.526 | 0.281 |
| survival | aligned_fire | colour | 0.994 | 0.957 | 0.106 |
| survival | aligned_fire | learned_soft | 0.489 | 0.687 | 0.084 |
| survival | white_ui | colour | 0.933 | 0.995 | 0.395 |
| survival | white_ui | learned_soft | 0.738 | 0.022 | 0.687 |
| survival | smoke | colour | 0.959 | 0.518 | 0.484 |
| survival | smoke | learned_soft | 0.804 | 0.037 | 0.744 |
| synthetic | other_fire | colour | 0.956 | 0.966 | 0.283 |
| synthetic | other_fire | learned_soft | 0.769 | 0.313 | 0.484 |
| synthetic | aligned_fire | colour | 0.994 | 0.957 | 0.106 |
| synthetic | aligned_fire | learned_soft | 0.673 | 0.417 | 0.170 |
| synthetic | white_ui | colour | 0.933 | 0.995 | 0.395 |
| synthetic | white_ui | learned_soft | 0.954 | 0.014 | 0.902 |
| synthetic | smoke | colour | 0.959 | 0.518 | 0.484 |
| synthetic | smoke | learned_soft | 0.951 | 0.041 | 0.890 |
| mixed | other_fire | colour | 0.956 | 0.966 | 0.283 |
| mixed | other_fire | learned_soft | 0.688 | 0.289 | 0.446 |
| mixed | aligned_fire | colour | 0.994 | 0.957 | 0.106 |
| mixed | aligned_fire | learned_soft | 0.661 | 0.402 | 0.172 |
| mixed | white_ui | colour | 0.933 | 0.995 | 0.395 |
| mixed | white_ui | learned_soft | 0.947 | 0.020 | 0.877 |
| mixed | smoke | colour | 0.959 | 0.518 | 0.484 |
| mixed | smoke | learned_soft | 0.949 | 0.060 | 0.865 |

The mixed model cuts foreign-fire retention from.966 to.289 in differently projected overlap, but also cuts target recall from.956 to.688. In aligned overlap it retains.402 of foreign pixels and only.661 of genuine target pixels. Rejection alone is insufficient: the discarded target pixels can carry the row-discriminating evidence. White UI/smoke controls transfer much better than fire-on-fire ownership.

## Error and confidence audit

Every changed real top-one decision is preserved in `paired-changes.json`. Contact-sheet selection is deterministic: first three losses and first three rescues, when available, for survival/mixed on Quad1 exact/rough and additional exact/rough. All four sheets were visually inspected. Each card shows observed RGB, probability mask, attenuated RGB and expected sprite. The expected sprite is an audit reference, not a model input.

Examples5160-0-4 and several5640 rough quads lose useful flame structure under masking. Some rescues remove bright rods or dark clutter. Masks often suppress dim/distorted true flame or keep only a small bright core, and still retain portions of other flames. These visual observations explain plausible mechanisms; without real per-pixel ownership labels they do not certify which exact pixels were foreign in every case.

A changed score distribution also changes the existing .03 clear-result margin. We retained that threshold unchanged and report all clear/wrong-clear outcomes rather than claiming mask scores are calibrated confidence.

<details><summary>All clear-result counts and errors</summary>

| Training | Dataset | Mask | Clear | Wrong clear |
|---|---|---|---|---|
| survival | quad1-exact | colour | 61 | 20 |
| survival | quad1-exact | learned_soft | 49 | 16 |
| survival | quad1-rough | colour | 20 | 10 |
| survival | quad1-rough | learned_soft | 16 | 9 |
| survival | survival-exact | colour | 21 | 13 |
| survival | survival-exact | learned_soft | 22 | 14 |
| survival | survival-rough | colour | 8 | 8 |
| survival | survival-rough | learned_soft | 8 | 8 |
| survival | reviewed-exact | colour | 15 | 0 |
| survival | reviewed-exact | learned_soft | 15 | 0 |
| survival | reviewed-rough | colour | 12 | 0 |
| survival | reviewed-rough | learned_soft | 12 | 0 |
| survival | additional-exact | colour | 17 | 10 |
| survival | additional-exact | learned_soft | 16 | 9 |
| survival | additional-rough | colour | 9 | 6 |
| survival | additional-rough | learned_soft | 9 | 6 |
| survival | synthetic | colour | 559 | 109 |
| survival | synthetic | learned_soft | 487 | 92 |
| survival | codec-uncompressed | colour | 1024 | 0 |
| survival | codec-uncompressed | learned_soft | 938 | 0 |
| survival | codec-h264-crf24 | colour | 393 | 0 |
| survival | codec-h264-crf24 | learned_soft | 361 | 0 |
| survival | codec-h264-crf32 | colour | 56 | 0 |
| survival | codec-h264-crf32 | learned_soft | 55 | 0 |
| synthetic | quad1-exact | colour | 61 | 20 |
| synthetic | quad1-exact | learned_soft | 43 | 16 |
| synthetic | quad1-rough | colour | 20 | 10 |
| synthetic | quad1-rough | learned_soft | 7 | 3 |
| synthetic | survival-exact | colour | 21 | 13 |
| synthetic | survival-exact | learned_soft | 18 | 10 |
| synthetic | survival-rough | colour | 8 | 8 |
| synthetic | survival-rough | learned_soft | 5 | 5 |
| synthetic | reviewed-exact | colour | 15 | 0 |
| synthetic | reviewed-exact | learned_soft | 14 | 0 |
| synthetic | reviewed-rough | colour | 12 | 0 |
| synthetic | reviewed-rough | learned_soft | 8 | 0 |
| synthetic | additional-exact | colour | 17 | 10 |
| synthetic | additional-exact | learned_soft | 11 | 5 |
| synthetic | additional-rough | colour | 9 | 6 |
| synthetic | additional-rough | learned_soft | 4 | 2 |
| synthetic | synthetic | colour | 559 | 109 |
| synthetic | synthetic | learned_soft | 529 | 72 |
| synthetic | codec-uncompressed | colour | 1024 | 0 |
| synthetic | codec-uncompressed | learned_soft | 1015 | 0 |
| synthetic | codec-h264-crf24 | colour | 393 | 0 |
| synthetic | codec-h264-crf24 | learned_soft | 290 | 0 |
| synthetic | codec-h264-crf32 | colour | 56 | 0 |
| synthetic | codec-h264-crf32 | learned_soft | 41 | 0 |
| mixed | quad1-exact | colour | 61 | 20 |
| mixed | quad1-exact | learned_soft | 49 | 14 |
| mixed | quad1-rough | colour | 20 | 10 |
| mixed | quad1-rough | learned_soft | 11 | 5 |
| mixed | survival-exact | colour | 21 | 13 |
| mixed | survival-exact | learned_soft | 20 | 12 |
| mixed | survival-rough | colour | 8 | 8 |
| mixed | survival-rough | learned_soft | 6 | 6 |
| mixed | reviewed-exact | colour | 15 | 0 |
| mixed | reviewed-exact | learned_soft | 13 | 0 |
| mixed | reviewed-rough | colour | 12 | 0 |
| mixed | reviewed-rough | learned_soft | 9 | 0 |
| mixed | additional-exact | colour | 17 | 10 |
| mixed | additional-exact | learned_soft | 11 | 5 |
| mixed | additional-rough | colour | 9 | 6 |
| mixed | additional-rough | learned_soft | 4 | 2 |
| mixed | synthetic | colour | 559 | 109 |
| mixed | synthetic | learned_soft | 525 | 70 |
| mixed | codec-uncompressed | colour | 1024 | 0 |
| mixed | codec-uncompressed | learned_soft | 1024 | 0 |
| mixed | codec-h264-crf24 | colour | 393 | 0 |
| mixed | codec-h264-crf24 | learned_soft | 305 | 0 |
| mixed | codec-h264-crf32 | colour | 56 | 0 |
| mixed | codec-h264-crf32 | learned_soft | 38 | 0 |

</details>

## Runtime, reproducibility and checks

Batch-one mask inference with four CPU threads,20 warmups/200 repeats. Includes RGB colour-channel preprocessing, model, sigmoid and output-to-CPU copy, with the RGB input already on the selected device. Excludes native decode, crop rectification and the appearance matcher. CUDA runs overlapped CPU scoring activity, so these are pilot measurements, not isolated GPU throughput claims.

| Training | CPU ms | CUDA ms |
|---|---:|---:|
| survival | 2.40 | 2.92 |
| synthetic | 2.83 | 3.46 |
| mixed | 3.10 | 3.29 |

Commands from repository root (Python executable `.board/fire-ai/venv/Scripts/python.exe`):

```text
python FireCrackle/scripts/fire-ai/occlusion/run.py train --source survival --run survival
python FireCrackle/scripts/fire-ai/occlusion/run.py train --source synthetic --run synthetic
python FireCrackle/scripts/fire-ai/occlusion/run.py train --source mixed --run mixed
python FireCrackle/scripts/fire-ai/occlusion/run.py real --run RUN
python FireCrackle/scripts/fire-ai/occlusion/run.py synthetic --run RUN
python FireCrackle/scripts/fire-ai/occlusion/run.py codec --run RUN
python FireCrackle/scripts/fire-ai/occlusion/run.py latency --run RUN
node FireCrackle/scripts/occlusion-mask-eval.mjs .board/occlusion-mask/RUN/DATASET .board/occlusion-mask/RUN/scores/DATASET
python FireCrackle/scripts/fire-ai/occlusion/summarize.py
```

The repeated compressed-NPZ read in the initial codec export was stopped and fixed by loading each NPZ array once. The affected export was rerun; no training/inference math or checkpoint changed. `run.py` also received a docstring correction after training; frozen source hashes therefore identify the training version rather than these later I/O/documentation edits. Renderer, supervision and network math stayed fixed.

`freeze.json` under each run records model checksum, selection epoch, dataset/review hashes, all real train/selection IDs and source hashes. Checkpoints:

- survival: `25257fae34ce1281a4e5ff63f95df120799173abd70929f5dd42f31f34c20a5b`.
- synthetic: `b7e194853b8b802dbe36ae9dbe2e73ff4b9961d1d858a220ea647ef87bc7077b`.
- mixed: `5060c69b9dbb688cd72bcc04cbad1149d86e32144e5d300d1b40c3bfcb901528`.

All36 result reports were audited against per-case truth, shared native module hashes, identical baseline predictions across regimes and temporal separation. **4,894 cases per regime**,14,682 repeated case evaluations across three models, **91,164 mask-method predictions**. These totals include repeated exact/rough geometries and codec versions; they are not counts of independent real scenes. The new controlled test differs from the earlier idealized cell-mask oracle test, so its percentages must not be substituted for the earlier43/96->96/96 result.

Ten Python controls cover renderer repeatability, foreign/visible disjointness, empty target, oracle ownership, crop pixel centres, morphology, metrics, checkpoint roundtrip, weak-label ignoring and temporal split. Six JavaScript controls cover identity mask/native duplicate caps, no renormalization, common candidate-independent attenuation, interpolation, native oracle coordinates and invalid probabilities. No Minecraft assets, native frames, datasets or model weights are committed or bundled; ignored evidence and four audit sheets remain under `.board/occlusion-mask/`.

## Next justified step

Keep the existing matcher as default. Survival patches were useful for learning their domain, but their weak labels are not enough to supervise real occlusion ownership. Before scaling this model, obtain a small real ownership-labelled set (engine-exported per-plane visible masks would be ideal) or test temporal plane tracking with independently verified masks. Both would address the actual target/foreign distinction. The present pilot does not support shipping this mask or treating another generic colour filter as solved occlusion removal.
