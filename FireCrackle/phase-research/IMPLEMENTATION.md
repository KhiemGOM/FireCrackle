# Combined phase checker: implemented

Job 11 now connects the combined checker to Session, flag navigation, timeline flags and the Phase tab.
The legacy `phase::analyze` stays unchanged numerically as the benchmark baseline; sessions use
`phase_v2::analyze`.

## Behaviour

- A shared nominal 20 Hz clock continues through holds and gaps. The early circular-median reference
  does not re-anchor at later sightings. The Phase chart shows that reference and receives residuals
  for occupied bins. Fitted rates remain diagnostics in the research reports; no automatic correction.
- PELT supplies the primary timing runs and persistent-change supplements. Existing fine-scale flags
  remain independently present. A separate raw-neighbour check preserves isolated errors even inside
  a recovered excursion, where the old excursion grouper could swallow them.
- Contiguous held animation is assessed using multiple before/after observations against the same
  advancing clock. Elapsed nominal ticks are unwrapped: the 32-step cycle does not cap hold duration.
  A short contradictory label may be bridged using the existing min_run setting, but remains separately
  flagged with an odd-observation explanation.
- Holds report recovered, mismatch or insufficient recovery evidence. Recovered timing never clears
  independent evidence. Rows alone do not establish identical full-frame pixels or identify the cause.
- Hard means a large discrepancy to inspect. It CAN be lag/capture behaviour and proves neither edits
  nor incorrect labels. The historical max_lag_ticks key is retained as the magnitude threshold, with
  corrected help text. Existing benchmark severity calculations remain reproducible.
- No raw optimiser boundary automatically becomes an alert. Across a missing-observation gap, a PELT
  supplement inside the existing allowed timing spread lacks enough extra evidence. Existing flags
  are retained. Whole-cycle ambiguity is accepted.

## Final paired validation

2000 proposed random cuts per recording per seed, with identical exclusions and scoring for current
and combined checkers. Actual alert endpoints are scored, including a newly ended recovered excursion
immediately before a cut. No hidden segmentation boundary is counted as an alert.

| Recording/seed | Current caught | Combined caught | Current flags on uncut data | Combined flags on uncut data |
|---|---:|---:|---:|---:|
| clip1 / 1 | 1744/1869 (93.31%) | 1760/1869 (94.17%) | 22 | 22 |
| clip2 / 1 | 1664/1822 (91.33%) | 1690/1822 (92.76%) | 13 | 13 |
| clip1 / 2 | 1753/1877 (93.39%) | 1775/1877 (94.57%) | 22 | 22 |
| clip2 / 2 | 1669/1820 (91.70%) | 1692/1820 (92.97%) | 13 | 13 |

No cut-size bucket regressed on these paired trials. Small-cut buckets, seed 1:

| Recording | <1 tick: current -> combined | 1-2 ticks: current -> combined |
|---|---:|---:|
| clip1 | 3/83 -> 9/83 | 70/103 -> 78/103 |
| clip2 | 12/100 -> 17/100 | 72/115 -> 79/115 |

Both real 100-second missing-observation controls stay quiet at the matching gap boundary; both detect
an injected five-tick mismatch. The early reference is identical before/after that injection.

Clip2's observed hold is frames 13862-14003, **47 nominal ticks** of elapsed video time. Its post-hold
clock residual differs from the pre-hold centre by **0.167 tick**, supporting recovered timing. Its
two original hard findings remain, now with recovered-hold evidence rather than a claim of bad labels.
The vanilla-source/capture explanation remains in ../docs/PHASE-EVIDENCE.md E9.

The four `clip*-combined-seed*.json` reports contain complete settings, per-bucket counts, all baseline
flags, combined explanations, lag intervals and matching/mismatching gap controls. These are two
development recordings, not proof of performance on unseen footage. No confidence or causal claim is
inferred from cut recall or unchanged clean alert counts.

## Settings

All eight new controls are exposed under **Clock and recovery** in Settings, documented and saved:
bin_seconds (.5 s), penalty_ticks2 (5), anchor_bins (8), held_seconds (.25 s), held_max_gap_seconds
(.1 s), recovery_samples (6 per side), recovery_ticks (.75), supplement_min_ticks (.75). The existing
phase.min_shift_ticks can raise the supplemental floor, so the default effective floor is one tick.
Existing settings files load missing controls from defaults.

## Checks and test-first history

- Full `studio_core` test suite passed, with real FFmpeg video integration tests enabled.
- Native Tauri `cargo check --offline` passed.
- Frontend tests: 200 passed at the first full run; final count may also include independent HUD work.
- TypeScript and production Vite build passed. Browser mock verified neutral hard/soft tooltips and
  Phase header wording; Rust chart tests verify actual combined metadata. The browser mock does not
  execute the Rust algorithm, and no live user project was relabelled for visual testing.
- Ten combined-checker tests cover empty/clean/single frames, wrong row/sheet, legacy evidence
  retention, deduplication, recovery beyond a cycle, unknown/non-recovery, long gaps, settings, sparse
  gap noise, and short incorrect labels inside a recovered hold. Existing comparison tests retain the
  exhaustive circular PELT oracle.

The initial eight combined tests, settings-key specification, Phase chart metadata test and UI wording
tests were run red before implementation. Two additional fixtures (sparse-gap noise and interrupted
hold recovery) were added and run red before their fixes. No new expected outcome was changed after
implementation. Existing config/workspace settings-count expectations were mechanically expanded
for the eight approved controls. Final combined test SHA-256:
`f15a94dbcf67c009b468cc158917628eed23bd31a475b7d224529b4ddc3f23e2`.

Reproduce using the commands in RESULTS.md and select the `Combined` entry in the report. Use FFmpeg
with libx264 for the existing video-generation tests. Build outputs and a locally cached test-tool copy
are under ignored target directories and are not part of the source change.
