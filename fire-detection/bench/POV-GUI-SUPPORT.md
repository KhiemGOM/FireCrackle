# GUI-neutral evidence support follow-up

Protocol fixed before inspecting support-gate results, 2026-10-18.

Keep the original row/FOV, and preserve the original and opaque-only normalized acceptance decisions. Test additional acceptance from the broader GUI mask only when visible colour evidence is at least 0.5 and a support/distinctiveness gate passes. GUI-excluded pixels do not enter the numerator or denominator. This is first-person overlay sprite matching, not world-fire detection.

Use cached canonical diagnostics from the previous four-clip experiment. No inference/preprocessing changes, no new assets, no video decoding. Validate source/asset/truth/sampling signatures and prior decision parity. The cache has probe counts and row scores, but no probe coordinates: this experiment cannot measure spatial spread or independent texture-cell coverage.

Fixed gate families: usable probe count, matching probe count, original combined-score margin, masked combined-score margin, masked normalized colour margin, original colour agreement, visible colour agreement, original silhouette z-score. Test each alone plus usable-count/original-margin, usable-count/masked-margin, original-agreement/original-margin and original-agreement/masked-margin pairs. Exact finite grids live in `pov_gui_support.py`; do not refine them after seeing results.

Report pooled and per-clip accepted-correct/false-positive/wrong-row/lost-correct counts. Also select a rule on three recordings requiring zero observed errors, then evaluate it on the excluded recording. Selection never reads that recording's labels. All recordings have been inspected in earlier research, so this is a transfer check, not a fresh independent holdout or a guarantee of zero errors. Adjacent sampled frames are correlated.

App defaults stay unchanged. If these cheap gates cannot transfer, record that result before collecting more spatial diagnostics or trying temporal rules.

## Sparse spatial protocol

After the score-margin experiment, inspect every broad-mask acceptance that opaque-only acceptance would reject. Candidate selection reads predictions, not labels. No other frame can change under this additional gate, so sparse extraction still permits full-cohort evaluation. Recompute all canonical components on every candidate and require parity with its previous cached results.

Research diagnostics count usable and matching probes in a fixed 4x4 screen grid. A supported tile needs at least five matches and visible agreement `(2*hits-used)/used >= 0.5`. Fixed rules: at least 1 through 8 supported tiles; horizontal span 1 through 4 columns; vertical span 1 through 4 rows; or support on both screen halves. Test these alone and paired with masked combined-score margins 0, 0.5, 1. Original and opaque-only decisions remain accepted. Screen tiles are not independent texture cells, and masks do not become negative evidence. Apply the same three-recording selection and excluded-recording check; do not refine the grid afterward.

## Results

The unchanged cohort is 13,431 sampled frames: 1,513 overlays and 11,918 negatives. The 206 support/margin rules yield 40 distinct acceptance outputs; the 70 spatial rules yield 24. These are correlated exploratory comparisons.

| Rule | Correct accepted / 1,513 | Presence false positives | Wrong accepted rows | Recovered / lost vs original |
|---|---:|---:|---:|---:|
| Original | 1,396 (92.3%) | 0 | 0 | 0 / 0 |
| Opaque-only normalized acceptance | 1,442 (95.3%) | 0 | 0 | 46 / 0 |
| Broad GUI normalized acceptance | 1,483 (98.0%) | 16 | 0 | 87 / 0 |
| Broad additions require masked combined margin >=1 | 1,481 (97.9%) | 0 | 0 | 85 / 0 |
| Broad additions require supported tiles spanning >=2 columns AND masked margin >=0.5 | 1,483 (98.0%) | 0 | 0 | 87 / 0 |

The final fixed rule gives 192/194, 917/932, 3/3 and 371/384 correct across clip1, clip2, quad1 and survival1 respectively, with no observed false positives in any clip. Requiring support on both screen halves with the same margin gives identical acceptance outputs here. These two spatial rules were selected after inspecting the pooled results, not independently validated.

Spatial extraction covers exactly 57 additional candidates selected without labels: 13/17/0/27 per clip. All original and opaque-only decisions remain protected; other frames cannot change under these gates. Recomputed canonical silhouette/colour components, probe counts, GUI reliability and veil decisions match the previous cache on all 57 candidates (score tolerance 1e-10). Workers complete asynchronously; frame IDs, not output order, join results.

### What helped and what failed

- Minimum usable/matching probe counts up to160 did not remove any false positives. The problematic frames have many correlated probes, not just tiny samples.
- Spatial spread alone also failed: horizontal spread >=2 or support on both halves retained all recoveries but left13 false positives. At least3 supported tiles left12 false positives and lost1 recovery.
- The masked runner-up margin is useful because it asks whether the same remaining pattern distinguishes this row from alternatives. A pooled margin of1 removes16 false positives but sacrifices2 recoveries. Combining a weaker margin of0.5 with spatial spread keeps those2 as well.
- The spatial condition rejects a survival false positive with masked margin about0.60 whose matching support occupies one screen column. The margin condition rejects the broad, netherrack-like false matches that have spatial spread but masked margins below0.5.
- Masking remains normalized over visible probes. Gate failure means insufficient or ambiguous pattern evidence; missing GUI regions are not counted as mismatches.

### Transfer check: not yet a shipping guarantee

For each fold, select the most correct rule with zero observed training false positives/wrong rows/lost correct on three recordings; break ties by fewer conditions then fixed enumeration order. Evaluate once on the excluded recording. Rule selection never reads excluded-recording labels.

| Excluded clip | Score-gate selected rule | Correct / false positives | Spatial selected rule | Correct / false positives |
|---|---|---:|---|---:|
| clip1 | masked margin >=1 | 192 / 0 | horizontal span >=2, masked margin >=0.5 | 192 / 0 |
| clip2 | masked margin >=1 | 917 / 0 | >=3 supported tiles, masked margin >=0.5 | 916 / 0 |
| quad1 | masked margin >=1 | 3 / 0 | horizontal span >=2, masked margin >=0.5 | 3 / 0 |
| survival1 | original margin >=1 | 369 / 1 | >=1 supported tile, masked margin >=0.5 | 371 / 1 |

Out-of-fold totals: score-gate selection 1,481 correct and1 false positive; spatial selection 1,482 correct and1 false positive. Both retain all originally correct results and have no wrong accepted rows. The survival fold demonstrates why zero errors after pooled selection cannot justify enabling automatic acceptance. Earlier research already inspected all these recordings, so even this transfer check is not fresh validation. Freeze the combined spatial/margin rule for evaluation on a new recording before shipping; do not tune again against this survival error. No app default changed.

## Reproduction and checks

- Generate the parent canonical caches with `pov_gui_stages.py` (see `POV-GUI-STAGES.md`). Run `pov_gui_support.py` for strict current-source checking. After adding the research-only spatial fields, `--historical-cache` explicitly analyzes the frozen earlier Rust diagnostics, recording their source hashes; GUI assets, truth and sampling checks remain active. It does not silently declare earlier source versions equivalent.
- Build the release `pov_gui_spatial` example, then run `pov_gui_spatial.py`. Sparse cache metadata ties results to the native binary, inference source, assets, frame manifest and parent metadata. Every selected frame also undergoes canonical numerical parity checking. Private caches/results remain under `.board/pov-gui-support` and are not committed.
- 17 Python GUI benchmark tests pass, including normalization, empty evidence, baseline preservation, held-out label independence and spatial support. The Rust silhouette suite passes26 tests, including bin-total reconstruction and normal/diagnostic parity.
- Owned Rust files pass rustfmt; release spatial helper and normal scanner build. The normal900-frame score output remains SHA256 `6BE53450ABAA94F1DC879C5B245F6F4DE7808826CE5F0E639520B7136F3F0D26`. Spatial buffers are allocated only by the opt-in research diagnostics.
