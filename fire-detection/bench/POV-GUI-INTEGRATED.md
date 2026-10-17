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

## Completed results

All1,008 configurations ran on the same13,431 sampled frames, including1,513 overlays and11,918 negatives. They produced92 distinct accepted-label outputs (478 joint candidate-row/acceptance outputs if unaccepted candidates are included). Configurations are highly correlated, not independent validation trials. Candidate extraction used no labels:14/31/0/31 potential additions per clip,76 total. Reused57 spatial records and extracted19 new frames (1/14/0/4); all76 reproduce previous canonical score components/counts at1e-10. The frozen prior spatial rule reproduces its frame-level decisions exactly across the full cohort.

| Method / best observed family result | Correct /1,513 | False positives | Wrong accepted rows |
|---|---:|---:|---:|
| Original | 1,396 | 0 | 0 |
| Previous opaque-only normalized acceptance | 1,442 | 0 | 0 |
| Previous frozen spatial+margin rule | 1,483 | 0 | 0 |
| Best zero-error integrated configuration | 1,483 | 0 | 0 |
| Normalized unmasked colour ranking + visible-score FOV, opaque+interior mask, no extra gate | 1,486 | 24 | 0 |
| Best equal-region+masked-margin gate | 1,481 | 0 | 0 |
| Best FOV-consensus gate with no observed errors | 1,453 | 0 | 0 |
| Best cross-mask row agreement with no observed errors | 1,444 | 0 | 0 |

The best zero-error integration is opaque+unknown-interior masking, original silhouette/colour ranking and FOV, horizontal support span>=2 and canonical masked runner-up margin>=0.5. It gives192/194,917/932,3/3,371/384 correct across the four clips. This ties, rather than improves, the previous broad-mask fixed rule. Original correct decisions remain protected, so no configuration loses an originally correct acceptance. No tested configuration produces a wrong accepted row; presence false positives are the limiting error here.

Normalized colour ranking and FOV can gain3 additional correct acceptances relative to1,483, but their false positives rise to24. Equal-region scoring as an additional acceptance gate removes the false positives but also loses2 recoveries versus the frozen spatial rule. FOV and mask agreement do not reliably distinguish real overlay evidence from coincidentally similar backgrounds. These are measured outcomes on the declared finite grids, not claims that every possible normalization or consensus method fails.

### Transfer check

Three-recording selection requiring zero observed training errors chooses the same spread+margin configuration when excluding clip1,clip2 or quad1; the excluded results are192/0,917/0,3/0 correct/false-positive. Excluding survival selects original ranking-margin>=1, giving369 correct and1 false positive there. Total1,481 correct,1 false positive,0 wrong accepted rows,0 original-correct losses. The broader integration did not resolve the earlier transfer failure. The previous fixed spatial rule remains frozen; no new rule is promoted and no threshold is refined against that survival error.

These clips were already used repeatedly for development. The pooled zero-error result remains exploratory, and the excluded-recording test is not a fresh holdout. The next materially different research directions remain boundary/uncertainty masks, texture-cell weighting and temporal integration; fresh-recording validation is still required before automatic acceptance changes.

## Reproduction and checks

Run `pov_gui_integrated.py` after producing the parent stage/support caches and building the existing release `pov_gui_spatial` helper. Frozen Rust diagnostics are historical inputs with recorded source hashes; fresh sparse diagnostics use the recorded native binary and assets and must match the old canonical components. Joined-truth hashes and values, video size, frame IDs, assets and sparse extraction signatures are verified. Private outputs remain in `.board/pov-gui-integrated` and are not committed.

All24 Python GUI benchmark tests pass, including7 new tests for parity with prior stage combinations, empty-region neutrality, equal-region versus probe pooling, global evidence sufficiency, changed-row error accounting, excluded-label independence and the1,008-configuration contract. The frozen previous spatial rule also passes full-cohort frame-level parity. No production/native source or app default changed in this round.
