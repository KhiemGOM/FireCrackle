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
