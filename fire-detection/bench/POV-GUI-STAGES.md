# Per-stage GUI-mask protocol

2026-10-18. Development comparison on the same four recordings as the previous ablation. Configurations fixed before inspecting this run; threshold stays 0.5. These reused recordings do not become an independent holdout just because more combinations are tried.

- Mask coverage: opaque GUI only; opaque GUI plus unknown hotbar-item/crosshair/effect-icon interiors; all of those plus translucent GUI.
- Silhouette ranking: original or GUI-excluded.
- Colour ranking: original or GUI-excluded. Both use the existing canonical standardized components and colour weight.
- Acceptance gate: frozen original overall detection decision; unmasked colour evidence evaluated at the selected row; excluded probes contribute zero with the original denominator; or excluded probes removed from the denominator.
- FOV: frozen original choice; highest selected-row visible-only score; or highest selected-row zero-evidence/original-denominator score. Equal scores prefer70 degrees, as before.
- Total:3 ×2 ×2 ×4 ×3 =144 configurations. Some intentionally reduce to the same behavior; report unique results and the single-stage controls too.
- Unchanged: canonical GUI detector/options and assets, shared automatic veil correction, thresholds, sampling, tick-valid truth joining. Predictions never read labels.
- Cache per-row canonical score components/counts for future combinations. Verify cached combinations reproduce the previous baseline and full-mask outputs on every sampled frame.
- Measure correct accepted overlays, presence false positives, wrong accepted rows, recovered/lost correct frames and candidate-row accuracy separately. A rule keeping the original detection gate cannot increase presence recall; its test concerns row selection only.
- Normal app calls must retain no diagnostic allocation and exact previous outputs. Do not enable a new automatic rule based only on selecting the best of these development results.

Before inspecting stage results, the normalization follow-up expanded colour ranking to five choices: original raw sum, unmasked mean (normalization-only control), masked sum, masked visible-only mean, and masked sum/original denominator. The final matrix is3 ×2 ×5 ×4 ×3 =360. Acceptance remains0.5 throughout. The initial144 configurations are retained as a subset.

The feature cache depends on the Rust inference sources, GUI assets, video identity/size and sampling, not on Python combination code. Changing only post-processing combinations can reuse those diagnostics; stale inference/asset hashes are still rejected. The report records its analysis source hash separately.

## Completed results

13,431 sampled frames: 1,513 first-person overlays and 11,918 negatives. The 360 parameter combinations produced 316 distinct joint row/acceptance outputs. They are correlated development comparisons, not independent trials. Every baseline and previous full-mask row/score reproduced on all 13,431 frames (score tolerance 1e-8).

| Fixed rule across all clips | Correct accepted / 1,513 | Presence false positives | Wrong accepted rows | Recovered / lost correct |
|---|---:|---:|---:|---:|
| Original matcher | 1,396 (92.3%) | 0 | 0 | 0 / 0 |
| Opaque GUI excluded only from acceptance; visible denominator; original row and FOV | 1,442 (95.3%) | 0 | 0 | 46 / 0 |
| Above, with unmasked normalized colour ranking and visible-score FOV | 1,444 (95.4%) | 0 | 0 | 48 / 0 |
| Opaque GUI excluded only from acceptance; original denominator control | 1,428 (94.4%) | 0 | 0 | 32 / 0 |
| All GUI excluded throughout; visible denominator and FOV (previous experiment) | 1,483 (98.0%) | 16 | 0 | 87 / 0 |

Per-clip correct accepted counts:

| Clip | True overlays | Original | Opaque acceptance only | Normalized ranking + opaque acceptance | Previous all-GUI mode |
|---|---:|---:|---:|---:|---:|
| clip1 | 194 | 174 | 184 | 184 | 192 |
| clip2 | 932 | 895 | 905 | 907 | 917 |
| quad1 | 3 | 2 | 3 | 3 | 3 |
| survival1 | 384 | 325 | 350 | 350 | 371 |

The two opaque visible-denominator rules had no observed false positives or wrong accepted rows in any clip. The previous all-GUI mode had 6/5/0/5 false positives respectively. Broadening only the acceptance mask to opaque+item interiors, retaining original row/FOV, also yielded 1,483 correct and 16 false positives, distributed 5/5/0/6. Equal totals do not mean equal frame predictions.

Single-stage controls clarify the source of the gain. With original acceptance and FOV, opaque masking of silhouette alone or raw colour ranking alone stayed at 1,396 correct. Normalizing unmasked colour ranking alone gave 1,397. Candidate-row correctness, irrespective of acceptance, was 1,506/1,513 originally, 1,510 for normalized ranking + opaque acceptance/FOV, and 1,508 for previous full masking. Thus the main improvement here is acceptance of already correctly ranked sprites, not a large repair of sprite identification.

## Interpretation and next validation

Normalize agreement over remaining non-GUI probes: `(matching - mismatching) / usable`. Masked probes are absent from numerator and denominator. The original-denominator neutral control deliberately reduces scores with coverage; it is a conservative comparison, not the preferred normalization. All variants retain at least five usable probes and threshold 0.5; zero usable evidence cannot accept.

The simplest promising integration is opaque masking at acceptance only, leaving the existing silhouette, colour ranking and FOV untouched. Its 46 recoveries account for almost all the 48 gained by the most successful zero-error configuration. That latter configuration was selected on these reused clips and needs a fresh holdout. No new automatic app default was enabled.

More masking is not automatically better: it can remove accidental background mismatches and let a false first-person candidate pass. Separate normalized match quality from evidence sufficiency. Next candidates are spatially distributed support, distinct texture-cell coverage and the best-versus-runner-up margin under the same mask. These are proposals, not measured improvements in this run; they must not silently change the frozen threshold or be described as validated safeguards. Temporal agreement can be tested separately, with cuts respected.

## Reproduction and checks

Run `bench/pov_gui_stages.py` with the local source recordings/assets and release `core/examples/pov_gui_stages` helper, then `--reuse` for cached analysis. Raw diagnostics, metadata, predictions and 360-way reports are private ignored outputs under `.board/pov-gui-stages`; no recordings or game assets are committed. Sampling remains stride 5 for clip1/clip2 and stride 30 for quad1/survival1. Truth joins happen after inference.

- Rust silhouette suite: 26 tests passed; research diagnostics reproduce canonical ranking/evidence and normal calls retain no diagnostic buffers.
- Python combination suite: 7 tests passed, including independent stages, denominator behavior, frozen gate, FOV choice, normalization-only control and zero-evidence handling.
- All owned Rust files pass rustfmt; release research helper builds.
- Normal 900-frame score output retains SHA256 `6BE53450ABAA94F1DC879C5B245F6F4DE7808826CE5F0E639520B7136F3F0D26`.
- Back-to-back normal scan checks under concurrent benchmark load: previous binary 4.777 s, diagnostics-disabled new binary 4.738 s for 900 frames. This is an overhead sanity check, not an isolated performance claim.
