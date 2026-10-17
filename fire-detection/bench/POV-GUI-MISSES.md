# Audit of the 30 remaining first-person fire misses

2026-10-18. Development recordings reused from the GUI-mask experiments. Frozen reference: original and opaque-only acceptance protected, otherwise broad GUI-neutral colour evidence >=0.5, row margin >=0.5 and horizontal support span >=2. Reference result: 1,483/1,513 correct, no observed false positives or accepted wrong rows.

## What actually blocks acceptance

All **30** misses fail the colour-evidence threshold for the reference candidate. **23** already select the correct sprite; **7** select another sprite and abstain. None is rejected solely by the added row-margin or spatial-spread checks. Lowering those checks therefore cannot solve these misses.

| Visually inspected group | Frames | Correct candidate / wrong candidate |
|---|---:|---:|
| Darkened pause/options/inventory screens | 25 | 21 / 4 |
| Gameplay with an unexpected automatic veil correction | 2 | 1 / 1 |
| Other gameplay, no automatic correction | 3 | 1 / 2 |

These are descriptions of observed frames, not proof that every menu miss has the same cause. Screens, compression and background colour can affect the same frame together. The mod's visibility/veil metadata is diagnostic only and never chooses a prediction.

## Causal On/Off check

The same RGB frames were evaluated with shared Rust veil correction enabled and disabled. Their automatic-branch outputs reproduce the original cached FOV winners and evidence at 1e-8 on all 30 frames, checking the image seeks against exact indexed diagnostics.

| Frame | Automatic branch | True-row broad evidence with correction | Without correction |
|---|---|---:|---:|
| clip1:29070, true row15 | Correction on; chooses row13 | -1.000 | 0.963; chooses row15 |
| survival1:14640, true row13 | Correction on; chooses row13 | -0.998 | 0.924; chooses row13 |

This directly supports testing alternative veil hypotheses. It does **not** validate automatically accepting whichever branch scores better: no-fire frames must also be tested. Two hypotheses alone cannot form a majority when they disagree.

The 25 menu frames have true-row broad evidence ranging from -0.386 to0.487 under the automatically chosen FOV. GUI fit is reliable on all30 misses, but the old detector's piece list contains HUD elements, not inventory panels or menu buttons. Existing GUI masks therefore do not establish that these screen surfaces were excluded.

## Per-frame reference audit

`pov_gui_miss_audit.py` reproduces the diagnostic JSON and optional contact sheets in ignored `.board/pov-gui-misses`. It joins exact frame IDs, records all four original GUI-coverage stages at each FOV, and enumerates which previously measured proposal variants can score the true row above threshold. Truth is used for auditing only.

- clip1:23260,29070.
- clip2:5905,5920,6000,6015,6050,6105,9745,14350,14355,14580,14585,14590,14670,14675,15025.
- survival1:6240,10200,10260,10290,10350,10380,14640,45210,45240,80280,80310,80580,80640.
- quad1 has no remaining positive misses in this sampled cohort (only3 positive samples).

The three uncorrected gameplay misses are clip1:23260 (correct row, evidence0.484), clip2:9745 and15025 (wrong raw-ranking row11). Existing normalized-ranking alternatives can recover the latter two; permissive variants elsewhere have produced false positives in prior experiments. This audit is not a new accuracy claim for those variants.

## Follow-up requested by the owner

Test explicit neutral exclusion of inventory panels and pause/options buttons, independently from veil correction. `gui_mask::add_screen_masks` is an opt-in extension in the canonical GUI implementation; it confirms texture borders at the existing hotbar-derived GUI scale. It marks detected surfaces unknown, including variable items/player previews/text. It does not erase image pixels, undo tint, or infer absence of fire.

Initial synthetic checks cover normal/recipe-shifted inventory, arbitrary preview contents, multi-button confirmation, duplicate width hypotheses and abstention without confirmed texture/scale. This first implementation does not promise complete screen coverage: the recipe-book extension itself is not modelled, unusual menus are not covered, and an obscured confirmation border can cause abstention. Existing production `detect_gui` behavior remains unchanged until validation.

The paired full-cohort experiment and negative controls are reported separately in `POV-DUAL-VEIL.md` when complete. Do not promote findings from these 30 selected positive errors alone.
