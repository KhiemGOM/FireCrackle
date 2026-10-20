# Deterministic ECC alignment pilot

ECC did **not** beat the current fitter in this pilot. Keep it out of the default matcher and do not silently move corners when Confirm is pressed. This is evidence about the tested masked homography implementation, not every possible use of ECC.

## Fixed real-data comparison

64 ordinary-fire cases from catalogue V06 (`quad1`, 2026-10-16 00-40-22.mkv) and 64 soul-fire cases from V14 (`soul_holdout`, 2026-10-19 23-27-30.mkv). Select one target per frame, sorted by SHA-256 of case ID, without consulting scores. Both cohorts also contain 64 distinct renderer frames. The existing geometry/readability exclusions remain in force. These are familiar research recordings, not fresh independent validation. This is a small pilot, not a universal accuracy estimate; nearby frames remain correlated.

The RGB caches are actual native-resolution video frames with their original shared Rust automatic unveil. There is no new inverse, training, CNN inference or synthetic fire. To simulate manual placement, perturb each recorded corner by a reproducible uniform +/-4% in quad coordinates. All fitters receive the same perturbed geometry and unchanged frame pixels. Exact recorded corners are also tested for unnecessary movement.

| Correct animation phase in top three | Ordinary fire | Soul fire |
|---|---:|---:|
| Fixed rough outline | 30/64 (46.9%) | 35/64 (54.7%) |
| Current production corner fitter | **36/64 (56.2%)** | **39/64 (60.9%)** |
| Standard masked ECC, reject unsafe result | 29/64 (45.3%) | 35/64 (54.7%) |
| Bounded ECC updates | 29/64 (45.3%) | 31/64 (48.4%) |

These rates use rough outlines and the deterministic matcher alone. They must not be compared directly with the released exact-quad CNN ensemble's larger benchmark rates.

## Alignment is distinct from ranking

For the alignment-only test, the renderer-labelled phase, sheet and mirroring are fixed for every fitter. Neither method gets to select another appearance. Classifier ranking uses no truth. Mean corner distance is measured against the recorded plane at native video resolution.

| Mean corner error, pixels | Ordinary fire | Soul fire |
|---|---:|---:|
| Input rough outline | 4.54 | 5.73 |
| Current selected-sprite fitter | 8.71 | 10.95 |
| Standard ECC, with rejected fits retaining input | 4.33 | 5.71 |
| Bounded ECC | 14.46 | 11.97 |

Using a 0.25-pixel change threshold, bounded ECC improved 6/64 normal cases but worsened 25/64; soul improved 1/64 and worsened 15/64. Most standard ECC results stayed unchanged because they failed or exceeded the permitted outline. Standard ECC improved 6/64 rough normal cases and 1/64 rough soul cases, worsened none by more than 0.25px, and left the remaining cases within 0.25px of the starting error. However, it also moved 3/64 already exact normal cases and 1/64 already exact soul case by more than 0.25px. Bounded ECC unnecessarily moved 23/64 already exact normal cases and 18/64 already exact soul cases. Score improvement is therefore not sufficient evidence of correct corner alignment. The current fitter can help phase ranking while still producing worse physical corners; keep all geometry changes reviewable.

## Implementation and accounting

- Compile the current production TypeScript scorer/fitter directly using Node 24's type stripping; do not port its colour rules. All 32 fixed-quad phase scores match the existing frozen research controls **exactly on all 128 cases**.
- Enumerate the same 128 appearances and rank three distinct animation phases. Ordinary/soul colour scoring uses their existing material-specific settings. Normalize the local texture assets once, respecting the already-normalized soul research cache.
- ECC uses OpenCV 4.13.0.92 `findTransformECCWithMask`, 128px rectification, grayscale, opaque sprite mask plus the production fire-colour input mask, homography, blur 3, 60 iterations and epsilon 1e-5. Template transparency is excluded; background is not painted as negative evidence.
- Standard ECC is rejected on non-convergence, invalid geometry or leaving the same 120% corner envelope as the production optimizer. Rejected fits remain in the denominator and retain the input quad. Normal: 8,099/8,192 appearance fits rejected; soul: 8,013/8,192.
- The bounded variant projects each of 30 single-step updates into that envelope and retains the best encountered correlation. It is an explicitly different constrained experiment, not unmodified OpenCV ECC. Normal: 1,474/8,192 fits rejected; soul: 3,172/8,192. Final returned corners are independently validated too: OpenCV can return a zero coordinate at a projective pole; one such extra invalid fit was rejected. Exact/rough coordinate round trips match the production pixel-centre convention within 0.001 native pixel.
- Every ECC proposal is finally rescored by the existing production colour score. Equal/worse proposals retain the original geometry. No ECC correlation is treated as a fire/phase probability.
- Serial selected-sprite timing on eight cases per material, median of three repeats: ordinary current 16.8ms / standard ECC 6.9ms / bounded 26.6ms; soul current 24.5ms / standard 4.9ms / bounded 11.7ms. Timing excludes decoding/masking and is a small local CPU sample. Frequent early failures make standard ECC's speed misleading. Each full-search ECC variant used four workers/one OpenCV thread each; the two final variants ran concurrently (eight workers total). Their per-case wall times in results.json include contention and are not single-core comparisons.
- Current full-search baseline calls the production `matchFireQuad` with refinement enabled (160 evaluations per appearance plus fine sampling on six finalists). Selected-sprite baseline uses the same coarse/fine optimizer budgets of 160/120 for its fixed appearance.

Reproduce from the repository root with the existing private RGB caches and local game textures available:

```text
python FireCrackle/scripts/fire-ai/ecc/prepare.py
node FireCrackle/scripts/fire-ai/ecc/compare.mjs baseline
node FireCrackle/scripts/fire-ai/ecc/compare.mjs parity
node FireCrackle/scripts/fire-ai/ecc/compare.mjs selected
python FireCrackle/scripts/fire-ai/ecc/align.py
python FireCrackle/scripts/fire-ai/ecc/align.py --bounded
node FireCrackle/scripts/fire-ai/ecc/compare.mjs score-ecc
node FireCrackle/scripts/fire-ai/ecc/compare.mjs score-ecc-bounded
python FireCrackle/scripts/fire-ai/ecc/timing.py
python FireCrackle/scripts/fire-ai/ecc/report.py
python FireCrackle/scripts/fire-ai/ecc/provenance.py
```

Use `opencv-python-headless==4.13.0.92` in the research Python environment. This adds no OpenCV dependency to the shipped app. Scripts and aggregate results are tracked; pixels, masks, game textures and detailed per-case records remain ignored under `.board/ecc-align`.

Reference: [OpenCV ECC alignment and mask API](https://docs.opencv.org/4.x/dc/d6b/group__video__track.html).
