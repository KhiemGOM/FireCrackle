# Known-quad matcher: coherent brightness evidence

2026-10-17. This development change concerns the manually outlined fire-quad matcher, not the first-person detector or Jolt analysis. It is not in the already published 0.2.0 packages.

## Change

The previous matcher compared each sampled colour's G/R and B/R ratios independently. Consequently, a wrong sprite could explain each observed texel with a different brightness gain. The new score requires supporting samples to agree on a shared gain. This uses the texture's flat-colour texels and their brightness pattern while allowing uniform darkening.

The candidate-independent fire-colour mask still runs first. Four interior probes per texel remain, with capped weight for probes sharing a native video pixel. The score is the maximum of a fixed bank of nonnegative, additive gain hypotheses: unknown, transparent and mismatching samples contribute zero. There is no division by observed support and no negative evidence. Adding independent supporting samples cannot dilute existing evidence. Support and region counts describe samples supporting the winning gain, rather than samples scattered across incompatible gains.

Gain uses log2(R observed / R template), quantized at 12 bins per stop. A triangular window of half-width 0.12 stops gives the centre bin weight 1 and its immediate neighbours weight 1 - (1/12)/0.12. Fixed hypothesis centres cover gains 1/16 through approximately 2.52. This is a shared lighting constraint, not a calibrated probability or a simulation of video compression.

## Protocol and tuning

Same native 1920x1080 recording and actual per-quad geometry as [the earlier evaluation](ACTUAL-QUAD-RESULTS.md): 818 tuning quads before frame 4136, a 240-frame separation, and 310 validation quads from frame 4376 onward. No old bounding boxes were used. The temporal validation segment was reused from earlier research; it is not a new unseen recording. Its 310 quads come from only 28 frames and are correlated.

The tuning segment contains 814 block quads and 4 overlay quads, no entity quads. High recorded visibility does not imply a plane is free of overlapping fire. A conservative geometry/alpha overlap diagnostic also failed to isolate a substantial clean single-face set; absence of a competing recorded footprint does not certify visible pixels.

On tuning data, the unchanged fixed matcher identifies 40/818 exactly. Gain windows 0.12, 0.25, 0.5 and 1 stop were explored. The exploratory implementation ranked 45, 44, 43 and 43 correctly; within-texel pair-consistency bonuses ranked 41-43 and were rejected. The selected 0.12-stop histogram implementation was frozen before validation. Its stable bin-index arithmetic ranks 43/818 correctly; the exploratory floating-point centre arithmetic changed near-tied rankings. The implementation was not retuned after validation.

## Fixed supplied geometry: validation

Exact means sheet, row and mirror all correct. The existing uncalibrated status gate is unchanged.

| Metric | Previous | Shared-gain score |
|---|---:|---:|
| Exact top 1 | 78/310 | 87/310 |
| Exact in top 3 | 94/310 | 102/310 |
| Results passing the status gate | 63 | 61 |
| Correct gate passes | 43 | 41 |
| Wrong gate passes | 20 | 20 |
| Entity exact top 1 | 73/181 | 83/181 |
| Block exact top 1 | 5/129 | 4/129 |

Eleven exact predictions improved and two regressed. All new exact successes are entity cases. Block overlap remains an unresolved failure, and the gate is still unsuitable for automatic acceptance. In particular, fewer correct results pass the gate despite improved ranking. No absence dataset was tested, so this does not establish a fire-presence false-positive rate.

Fixed evaluation took 3.87 seconds before and 4.10 seconds after in separate local runs; these timings are descriptive, not a controlled performance claim. Every paired prediction, including abstentions and wrong passes, is retained in [known-quad-results.csv](known-quad-results.csv).

## Adjustable geometry regression checks

The optimizer and its 120% envelope are unchanged. These runs use the same frozen scoring implementation; no parameters were changed after the fixed-quad validation.

| Input / mode | Previous exact top 1 | New exact top 1 | Previous / new wrong gate passes |
|---|---:|---:|---:|
| Accurate outlines, adjustment enabled | 66/310 | 80/310 | 33 / 29 |
| Deliberately rough paired subset | 9/39 | 8/39 | 4 / 5 |

For accurate outlines, top 3 improved 83 to 94 and correct gate passes improved 33 to 34. For rough outlines, top 3 stayed at 11 and correct gate passes improved 4 to 5, but the additional wrong pass and reduced exact top 1 remain regressions. The archived previous runs are described in the earlier report; their matching logic is unchanged apart from unrelated explicit atlas exclusions. Full new fitting took 321 seconds and the rough run 28 seconds locally. This is not a claim of a consistently better rough-quad optimizer or a reliable acceptance gate.

## Reproduction

From the repository root:

```
node FireCrackle/scripts/actual-quad-eval.mjs FireCrackle/src-tauri/target/actual-quad1 validation current-baseline fixed 1 --source-ref a150b22
node FireCrackle/scripts/actual-quad-eval.mjs FireCrackle/src-tauri/target/actual-quad1 validation coherent-gain fixed 1
```

The ignored native frames and manifest remain under `src-tauri/target/actual-quad1`; preparation is documented in the earlier report. Joined-label SHA-256: `c3a39b59346ae4030e45099ebabd1bfc9d2b4e8a722341e5ca881ae8999147a0`. Frozen evaluated matcher SHA-256: `510a675c7b665722d319d5fc9411e7f738e1a23df6a90acc6496db9e62014d7c`. Detailed reports retain source hashes and all candidates. Exploratory scripts and overlap diagnostics remain locally under `.board/quad-research`.

Regression coverage includes equal-chromaticity sprites with different texel brightness patterns under uniform darkening, positive-only monotonic evidence, occlusion, native-pixel vote caps, fixed/refined geometry, filters and ambiguity.

Validation: 19 focused matcher/mask/optimizer tests passed; the full working frontend passed 612 tests across 69 files and its TypeScript/Vite production build. Concurrent veil and phase changes were present in that full-suite run but are outside this change. No native executable was rebuilt or release package changed.
