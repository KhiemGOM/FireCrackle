# Pixel-edge grid fitting: real-data validation

2026-10-17. **Do not integrate this experimental version.** It detects a clean synthetic texel grid, but reduces sprite identification on the recorded quads. This is a negative result for this implementation, not a rejection of all pixel/plane reconstruction methods. The application matcher and released packages were not changed.

## Hypothesis and implementation

Known fire textures are 16x16 texels. Fit a projected grid to visible colour boundaries before choosing a sprite, so overlapping fire on another plane contributes less evidence.

The standalone evaluator computes native-resolution luminance Sobel gradients. At the 480 internal boundary probes of a proposed 16x16 grid, it measures gradient strength normal to the projected boundary. Direction-aware variants discount tangential gradients. Probes require a nearby pixel in the existing candidate-independent fire-colour mask. Missing edges add zero; votes are bounded and repeated probes of the same native pixel are deduplicated separately per axis.

Three variants were explored on tuning data:

- **Strength:** normal gradient only.
- **Aligned:** normal gradient minus tangential gradient, clamped to zero.
- **Localized:** aligned response at a boundary minus the mean response a quarter texel to either side, clamped to zero. This favours boundary-localized contrast over texture-interior contrast.

The fitter uses the existing eight-coordinate bounded Nelder-Mead optimizer, 220 evaluations, and the original quad's 120% projective envelope. Fitting is skipped below two estimated native pixels per texel. A moved fit requires at least four supported grid lines per axis and 24 supported edge probes. It is independent of candidate row, sheet and mirror. A second diagnostic scores only colour samples in texels adjacent to sufficient grid-edge support; it uses the application's existing nonnegative shared-gain colour evidence and status gate.

This is guided grid fitting and patch selection, **not** complete edge-line clustering, pixel quadrilateral segmentation, multi-plane reconstruction or a global optimum search. A periodic grid does not by itself determine which cell is texture cell zero.

## Evaluation protocol

Same actual-quad recording as [known-quad matching](KNOWN-QUAD-RESULTS.md), at native 1920x1080 without resizing or extra compression. Tuning: 818 quads before frame 4136. Validation: 310 quads from frame 4376 onward, separated by 240 frames. Those 310 quads come from 28 frames; multiple faces per frame are correlated. This reused temporal segment is not a new unseen recording. The tuning segment has 814 block and 4 overlay quads, no entity quads; validation has 129 block and 181 entity quads.

Each case was tested with the recorded corners and with the same deterministic rough perturbation used previously: 112% width, 92% height, centre shifts +3%/-2%, and two independent +2% corner perturbations. Only that input outline, image pixels and known sprite assets reach the algorithm. Recorded corners are used afterwards to measure corner RMS error; row/sheet/mirror truth is used only after classification.

The colour matcher keeps geometry fixed after the edge stage. Its baseline uses the **same unadjusted input outline**, also with geometry fixed. This isolates the effect of the candidate-independent edge stage; it is not a head-to-head comparison with the app's default per-sprite colour optimizer. For that optimizer's earlier results see the linked report.

## Tuning and freeze

Initial comparisons used every eighth tuning quad (103 cases), including raw strength, aligned and localized variants. Full 818-case rough-outline runs then gave:

| Method | Exact top 1 | Correct in top 3 |
|---|---:|---:|
| No edge fitting | 37 | 51 |
| Aligned edge fit | 26 | 44 |
| Localized edge fit | 29 | 42 |

Localized was selected as the less harmful edge-fitting variant before validation. Its rough tuning geometry improved in 51 moved cases and worsened in 153; 614 were left unchanged. The additional edge-supported colour mask scored 10/818 exactly, versus 21/818 for the aligned-mask experiment, so patch restriction was not selected as an improvement. It remains a reported diagnostic, with no validation-derived parameter changes.

Frozen script SHA-256: `513c7fbddc641c1cdb9eb8f36d8c9f4dc31b28faa3a02f94847cc048ab92eb67`. Matcher SHA-256: `510a675c7b665722d319d5fc9411e7f738e1a23df6a90acc6496db9e62014d7c`. Configuration and tuning-selection evidence were written to `.board/edge-grid/frozen.json` before validation. Gradient response cap is 32 and the patch support threshold is 0.2. No score, fitting or acceptance constants were changed after validation.

## Validation results

Exact means all of sheet, row and mirror correct. Wrong status-gate passes are retained; these are not calibrated probabilities.

| Input | Method | Exact top 1 | Top 3 | Gate passes | Correct passes | Wrong passes |
|---|---|---:|---:|---:|---:|---:|
| Accurate corners | No edge fitting | 87/310 | 102 | 61 | 41 | 20 |
| Accurate corners | Localized edge fit | 84/310 | 93 | 56 | 36 | 20 |
| Accurate corners | Edge fit + supported patches | 79/310 | 89 | 45 | 29 | 16 |
| Rough corners | No edge fitting | 59/310 | 74 | 20 | 10 | 10 |
| Rough corners | Localized edge fit | 49/310 | 65 | 15 | 7 | 8 |
| Rough corners | Edge fit + supported patches | 30/310 | 45 | 0 | 0 | 0 |

On rough validation outlines, 47 moved fits reduced corner RMS error while 107 increased it; 156 remained unchanged. On accurate outlines, 149 moved away from the recorded geometry and 161 stayed unchanged. Increased edge objective therefore did not imply recovery of the intended full texture quad. Fewer wrong gate passes after restricting patches came with reduced correct coverage; abstaining on all rough cases is not a successful detector.

The entity subgroup lost the useful matches: accurate outlines 83 to 80 exact, rough outlines 58 to 48. Block exact matches stayed 4 and 1 respectively. No absence/no-fire dataset was tested, so these results do not establish presence false-positive rates. Each full validation mode took about 18.5 seconds locally.

All 620 paired cases, including unchanged cases, abstentions, scores, corner errors, before/after quads and classification errors, remain in ignored detailed JSON under `.board/edge-grid/validation`. The compact [edge-grid-results.csv](edge-grid-results.csv) retains all classification outcomes and geometry errors without the private video frames.

## Controls and interpretation

Seven executable controls pass: flat image has zero evidence; an independently constructed 12-pixel checkerboard favours the correct grid over a quarter-texel offset; an unknown colour mask adds no evidence; one scene edge does not establish two axes; off-image grids give finite zero scores; a skewed plane uses projected directions; repeated native edge sampling cannot manufacture hundreds of votes.

The controlled grid success plus real-data geometry/identification regressions show that this objective is insufficient for plane isolation. Overlapping faces, scene edges, low native resolution, compression and integer-texel origin ambiguity are plausible contributors; their individual contributions were not isolated here. Reliable reconstruction would need stronger evidence for coherent edge groups belonging to the same plane, rather than accepting a larger sum of nearby edge responses. This experiment does not establish whether a multi-plane line/region clustering method would succeed.

## Reproduction

From the repository root, with the previously prepared native frames:

```
node --test FireCrackle/scripts/edge-grid-eval.test.mjs
node FireCrackle/scripts/edge-grid-eval.mjs FireCrackle/src-tauri/target/actual-quad1 .board/edge-grid/full-tune tune aligned rough 1
node FireCrackle/scripts/edge-grid-eval.mjs FireCrackle/src-tauri/target/actual-quad1 .board/edge-grid/full-tune tune localized rough 1
node FireCrackle/scripts/edge-grid-eval.mjs FireCrackle/src-tauri/target/actual-quad1 .board/edge-grid/validation validation localized exact 1
node FireCrackle/scripts/edge-grid-eval.mjs FireCrackle/src-tauri/target/actual-quad1 .board/edge-grid/validation validation localized rough 1
```

Runtime snapshots and full source hashes are saved with each local run. Joined-label SHA-256: `c3a39b59346ae4030e45099ebabd1bfc9d2b4e8a722341e5ca881ae8999147a0`. Dataset preparation and its visibility limitations are documented in [ACTUAL-QUAD-RESULTS.md](ACTUAL-QUAD-RESULTS.md).
