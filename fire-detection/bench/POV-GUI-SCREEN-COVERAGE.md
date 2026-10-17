# GUI screen coverage and false-subtitle regression

2026-10-18. Follow-up to `POV-DUAL-VEIL.md`; reused development recordings, not a fresh holdout.

## Fixed comparison

Compare against the previous best 1,491/1,513 correct acceptances with zero observed no-fire false positives, wrong accepted rows or lost reference matches. Reuse all 13,431 sampled frames, including 11,918 negatives. Keep matcher rules, color thresholds, veil inverse, sample schedule and labels fixed. No temporal evidence enters matching.

V2 records fresh native outputs separately in `.board/pov-dual-veil-v2`. V1 caches remain intact. Capture metadata hashes the native executable, inference sources, assets, videos and truth. The analyzer checks unmasked row parity against the historical parent and records acceptance changes caused by the stricter GUI text detector. Its new/lost counts compare against the V1 best, not the older 1,483 reference.

The same six veil schedules and four eligible-branch policies are evaluated with and without screen surfaces. A branch must qualify independently before selection. Two branches do not constitute a majority vote. Conditional work estimates do not measure end-to-end scanner speed.

## Screen changes

- Options: include the real secondary settings-grid rows, separated from the first row by 54 GUI pixels. Require a texture-confirmed button cluster, rather than masking every candidate location.
- Inventory: retain full-template confirmation; additionally allow one obscured border only with six of eight half-edges, three supported sides, at least 70% overall agreement and 80% internal-separator agreement. This is a conservative quorum, not learned occlusion ownership.
- Recipe book: after independent inventory confirmation, check the adjacent 147×166 wide-layout panel against its own local texture. Category tabs, narrow layouts and other containers are not covered. The optional texture is extracted locally and excluded from Git.
- All screen surfaces remain neutral exclusions, including dynamic contents. They do not contribute positive or negative fire evidence. These surfaces remain opt-in research preprocessing, not the default app screen detector.

## Screenshot failure

Clip2 frame 10,416 reproduces the reported red stripes at the app's 1280×720 JPEG resolution. The HUD fit is correct: scale 1 and GUI dimensions 1280×720. The erroneous piece is `Subtitle`: orange flame plateaus happen to lie at its legal centered height and imitate quarter-color shadow pairs. This is a classification failure, not a display-coordinate offset.

The canonical title/subtitle detector now requires at least four supported glyph rows and a centered parse against the local Minecraft font atlas, using the existing font parser and mismatch limits. Missing font data means abstaining from title/subtitle masking. The app loads that existing font atlas, and the status line now names Title and Subtitle hits instead of silently omitting them.

The exact reported frame no longer receives a Subtitle mask. A synthetic flame-edge regression failed before the fix and passes afterward; a genuine orange title/subtitle control also passes, so colored text is not simply prohibited. Scaled-title, subtitle, action-bar and caption tests remain covered.

## Validation

Completed targeted checks: 131 core tests, 42 Python benchmark tests, 11 app-side GUI tests and 9 frontend GUI-status tests. Rust formatting passes on changed Rust files.

Reproduction: build the `pov_dual_veil` release example, run `pov_dual_veil.py --cache-version v2`, then `--cache-version v2 --reuse` to analyze completed caches. Optional recipe coverage needs the local vanilla 1.16.5 `assets/minecraft/textures/gui/recipe_book.png`, decoded to 256×256 RGBA bytes at `data/assets/gui/recipe_book.rgba`. Missing optional data disables recipe coverage; it does not guess a panel. The measured run includes that asset and records its hash.

The recording experiment measures downstream fire decisions. It does not provide dense GUI-mask ground truth on every recording frame, so zero fire false positives must not be presented as proof of zero GUI-mask false positives.

## Completed results

All 13,431 frames completed: 1,513 positives and 11,918 negatives. The new masks with the retained 0.03 detector-distance schedule accept **1,496/1,513 (98.9%)**, recover five and lose none of the V1 best's correct matches. There are zero observed no-fire false positives or wrong accepted rows. All original-HUD automatic row/acceptance decisions remain unchanged on the sampled cohort; the exact screenshot frame 10,416 is a separate regression check, outside clip2's five-frame sampling stride.

| Method | Correct | New vs V1 best | Lost vs V1 best | Alternate branch frames |
|---|---:|---:|---:|---:|
| V1 best, retained reference | 1,491 | 0 | 0 | 435 |
| V2 masks, automatic veil only | 1,494 | 5 | 2 | 0 |
| V2 masks, distance 0.01 | 1,495 | 5 | 1 | 135 |
| V2 masks, distance 0.03 | **1,496** | **5** | **0** | **435** |
| V2 masks, distance 0.05 | 1,496 | 5 | 0 | 782 |
| V2 masks, distance 0.10 | 1,496 | 5 | 0 | 1,764 |
| V2 masks, always both | 1,496 | 5 | 0 | 13,431 |

Every row in this table has zero observed false positives and wrong accepted rows. Automatic-only loses the same two previously recovered veil mistakes; its net gain does not make it a no-regression replacement for the retained dual-branch rule. The 0.03 schedule evaluates the alternate on 3.24% of frames, a branch-count estimate rather than an end-to-end speed claim.

| Recording | V1 best | V2 retained rule | New correct frame IDs |
|---|---:|---:|---|
| clip1 | 193/194 | 193/194 | — |
| clip2 | 919/932 | 922/932 | 14580, 14585, 14590 |
| quad1 | 3/3 | 3/3 | — |
| survival1 | 376/384 | 378/384 | 80280, 80310 |

All three options-screen misses are recovered. Two recipe-book cases are recovered; two other recipe-open failures remain despite confirmed inventory and recipe panels. Screen surfaces are detected on 6 clip1, 267 clip2, 8 quad1 and 181 survival frames. Detection counts alone are not acceptance or accuracy metrics.

The maximum-eligible-evidence, no-conflicting-row and automatic-priority policies still agree at the retained schedule; there are no two-eligible-branch row conflicts. This data does not establish a best conflict policy. Requiring both branches to agree everywhere again rejects every positive.

Excluding each recording from schedule selection yields 1,495 correct in total, with zero false positives/wrong rows, five gains and one lost reference match. The clip1-excluded selection chooses width 0.01 and misses its veil-recovery frame; the other folds choose 0.03. This is reused-recording development transfer, not independent validation. Do not promote the whole opt-in screen extension as proven safe from these clips alone.

## Remaining 17 misses

- clip1: 23260 (correct candidate, weak color evidence).
- clip2: 5905, 5920, 6000, 6015, 6050, 6105, 14350, 14355 (pause-menu cases); 9745, 15025 (gameplay).
- survival1: 6240, 10380, 45240 (inventory not confirmed); 45210 (inventory confirmed); 80580, 80640 (inventory and recipe panel confirmed).

The relaxed border quorum passes its synthetic one-obscured-edge control but does not recover the three unconfirmed real inventory cases. It therefore has no demonstrated incremental accuracy gain here. Correctly masking buttons also does not solve the eight remaining pause-menu failures. Missing panel coverage and remaining matcher errors are distinct issues; no acceptance threshold was lowered to hide them.

## Capture evidence

The analyzer, native executable, inference-source, asset and cache hashes were checked against the completed metadata after capture. Analysis SHA-256: `ad4a822fb8106b282958be5b53e326b4746f6ca8d9045bd38dac89f39d08bd1a`.

| Cache | SHA-256 |
|---|---|
| clip1 | `605eb9be0c7b39ecca82bc795c16034e0cc908ff253a9262d76eccd6f974e472` |
| clip2 | `4c53d5f193f9500a5f5986754d31fcec026b6e33ca5b353939fe1df7604a26e8` |
| quad1 | `7205e7f678fa80044d09df2091957396b437e4449f459d2ac1b1100477facb13` |
| survival1 | `8c837c9395fe880abc088ab00b1a5ae8bc9a8d74bdb5ec8dd587b0f87ed5bc4a` |
