# Boundary, alignment and occlusion robustness

Research result, 17 October 2026. No production matcher or default changed.

## Decision

Occlusion ownership is worth pursuing, but stricter colour masking is not a demonstrated solution. Another flame, white UI and valid flame pixels can share the same RGB. Correctly excluding foreign pixels helps in controlled scenes; our deployable colour filters do not reliably identify those pixels. Do not fill hidden regions with guessed fire.

There is no universal winning matcher in this experiment. Heavy boundary scoring improves accurate quads but sometimes overrides better single-pixel evidence on rough ones. Small whole-plane alignment searches help rough real quads and regress on compressed controls. Weaker boundary weighting and a gradient consistency variant look more balanced, but that conclusion is post hoc and needs new representative validation before promotion.

The original tuning-selected method **failed to generalize**: facing1 scored 51/818 and 42/818 on exact/rough tuning, versus colour 43/37, but fell to 54/310 on rough Quad1 versus colour 59. The tuning pool contains almost no source diversity (814 block, four overlays, no entity fire). Selecting on it did not predict performance on entities.

## Scope and protocol

25 frozen scoring variants were run on 5,538 dataset/geometry cases: **138,450 predictions**, plus controlled occlusion tests. Exact and rough versions are repeated measurements of the same cases, not independent samples. This covers the declared hypotheses, not every possible matching or segmentation algorithm.

| Dataset | Cases per geometry | Role and limitation |
|---|---:|---|
| Quad1 tuning | 818 | Early actual quads; no entities. Used to select facing1 before validation |
| Quad1 validation | 310 | Later actual quads, 129 block/181 entity, 28 correlated frames; reused diagnostic data |
| Survival | 52 | 28 block/24 entity; reused diagnostic data |
| Reviewed survival | 15 | 3 block/12 entity; easy existing review set, not representative |
| Additional survival | 38 | 19 previously unused frames, all entity; same recording, not an independent video |
| Codec controls | 1,024 each | Uncompressed, H.264 CRF24 and CRF32 saved synthetic crops |

Only actual quadrilaterals are used for real-data matching. Old bounding boxes are excluded. Quad1 separates training/tuning frames below 4136 from validation frames at least 4376. No truth label is used to adjust geometry, shortlist candidates or filter outcomes. All cases remain in denominators, including ineligible/no-prediction cases. Exact appearance requires sheet, row and mirror all correct among 128 classes.

The new-frame pool was frozen before inference. The initial geometry-only availability rule (45000..80999, frame modulo 240=47, 121-frame separation) found just one frame/two quads. It was revised **before viewing pixels or predictions** to 42000..80999, modulo 60=47, greater than 60 frames from previous survival/dense/reviewed cases. Up to two largest-min-edge block and two entity quads per frame, visibility >=.95, veil <=.05, corners inside .01..99, minimum edge 40 native pixels, edge ratio <=5; first 40 eligible frames maximum. This yielded 19 frames/38 quads. All 19 HUDs were visually audited by the assistant before scoring: hearts and hunger were visible, no creative HUD; no frame was removed.

Additional frames: 43547, 43607, 43667, 43727, 44087, 44267, 44387, 47627, 47927, 48467, 48527, 48587, 49127, 51107, 52967, 53027, 53087, 53447, 53627.

The secondary exploratory choice **jitter_max_pairs1** was frozen before new-frame inference, after looking at the reused diagnostics. It improved additional exact 13 to 14 and rough 10 to 12. Jitter4's rough 13/38 is a post-hoc observation, not the prespecified fresh result. Neither establishes a universal improvement.

Native 1920x1080 decode alignment was checked byte-for-byte against a sequentially decoded reference frame 48527 (SHA256 `9af0a03c5204d0f67dd2050ca1b18f9bf93a2772f24320431bd4802669c3860b`). Fast seek matched; no fallback was needed. Codec inputs are the exact saved **rectified 64x64 crops**, not original native 160x160 scene geometry; every method has the same preprocessing and no new encode.

## Methods

All methods use the current shared-gain colour evidence. Unknown, transparent and mismatching probes add zero; there is no negative evidence or observed-support denominator. Revealing an independent matching probe cannot reduce a candidate's evidence. Boundary features can nevertheless rank the wrong candidate higher when foreign colours happen to agree.

- `colour`: shipped fixed-quad scorer, with native-pixel duplicate caps.
- `pairs025/1/4`: old candidate-specific adjacent-texel boundary bonus with weights .25/1/4; fixed denominator 256 + weight*480. Each candidate maximizes over the shared gain histogram.
- `matched1/4`: correspondingly positioned subprobes rather than pooled cell support.
- `facing1/4`: subprobe pairs facing the shared texel boundary, scaled to preserve full-support normalization.
- `distinct1/4`: pair support requires at least two distinct supporting native pixels per texel.
- `gradient1/4`: matched pair support additionally weighted by red-channel intensity-ratio consistency, tolerance .12 in log2 ratio. Matched/facing/gradient exclude aliased endpoints.
- `shortlist3/5`: colour top 3/5 reranked by pairs4; `rrf2`: reciprocal rank fusion of colour and pairs4 top-five lists, constant 60.
- `strict_colour/pairs`: candidate-independent asset-palette gate, chroma tolerances .03 G/R and .05 B/R, gain .25..1.25, original warm/bright core gates preserved; pair variant uses weight4.
- `neutral_colour/pairs`: original mask plus B<=.6R or R>=200, suppressing some grey pixels, including legitimate shaded white flame.
- `jitter_max/mean_colour/pairs1/pairs4`: union of colour/pairs4 top-five candidates, at most ten. Nine whole-plane UV translations with each axis -1/32, 0 or +1/32. Max or mean aggregation. Original candidate-independent colour mask and 20% ROI pad; no per-texel distortion or truth-assisted search. This is a bounded alignment ablation, not a full arbitrary-quad optimizer.

Rough geometry uses the same preset perturbation as prior work: width 1.12, height .92, centre +.03/- .02 UV and individual .02 corner offsets. It is one reproducible error pattern, not a comprehensive distribution of human quad errors. The app's full quad optimizer is separate from this fixed-input experiment.

## Why the original rough-quad regression happened

Pairs4 changed 13 Quad1 rough decisions: six rescues and seven losses (59 to 58 correct). All seven losses were entity/blaze fire. Every false winner had **lower single-colour evidence but higher boundary evidence** than truth at its respective best joint gain. Strong boundary weighting reversed the ordering. Visual contact sheets show rods, smoke and overlapping fire crossing these planes; their exact causal contributions are not separately annotated, so they remain plausible contributors rather than proven per-pixel causes.

| Lost case | Truth single | Wrong single | Truth boundary | Wrong boundary |
|---|---:|---:|---:|---:|
| 5160-0-0 | 3.7021 | 3.6720 | .9072 | 1.4633 |
| 5160-1-4 | 9.7553 | 8.7450 | 3.5341 | 3.9170 |
| 5280-0-0 | 15.2181 | 14.3977 | 2.6433 | 3.2397 |
| 5640-0-0 | 2.3780 | 1.9416 | .2889 | .6308 |
| 5940-3-3 | .4232 | .4228 | .0210 | .0625 |
| 6480-3-4 | 2.6258 | 2.4926 | .7393 | .9303 |
| 6960-0-1 | 8.9688 | 7.7616 | 3.3150 | 3.8222 |

All seven baseline margins were below .0047, well below the app's .03 clear-result margin: these were uncertain rankings, not reliable automatic accepts. Jitter1 rescued five of these seven, but it lost other successes and regressed on codec controls. A controlled unit case also demonstrates that pooled evidence from unrelated subprobe corners can manufacture a boundary match; corresponding subprobe checks remove that particular mechanism without universally improving results.

## Full real-data results

Top-one exact appearance counts. Denominators: Quad1 310, survival 52, additional 38, for each geometry.

| Method | quad1/exact | quad1/rough | survival/exact | survival/rough | additional-scores/exact | additional-scores/rough |
|---|---:|---:|---:|---:|---:|---:|
| colour | 87 | 59 | 24 | 18 | 13 | 10 |
| pairs025 | 88 | 60 | 25 | 19 | 13 | 10 |
| pairs1 | 88 | 61 | 26 | 19 | 13 | 11 |
| pairs4 | 92 | 58 | 28 | 19 | 13 | 12 |
| matched1 | 89 | 61 | 26 | 19 | 13 | 11 |
| matched4 | 92 | 60 | 27 | 20 | 13 | 12 |
| facing1 | 90 | 54 | 26 | 19 | 14 | 10 |
| facing4 | 95 | 60 | 28 | 19 | 14 | 11 |
| distinct1 | 90 | 61 | 26 | 18 | 13 | 11 |
| distinct4 | 89 | 60 | 27 | 18 | 13 | 11 |
| gradient1 | 89 | 62 | 26 | 19 | 13 | 11 |
| gradient4 | 93 | 61 | 28 | 19 | 13 | 12 |
| shortlist3 | 93 | 61 | 26 | 19 | 13 | 11 |
| shortlist5 | 92 | 58 | 27 | 19 | 13 | 12 |
| rrf2 | 91 | 60 | 26 | 19 | 13 | 11 |
| strict_colour | 86 | 59 | 25 | 18 | 13 | 10 |
| strict_pairs | 91 | 57 | 28 | 19 | 13 | 12 |
| neutral_colour | 87 | 58 | 24 | 18 | 13 | 10 |
| neutral_pairs | 92 | 58 | 28 | 19 | 13 | 12 |
| jitter_max_colour | 82 | 66 | 25 | 19 | 12 | 11 |
| jitter_max_pairs1 | 87 | 68 | 25 | 19 | 14 | 12 |
| jitter_max_pairs4 | 87 | 68 | 26 | 19 | 14 | 13 |
| jitter_mean_colour | 75 | 60 | 24 | 17 | 9 | 9 |
| jitter_mean_pairs1 | 79 | 61 | 26 | 18 | 13 | 10 |
| jitter_mean_pairs4 | 81 | 60 | 26 | 19 | 13 | 11 |

Reviewed survival is 15/15 for every exact method. Rough is also 15/15 except facing4 (14/15). These easy cases cannot establish a useful winner.

## Codec controls

Every method scored 1024/1024 uncompressed. Compressed counts out of 1024:

| Method | codec/h264-crf24 | codec/h264-crf32 |
|---|---:|---:|
| colour | 921 | 483 |
| pairs025 | 921 | 497 |
| pairs1 | 928 | 501 |
| pairs4 | 916 | 496 |
| matched1 | 923 | 499 |
| matched4 | 916 | 473 |
| facing1 | 923 | 492 |
| facing4 | 899 | 449 |
| distinct1 | 920 | 495 |
| distinct4 | 900 | 461 |
| gradient1 | 921 | 494 |
| gradient4 | 909 | 466 |
| shortlist3 | 919 | 503 |
| shortlist5 | 915 | 501 |
| rrf2 | 925 | 502 |
| strict_colour | 901 | 450 |
| strict_pairs | 893 | 466 |
| neutral_colour | 923 | 474 |
| neutral_pairs | 913 | 488 |
| jitter_max_colour | 867 | 426 |
| jitter_max_pairs1 | 867 | 435 |
| jitter_max_pairs4 | 855 | 441 |
| jitter_mean_colour | 894 | 455 |
| jitter_mean_pairs1 | 904 | 469 |
| jitter_mean_pairs4 | 902 | 474 |

Jitter1's rough-real gain therefore comes with substantial codec loss: CRF24 921 to 867, CRF32 483 to 435. Weaker pairs1 improves these controls to 928/501; this is promising diagnostic evidence, not a prespecified universal selection.

## Selection audit

Original tuning counts, out of 818 each. Objective: maximize minimum net gain over colour across exact and rough, then summed gain, then declared method order. This selected facing1; its rough-validation failure is retained above.

| Method | tune/exact | tune/rough |
|---|---:|---:|
| colour | 43 | 37 |
| pairs025 | 47 | 36 |
| pairs1 | 49 | 35 |
| pairs4 | 52 | 36 |
| matched1 | 48 | 37 |
| matched4 | 51 | 36 |
| facing1 | 51 | 42 |
| facing4 | 55 | 37 |
| distinct1 | 48 | 35 |
| distinct4 | 51 | 32 |
| gradient1 | 49 | 36 |
| gradient4 | 48 | 36 |
| shortlist3 | 50 | 35 |
| shortlist5 | 50 | 35 |
| rrf2 | 47 | 32 |
| strict_colour | 42 | 35 |
| strict_pairs | 47 | 34 |
| neutral_colour | 43 | 35 |
| neutral_pairs | 52 | 36 |
| jitter_max_colour | 37 | 33 |
| jitter_max_pairs1 | 39 | 36 |
| jitter_max_pairs4 | 43 | 36 |
| jitter_mean_colour | 32 | 33 |
| jitter_mean_pairs1 | 34 | 34 |
| jitter_mean_pairs4 | 37 | 31 |

Paired frame-cluster bootstrap: 10,000 resamples, seed 20261017; percentage-point change relative to colour. This keeps same-frame quads together but cannot remove temporal dependence or same-recording bias. Intervals are descriptive, unadjusted for trying multiple methods, and not proof of cross-video generalization.

| Dataset | Method | Net correct | 95% interval (percentage points) |
|---|---|---:|---:|
| quad1/rough | pairs4 | -1 | -2.52 to +1.76 |
| quad1/rough | facing1 | -5 | -4.33 to +0.72 |
| quad1/rough | pairs1 | +2 | -1.03 to +2.43 |
| quad1/rough | gradient1 | +3 | -1.21 to +2.84 |
| additional-scores/exact | jitter_max_pairs1 | +1 | +0.00 to +8.11 |
| additional-scores/rough | jitter_max_pairs1 | +2 | +0.00 to +13.16 |

## Occlusion controls

These are deliberately simple cell-level fixtures, **not physically rendered Minecraft smoke or a real-data segmentation benchmark**. 128 appearances x three central opaque band widths (25%, 50%, 75%) x four foreign patch types = 1,536 retention scenes. Lighting gain .65. Classification uses 32 appearances (every fourth row, both sheets/mirrors), giving 96 cases per patch type, 384 total, each with four masks and three scorers.

Grey smoke-like patch is opaque RGB(145,145,145), not alpha smoke. Yellow rod is one fixed RGB(190,195,80), not a representative rod-colour distribution. White UI is RGB(245,245,245). Other-fire uses appearance (truth+37) mod128; only its opaque pixels cover the target. Retention counts only original opaque target texels, so transparent background silhouette cannot leak into the ideal mask. The oracle mask knows foreign ownership and removes only covered target pixels; it is an upper-bound diagnostic, not an implemented detector.

| Patch | Mask | Visible target retained | Foreign retained |
|---|---|---:|---:|
| grey_smoke | current | 100.00% | 100.00% |
| grey_smoke | strict | 100.00% | 100.00% |
| grey_smoke | neutral | 85.85% | 0.00% |
| yellow_rod | current | 100.00% | 0.00% |
| yellow_rod | strict | 100.00% | 0.00% |
| yellow_rod | neutral | 85.85% | 0.00% |
| white_ui | current | 100.00% | 100.00% |
| white_ui | strict | 100.00% | 100.00% |
| white_ui | neutral | 85.85% | 100.00% |
| other_fire | current | 100.00% | 100.00% |
| other_fire | strict | 100.00% | 100.00% |
| other_fire | neutral | 88.20% | 80.67% |

Neutral filtering loses about 14.15% of genuine visible dim flame in the grey/yellow/white fixtures and 11.80% in other-fire fixtures. Strict palette filtering retains foreign same-colour material. Yellow's zero contamination only establishes rejection of that single chosen RGB.

Classification counts out of 96 per row:

| Patch | Mask | Colour | Pairs4 | Facing1 |
|---|---|---:|---:|---:|
| grey_smoke | current | 64 | 94 | 76 |
| grey_smoke | strict | 64 | 94 | 76 |
| grey_smoke | neutral | 96 | 96 | 96 |
| grey_smoke | oracle_occluder_mask | 96 | 96 | 96 |
| yellow_rod | current | 96 | 96 | 96 |
| yellow_rod | strict | 96 | 96 | 96 |
| yellow_rod | neutral | 96 | 96 | 96 |
| yellow_rod | oracle_occluder_mask | 96 | 96 | 96 |
| white_ui | current | 64 | 94 | 76 |
| white_ui | strict | 64 | 94 | 76 |
| white_ui | neutral | 64 | 88 | 66 |
| white_ui | oracle_occluder_mask | 96 | 96 | 96 |
| other_fire | current | 43 | 38 | 39 |
| other_fire | strict | 43 | 38 | 39 |
| other_fire | neutral | 47 | 44 | 45 |
| other_fire | oracle_occluder_mask | 96 | 96 | 96 |

For other-fire occlusion, colour rises 43/96 to 96/96 with correct ownership masking, but strict colour remains 43/96 and neutral only reaches 47/96. White UI also defeats the naive neutral rule. Therefore the useful next hypothesis is **visible target-plane ownership**, using spatial/temporal structure or explicitly annotated occluders, rather than merely a narrower colour gate. This experiment does not establish an accurate real-world ownership mask.

## Reproduction and checks

- `boundary-robust-eval.mjs DATA OUT tune|validation exact|rough` compiles and samples the actual application modules. Frozen scoring SHA256: `e09b2e82ba9b751ed7da8f771c48cf5ff393d036b4aaad88cfc8ded6884ff8de`.
- `fire-ai/audit_boundary.py --select` created the original frozen selection at `2026-10-16T22:22:58.826049+00:00`. Do not rerun selection after validation and describe it as prespecified.
- `--prepare-holdout` records frame-selection rules and decode alignment; `--prepare-codec` extracts unchanged saved codec crops. Default mode renders all 13 rough changed-case contact sheets.
- `--summarize` rechecks every top1 count against individual truth/prediction, all 13 report hashes, unchanged app-module hashes, new-frame separation, decode verification, and emits tables plus bootstrap intervals. It does not rerun selection.
- `boundary-mask-controls.mjs OUT` writes the controlled mask retention/classification results. Script SHA256: `182b6e0d08f582d44568099e410e814c1094323e08c810a9ca9a69342c1c6f35`.
- 28 Node controls pass across boundary-robust, pixel-pair, edge-grid and plane-group suites, including exact reproduction of the old scorer, nonnegative/monotonic evidence, native-pixel aliasing, spatial pair correspondence and colour-identical occluders.
- Corrected the old pixel-pair fixture to hide the intended first half of observations. Its checkerboard symmetry had allowed a wrong-half fixture to pass; no scoring code changed.
- 23 existing Python renderer, model, screening and ensemble controls pass. Repository hygiene passes. Saved prediction totals, source hashes, new-frame separation and mask-control counts also pass the summary audit.

Local ignored evidence is under `.board/boundary-robust/`: `summary.json`, `frozen.json`, each dataset/geometry prediction JSON, `mask-controls.json`, `additional/protocol.json`, `additional/hud-review.json`, `audit-cases.json`, three contact-sheet pages and native frame files. Raw footage, assets and outputs are not bundled or committed. Joined Quad1 SHA256 `c3a39b59346ae4030e45099ebabd1bfc9d2b4e8a722341e5ca881ae8999147a0`; survival SHA256 `801c753dcfde61b09778eef3d8cfa55e340a7a967d6bf6090c6d5d6ce9184c9c`.

## Next decision

Keep the app matcher unchanged. Test weaker/gradient boundary scoring and whole-plane alignment on a representative entity-containing tuning set and a genuinely new recording before choosing defaults. For occlusion, collect or derive per-plane visible-ownership masks and compare them to the existing colour mask on the same untouched real cases. The controlled oracle result justifies that experiment; it does not justify claiming segmentation is solved, expanding the synthetic training set blindly, or shipping an ensemble on the basis of these reused datasets.
