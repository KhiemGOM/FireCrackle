# ECC after the sprite is already selected and fitted

This is a separate follow-up to the phase-ranking experiment. **Standard ECC is potentially useful as a conservative optional final-polish helper.** It changes only corners; phase, sheet and mirroring are locked. The more aggressive bounded variant is unsuitable on this pilot.

Use the same 128 real cases, catalogue V06 ordinary fire and V14 soul fire, 64 each. Start from the current selected-sprite fitter's result, not the rough outline. The supplied sprite is the renderer-correct appearance, representing a user who already knows the sprite. This does not measure behavior after an incorrect sprite selection. RGB and shared unveil are unchanged; there is no phase search, AI inference or training.

The follow-up rebuilds the production colour mask around the current fitted quad. ECC proposes a homography for that one appearance. Retain the previous convergence/geometry checks, then shorten any proposed corner movement to at most half the smallest projected texel. Evaluate before/after correlation on exactly the same intersection of valid opaque sprite/fire-mask pixels; require at least 1,024 canvas pixels and correlation gain greater than 0.005. Failed or unhelpful fits keep the current quad. These are fixed exploratory settings, not calibrated safety guarantees. The previous colour-score acceptance gate is deliberately absent: it would favor the score that the current fitter has already maximized.

| Final adjustment after current fit | Ordinary fire | Soul fire |
|---|---:|---:|
| Standard ECC accepted | 6/64 | 1/64 |
| Geometry improved by >0.25 native pixel | 6/64 | 1/64 |
| Geometry worsened by >0.25 native pixel | 0/64 | 0/64 |
| Unchanged | 58/64 | 63/64 |
| Mean corner error before | 8.71 px | 10.95 px |
| Mean corner error after | 8.62 px | 10.94 px |
| Median serial time, including proposal/validation | 24.9 ms | 7.7 ms |

The improvement is small and uncommon: 7/128 useful adjustments. In a separate control using the same 128 cases starting from exact recorded corners, this standard final-polish policy left **all 128 unchanged**. Zero observed harmful changes in these familiar recordings is not proof of universal safety.

For comparison, the bounded variant accepted 52/128 fitted cases, improved 20 but worsened 21 by >0.25px. It also unnecessarily moved 48/128 exact-corner controls. Do not combine it into the conservative helper based on higher coverage alone.

Recommendation: an optional **Refine alignment** preview with Undo, keeping the chosen sprite fixed. Do not use these results to replace the matcher or silently adjust corners when Confirm is pressed. An unchanged result should simply mean that a useful safe adjustment was not found. No app integration or shipping dependency was added by this experiment.

Reproduce after the original pilot caches exist:

```text
node FireCrackle/scripts/fire-ai/ecc/polish.mjs
python FireCrackle/scripts/fire-ai/ecc/polish.py
python FireCrackle/scripts/fire-ai/ecc/polish.py --exact
```

Detailed per-case outputs/masks stay in ignored `.board/ecc-polish`; `polish-results.json` contains only plans, source hashes and aggregate measurements. These familiar two-recording cohorts remain a pilot, not fresh independent validation. See [the original comparison](README.md) for source coverage, preprocessing and software versions.
