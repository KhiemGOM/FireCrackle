# Normalized mask integration coverage and follow-up

Protocol fixed 2026-10-18 before reading this round's results. These are reused development clips, not new validation data. No automatic app behavior changes.

## What the earlier combinations covered

| Dimension | Earlier coverage | Limitation |
|---|---|---|
| Mask coverage | Opaque; opaque+unknown interiors; those+translucent GUI | Binary masks, no edge expansion or uncertainty weights |
| Silhouette | Original vs masked agreement | Existing screen-probe weighting |
| Colour ranking | Original sum; original mean; masked sum; masked visible mean; masked original-denominator control | Global per-row probe pooling |
| Acceptance | Frozen original; original score at selected row; masked score/original count; masked score/visible count | Visible normalization was already tested |
| FOV | Original; maximum visible score; maximum original-denominator score | No joint support-aware FOV choice |
| Support | Counts, margins, spatial spread, selected pairs | Later support tests froze original row/FOV |
| Spatial | Fixed4x4 screen bins; spread and margin gates | Not independent texture cells; sparse diagnostic candidates |

The360 stage configurations,206 support rules and70 spatial rules were separate experiments. They were not one full factorial combining all dimensions. The original-denominator control intentionally lowered scores with masking; the visible-denominator variants did not.

## New fixed round

Combine3 mask coverages ×2 silhouette sources ×4 colour-ranking sources (original/masked, sum/visible mean) ×3 FOV choices (original, highest visible score, highest selected-row ranking margin). Protect the previous original/opaque-only acceptances and their original row; this round changes only additional proposals.

At each selected row/FOV, require visible colour agreement >=0.5 with at least5 probes. Test14 gates: no extra gate; selection-margin thresholds0.5/1/2; canonical masked-margin thresholds0.5/1; agreement with original row; agreement across both FOV rows; agreement across the three masks; selection-margin0.5 plus original-row agreement; selection-margin0.5 plus FOV agreement; masked-margin0.5 plus mask agreement; horizontal support span>=2 plus masked-margin0.5; equal-region mean>=0.5 plus at least2 usable regions and masked-margin0.5. Total72 proposal methods ×14 gates =1,008 configurations. Grids are not refined after results.

The equal-region score averages each nonempty4x4 tile's visible agreement instead of giving every probe equal weight. A tile needs5 usable probes. Missing/masked tiles are omitted, not zeroed or counted as mismatch. This score is an additional gate after global visible agreement; it does not replace candidate generation or claim to test unrestricted region-balanced ranking.

Select the union of all potential extra accepted frames without reading labels. Reuse existing spatial diagnostics, extract only missing frames, and verify all old canonical components on every spatial record. This remains full-cohort evaluation because no frame outside that prediction-defined union can change. Report wrong accepted rows separately now that row/FOV may change.

Choose rules on three recordings requiring zero observed errors/lost originals, then evaluate once on the fourth. The same clips have been inspected previously: call this a transfer check, never a fresh holdout. Also retain the previous fixed spatial+margin rule as a frozen comparison.

## Still outside this round

- Unrestricted region-balanced candidate ranking/acceptance across every frame.
- Texture-cell ownership and independent-cell rather than screen-tile support.
- Soft weights for uncertain GUI pieces or mask dilation/erosion at compression edges.
- Multi-frame agreement, cut-aware temporal fitting, or learned calibration.
- Fresh-recording validation. Additional combinations cannot substitute for new data.
