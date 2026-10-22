# Coherent line groups and joint pixel-boundary evidence

2026-10-17. Continuation of [edge-grid research](EDGE-GRID-RESULTS.md). **No application matcher or released package changes.** Grouped-line geometry correction failed validation. A candidate-specific pixel-boundary prototype gives a small improvement with accurate geometry, but regresses on rough geometry and remains experimental.

## Dataset and separation

The same actual-quad recording is used: 818 tuning cases before frame 4136, 240-frame separation, 310 validation cases from frame 4376 onward. Validation has 129 block and 181 entity quads from 28 correlated frames. Tuning has 814 block and 4 overlay quads, no entities. Native 1920x1080 decoded pixels are unchanged. This temporal validation segment has been used by earlier research and is not an independent unseen recording.

Exact means sheet + row + mirror. Rough outlines use the previously declared 112% width, 92% height, +3%/-2% shift and two +2% corner perturbations. The baseline colour scorer keeps the supplied geometry fixed; these are isolated geometry/ranking comparisons, not a head-to-head test against the app's default per-sprite optimizer. No old bounding-box data is fitted. Recorded corners and sprite labels are used only after inference to score outcomes.

## Experiment A: coherent line families

Native Sobel edge pixels near the fire-colour mask are sampled once and mapped into the supplied quad's plane. Projected gradient directions separate approximately vertical and horizontal fragments. A small Hough accumulator groups collinear fragments over slopes -0.2 through 0.2. Each line needs multiple pixels spanning at least 0.03 plane units. A robust periodic-family search fits line spacing from 0.05 through 0.08 plane units and an origin nearest the supplied texture origin. Missing lines and outlier fragments contribute no votes.

Two line families imply an affine correction within the original quad's projective plane. Corners outside the existing 120% envelope are rejected. Fits are skipped below two estimated native pixels per texel. This is a restricted line-family method, not full multi-plane segmentation or unrestricted vanishing-point/homography reconstruction. Independently selected axis families are not proof that both belong to one physical face. Integer-cell origin ambiguity remains.

Two variants were compared on all tuning cases:

| Rough tuning, 818 cases | Baseline | Four-line minimum | Six-line minimum |
|---|---:|---:|---:|
| Exact top 1 | 37 | 36 | 37 |
| Exact top 3 | 51 | 53 | 53 |
| Wrong gate passes | 35 | 29 | 29 |
| Correct gate passes | 6 | 9 | 7 |
| Moved quads | 0 | 38 | 31 |
| Corner RMS improved / worsened | — | 21 / 17 | 19 / 12 |

The six-line variant was frozen before validation. Script SHA-256 `4d86dc724d7258297319ef1126cd0462e71eaa2ce16bdc7d897808bf9636bfd8`; shared gradient evaluator `513c7fbddc641c1cdb9eb8f36d8c9f4dc31b28faa3a02f94847cc048ab92eb67`. Selection is saved in ignored `.board/plane-groups/frozen.json`. No geometry or gate thresholds were retuned after validation.

| Validation | Baseline exact top 1 | Grouped fit exact top 1 | Baseline / fitted top 3 | Baseline / fitted wrong passes |
|---|---:|---:|---:|---:|
| Accurate corners, 310 | 87 | 71 | 102 / 87 | 20 / 17 |
| Rough corners, 310 | 59 | 51 | 74 / 66 | 10 / 9 |

For accurate corners, correct gate passes fell 41 to 31. For rough corners, they fell 10 to 9. Reduced wrong passes therefore do not demonstrate better accepted-match reliability. The rough fit moved 51 quads: corner RMS improved in 27 and worsened in 24. Accurate-input fits moved 58 quads away from the recorded corners. The entity subgroup lost exact matches, 83 to 67 with accurate outlines and 58 to 49 with rough outlines. Block results were 4 to 4 and 1 to 2 respectively.

The selected method works on the controlled synthetic plane: a stretched and shifted checkerboard is recovered within two native pixels RMS without a sprite label. Real-data line spacing/origin estimates remain insufficient. Visual inspection of tuning failures `3000-1-5`, `3240-1-5`, `3060-1-1` showed substantial quad shrinkage despite supported line groups; RMS errors rose from about 9-10 to 24-25 pixels. These examples illustrate failure, not its complete causal attribution. Diagnostic images remain local.

## Experiment B: boundaries jointly constrained by the sprite

Instead of moving the quad first, the second prototype asks whether adjacent observed texels support the brightness/colour transition expected by a candidate sprite. It reuses the fire-colour mask, native-pixel probe weights and fixed shared-gain hypotheses. For each of the 480 adjacent texel pairs, both texels must positively match the candidate under the **same gain**. The pair vote is their minimum support, weighted by the candidate's expected log-brightness/chromaticity contrast. Uniform candidate regions receive no boundary bonus.

Score is `max_gain (single_votes + lambda * boundary_votes) / (256 + lambda * 480)`. Each feature is nonnegative and its normalization is fixed. Unknown, transparent and mismatching samples add zero. Adding independent supporting samples cannot dilute prior evidence. This is a ranking prototype; it has no new calibrated acceptance gate and does not identify fire presence.

An eligibility audit corrected a scratch-evaluator issue before this validation: internal sampling had ranked two tiny/insufficient tuning quads that the app leaves unranked. All results below use the app's eligibility checks. The earlier shared-gain report now explains this explicitly; its application-based validation counts were already correct.

| Accurate tuning, 818 cases | Baseline | lambda 0.25 | lambda 1 | lambda 4 |
|---|---:|---:|---:|---:|
| Exact top 1 | 43 | 47 | 49 | 52 |

Lambda 4 was selected and frozen before validation in `.board/plane-groups/joint-frozen.json`; the original frozen prototype hash is `40d20ae5be0c796740646aa4c85135b6741672dba4e55e09ea9b29dbedaa95b2`. Lower weights were not selected based on validation performance.

| Validation, selected lambda 4 | Baseline exact top 1 | Joint boundaries exact top 1 | Baseline / joint top 3 |
|---|---:|---:|---:|
| Accurate corners, 310 | 87 | 92 | 102 / 104 |
| Rough corners, 310 | 59 | 58 | 74 / 76 |

With accurate corners, seven predictions improve and two regress. Block exact matches improve 4 to 6; entity exact matches improve 83 to 86. With rough corners, six improve and seven regress, with entity matches falling 58 to 57 and block matches unchanged at 1. No acceptance precision is claimed. On this small correlated, repeatedly used corpus, a five-case net gain with accurate geometry is not sufficient evidence to replace the general matcher.

The retained `pixel-pair-eval.mjs` refactors the frozen prototype into an importable, independently tested function. Its SHA-256 is `c2a681dcbb92cd2b7ffc5f21cb4af81fc21f437c71856ecb91dab173a71d0c12`. All per-case rankings, scores and margins were verified identical to the frozen prototype on both 310-case validation modes; no numerical or algorithmic change was introduced by that refactor.

## Reproduction and retained outcomes

All 1240 validation rows (grouped fit and joint boundary experiments, each exact/rough) are retained in [plane-group-results.csv](plane-group-results.csv). Detailed JSON, native runtime snapshots, frozen configurations, exploratory weights and diagnostic images remain ignored under `.board/plane-groups`. No recordings are committed.

```
node --test FireCrackle/scripts/plane-group-eval.test.mjs FireCrackle/scripts/pixel-pair-eval.test.mjs
node FireCrackle/scripts/plane-group-eval.mjs FireCrackle/src-tauri/target/actual-quad1 .board/plane-groups/tune tune rough 1 strict
node FireCrackle/scripts/plane-group-eval.mjs FireCrackle/src-tauri/target/actual-quad1 .board/plane-groups/validation validation exact 1 strict
node FireCrackle/scripts/plane-group-eval.mjs FireCrackle/src-tauri/target/actual-quad1 .board/plane-groups/validation validation rough 1 strict
node FireCrackle/scripts/pixel-pair-eval.mjs FireCrackle/src-tauri/target/actual-quad1 .board/plane-groups/ported validation exact
node FireCrackle/scripts/pixel-pair-eval.mjs FireCrackle/src-tauri/target/actual-quad1 .board/plane-groups/ported validation rough
```

Twelve controls pass: fragment grouping with missing lines/clutter; rejection of a single line; independently checked affine corners; envelope rejection; projective corner correspondence; flat/unknown mask behavior; end-to-end native synthetic-plane recovery; same-chromaticity brightness-pattern discrimination; zero evidence for unknown/transparent pixels; monotonic revealing of independent evidence; neutrality of colour mismatches; and zero-weight native-pixel protection.

Matcher source hash throughout: `510a675c7b665722d319d5fc9411e7f738e1a23df6a90acc6496db9e62014d7c`. Joined-label hash: `c3a39b59346ae4030e45099ebabd1bfc9d2b4e8a722341e5ca881ae8999147a0`. The existing source pixels, geometric truth and visibility limitations are documented in [ACTUAL-QUAD-RESULTS.md](ACTUAL-QUAD-RESULTS.md).
