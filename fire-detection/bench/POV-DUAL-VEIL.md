# Veil hypotheses and menu-surface masking

2026-10-18. Reused four-recording development cohort. This protocol evaluates both canonical correction hypotheses without changing veil detection or inverse arithmetic.

## Fixed protocol

- Each sampled frame is decoded once. Shared Rust `veil::detect_pixels` returns its automatic branch, range-compatible share and configured threshold. The GUI is fitted once and reused for correction On/Off. Native matcher diagnostics use the same sparse shared inverse as production.
- Compare original HUD exclusions with an opt-in extension for texture-confirmed inventory panels and pause/options buttons. The latter marks the surface unknown, including variable contents; it never treats those pixels as fire-positive or fire-negative. No full-screen tint or world pixels are masked simply because a menu might be open.
- Each hypothesis uses the frozen best rule: choose FOV60/70 by original per-frame evidence; preserve original or opaque-only acceptance; otherwise require broad-mask evidence>=0.5, margin>=0.5 and horizontal spread>=2. Original-mask automatic predictions must reproduce the previous cached rows and acceptances exactly on every scored frame.
- Test both hypotheses always, or only when the detector's compatible-pixel share lies within0,0.01,0.03,0.05,0.10 of its configured threshold. This proximity is an **uncalibrated threshold-distance heuristic**, not a probability or a guarantee that the detector is correct. It can miss confidently wrong decisions. It is independent of sprite-matching confidence.
- Four fixed combination policies: highest evidence among eligible hypotheses; accept a sole eligible hypothesis but abstain on conflicting rows; require two eligible agreeing hypotheses; preserve an eligible automatic hypothesis and otherwise use the eligible alternate. Exact evidence ties retain the automatic choice. With only two hypotheses a disagreement has no majority vote.
- Each branch must qualify before cross-hypothesis selection. A higher score from an ineligible branch cannot win. No temporal filtering, interpolation, true tick counters, menu truth or fire labels enter the decisions.
- Six schedules×four combination policies×two masks=48 comparisons, including duplicated baseline outcomes. Report correct acceptances, no-fire false positives, wrong sprite rows, recovered/lost correct decisions, conflicts and per-recording results. Development transfer selection excludes the test recording from error filtering and ranking; all recordings were used in prior research, so this is not independent validation.
- Capture all branch outputs for every frame, including confident detector outcomes and no-fire frames. Conditional schedules are evaluated afterward using only detector output. Branch-count savings and costs inferred from these paired timings are estimates; the benchmark does not measure conditional scanner wall time. GUI fitting and video decoding remain costs even when the alternate hypothesis is skipped.

## Menu-mask scope

The optional canonical `gui_mask::add_screen_masks` requires a reliable hotbar-derived scale. Inventory confirmation uses fixed texture bevels/separators, excluding localized labels, items and player preview from confirmation. Button confirmation checks four independent edges from the real widgets texture and requires at least three non-overlapping buttons over two rows. Overlapping width hypotheses are resolved by border agreement. Surfaces stay `Unknown`, rather than claiming every pixel inside a panel is opaque.

This version covers the standard176×166 inventory body, including its recipe-open shifted position, and confirmed pause-menu buttons. Options-screen candidates are present, but the inspected options screen is not detected: its secondary button rows differ from the initial candidate layout. It does not model the recipe-book extension itself, every settings screen, or menus whose borders are obscured. No hotbar confirmation means no screen mask. The extension is opt-in and is not called by production `detect_gui`.

## Reproduction

Build `pov_dual_veil`, then run `pov_dual_veil.py`. `--reuse` evaluates completed caches; independent `--sources` groups can capture concurrently, and a final all-source `--reuse` writes the authoritative combined report. Sources/assets/native executable/video/truth hashes are recorded with each capture. Local assets, frames, binaries and caches remain ignored.

The interrupted first capture used opaque-plus-item masking for its protected branch, differing from the historical opaque-only baseline. Its parity check exposed five premature acceptances before completion. That incomplete file is retained as an ignored control and is not included in this experiment. The corrected capture explicitly reproduces the frozen opaque-only rule.

## Completed results

All13,431 sampled frames completed, including1,513 positives and11,918 negatives. Original-mask automatic predictions exactly reproduce the old frozen rows and acceptances on every scored frame. No temporal evidence was used.

| Method | Correct /1,513 | False positives | Wrong accepted rows | Lost reference matches |
|---|---:|---:|---:|---:|
| Frozen best reference | 1,483 | 0 | 0 | 0 |
| Old GUI mask + always evaluate both veil hypotheses | 1,485 | 0 | 0 | 0 |
| Added screen surfaces + automatic veil only | 1,489 | 0 | 0 | 0 |
| Added screen surfaces + always both | **1,491** | **0** | **0** | **0** |
| Added screen surfaces + both only within0.03 of detector threshold | **1,491** | **0** | **0** | **0** |

The maximum-eligible-evidence, no-conflicting-row and automatic-priority policies produce the same correct labels here. There are **no frames with two eligible branches proposing different rows** in this cohort, so it cannot establish which conflict policy generalizes better. Requiring both branches to accept the same row rejects every positive when run on every frame: the physically inappropriate correction usually fails the colour test. Two-hypothesis consensus is not useful on these data.

| Recording | Reference | Screen mask + automatic veil | Screen mask + both hypotheses |
|---|---:|---:|---:|
| clip1 | 192/194 | 192/194 | 193/194 |
| clip2 | 917/932 | 919/932 | 919/932 |
| quad1 | 3/3 | 3/3 | 3/3 |
| survival1 | 371/384 | 375/384 | 376/384 |

All rows above have zero observed false positives or wrong accepted rows in the corresponding full-source checks. The eight recovered frames are clip1:29070; clip2:14670,14675; survival1:10200,10260,10290,10350,14640. Six are inventory-mask recoveries; two are automatic veil misclassifications recovered by the uncorrected hypothesis. No pause-button recovery occurs in these eight: the confirmed buttons in the inspected pause frames are largely above the fire evidence. The options layout gap remains; do not describe it as already solved.

## Detector uncertainty and computation

These results use the maximum-eligible-evidence policy. Masking screen surfaces contributes its six gains at every schedule, including when no alternate branch runs.

| Distance to detector threshold | Frames running alternate /13,431 | Correct with old mask | Correct with added screens |
|---|---:|---:|---:|
| 0 (no exact threshold cases here) | 0 | 1,483 | 1,489 |
| 0.01 | 135 (1.01%) | 1,484 | 1,490 |
| 0.03 | **435 (3.24%)** | **1,485** | **1,491** |
| 0.05 | 782 (5.82%) | 1,485 | 1,491 |
| 0.10 | 1,764 (13.13%) | 1,485 | 1,491 |
| Always both | 13,431 (100%) | 1,485 | 1,491 |

The0.03 schedule keeps all observed dual-branch gains while skipping96.76% of *additional* branch evaluations. Total branch count is1.0324× automatic-only, rather than2×. This is **not a96.76% scanner speedup**: GUI detection and decoding remain, and these numbers are post-hoc branch-count estimates from a capture that actually computed all branches.

The two rescued false-veil decisions had range-compatible shares0.9287892583 and0.9039603403 against the canonical0.90 threshold. Both lie inside0.03; the first lies outside0.01. This explains the observed difference, but does not imply confidently wrong veil decisions cannot exist elsewhere. The threshold-distance heuristic is not calibrated uncertainty.

## Development transfer check and limits

Choose a zero-error, zero-loss configuration using three recordings, breaking equal-recall ties by fewer alternate-branch calls. On excluded recordings, the screen-mask experiment totals **1,490 correct,0 errors and0 losses**; the old-mask dual-veil experiment totals1,484. When clip1 is excluded, the training recordings select width0.01, missing its width0.03-dependent recovery. The other excluded-source selections use0.03. These reused-recording checks support seven of the eight gains through this selection procedure, but are not fresh holdout validation.

No production scan behavior or app defaults changed. The new screen detector is opt-in. It has known coverage gaps for options, recipe-book extensions and obscured borders; no hotbar confirmation means it abstains. Zero observed errors on reused recordings is evidence for another validation pass, not a no-false-positive guarantee.

## Checks

- 125 targeted Rust GUI/text/action-bar/caption/screen/matcher/veil tests pass, including4 new screen tests. Existing default GUI behavior remains unchanged.
- 42 Python tests pass, including6 new dual-hypothesis eligibility, exact tie, conflict, consensus, original/opaque protection and excluded-recording-selection checks.
- Native research builds and Rust formatting pass. All13,431 original-mask automatic predictions reproduce the frozen reference. The30-frame image-seek counterfactual audit reproduces cached FOV/evidence at1e-8.
- The final `--reuse` report records source/assets/native/video/truth hashes per capture and analysis/cache hashes. The incomplete opaque-plus-items control and the historical20-frame pilot are excluded. No local game assets, recordings, cached frames or binaries are committed.
