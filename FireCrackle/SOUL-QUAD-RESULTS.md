# Soul fire known-quad matching

19 October 2026. Research only; application scoring and automatic labelling are unchanged.

## Result

**Updated size/shape scope:** at the owner's request, new benchmark runs default
to fully on-screen quads with at least 3 output pixels per texture texel in the
most compressed direction and local directional stretch at most 2.5. On this
subset the tuning-selected soul method gets **13/115 exact (11.3%)**, with the
correct row on45/115 (39.1%). The existing normal-fire scorer gets **47/99 exact
(47.5%)** on its older recording under the identical geometry rule:45/79 entities
(57.0%) and2/20 blocks (10.0%). Soul here is all blocks. These are different
recordings, so the block comparison does not prove equivalent generalization.

The historical all-quad results below are retained for traceability.

The new recording and soul labels synchronize correctly. Reusing the fire scorer
with a cyan colour basis improves ranking, but none of the tested methods is
ready for automatic soul labels. The tuning-selected three-times colour tolerance
gets 39/802 exact appearances (4.9%) and 171/802 rows (21.3%) in temporal validation.
It gets only 10 correct versus 45 wrong results through the existing status gate.
Zero gate passes from the narrow baseline mean abstention, not perfect accuracy.

## Recording and split

- Video: `fire-detection/data/video/2026-10-19 16-49-48.mkv`, 164.55 seconds,
  1920x1080, 60 fps. Minecraft labels report a 2560x1440 framebuffer: this recording
  was already scaled to 75% before evaluation. No additional resizing or encoding
  is applied. Quad coordinates are scaled from the recorded framebuffer dimensions.
- All 9,870 video frames decode, match a label, and have matching ticks.
  No undecodable/unmatched frames or decreasing IDs; 2,926 repeated rendered IDs.
  These OBS repeats are not independent observations.
- Raw label snapshot: `.board/soul-quad/recording-labels.jsonl`. Decoder output:
  `.board/soul-quad/joined.jsonl`. The new `soul_fires` collection is used;
  ordinary `fires` cannot silently become soul truth.
- Freeze before scoring: stride60 video frames; tuning `n < 5880`, validation
  `n >= 6120`, separated by 240 video frames. Repeated rendered IDs are deduplicated.
  Projection checks reuse `prepare-actual-quad-eval.py::canonical_quad`.
- 2,103 tuning quads from 59 frames; 802 validation quads from 27 frames.
  All are block fire, with overlapping faces retained. The sampled truth covers
  33 sheet/row combinations in tuning and 26 in validation, not every appearance.
  Whole-session capture covers all 64 combinations, but is not all in this video.
- Rejected geometry: 107 back-facing/small and3 missing projections. Eligible
  recorded cases stay in the denominators even if the app cannot rank them.
- Shared automatic unveil is applied via `veil_native.py`, with the original
  Rust source hashes recorded. It triggers on one sampled tuning frame (1440,
  11 quads) and no sampled validation frame. No second inverse or GUI oracle is used.
- Soul sheet0 physical PNG rows are reordered by16 to match the app's shared
  animation step. Recorded targets receive the same conversion, exactly once.
  Sheet, row and mirror truth are used only after classification, never as input
  filters, clock guesses, geometry adjustments or sample masks.

## Methods and results

All methods search128 appearances on fixed supplied corners. Exact means sheet,
normalized row and mirror all correct; row-only ignores sheet/mirror. Top3 is exact.

The first ten methods were evaluated on tuning first, then frozen before their
validation. Three-times tolerance won their tuning exact-ranking comparison.
The final four boundary methods were added after these first validation results
were visible. Their tuning precedes their own validation, but those are secondary
diagnostics on the same reused segment, not a fresh blind holdout.

| Method | Tune exact /2103 | Validation exact /802 | Validation top3 | Correct row /802 | Correct / wrong gate passes |
|---|---:|---:|---:|---:|---:|
| Unchanged fire colour basis |28|7|19|56|0 /0|
| Blue basis, shared gain .12 stops |52|15|37|98|0 /0|
| Green basis, shared gain .12 stops |53|16|36|101|0 /0|
| Blue basis, independent gain evidence |35|12|30|77|0 /0|
| Blue basis, gain window .25 stops |46|18|37|99|0 /0|
| Blue basis, gain window .5 stops |48|18|33|103|0 /0|
| Blue basis, gain window1 stop |39|16|33|93|0 /0|
| Blue basis, within-texel consistency |44|17|31|85|0 /0|
| Green basis, colour tolerance2x |111|38|55|165|6 /40|
| Green basis, colour tolerance3x |118|39|62|171|10 /45|
| Green basis, weak boundary .25 |52|17|37|102|0 /0|
| Green basis, boundary1 |51|17|35|103|0 /0|
| Green basis, gradient1 |53|16|36|100|0 /0|
| Green basis, facing1 |52|18|35|101|0 /0|

Blue basis permutes RGB to BGR; green basis to GBR, in both observed image and
known templates. The production red-pivot score then uses a stronger soul channel
without copying its sampling or masking implementation. The raw baseline still
receives the soul palette, but retains the fire-specific ratio/gain rules.

The .12-stop score, four probes per texel, native-pixel weight caps, positive-only
votes and fixed denominator come directly from production. Alternatives change
only the named hypothesis. Tolerances2x/3x widen scoring ratios from .06/.10 to
.12/.20 or .18/.30; their candidate-independent palette mask is unchanged.
Independent gain aggregates positive gain bins; within-texel consistency weights
probes by agreement within .2 stops. These are research variants, not exact claims
of byte parity with every historical exploratory implementation.

Boundary, gradient and facing functions are imported unchanged from
`boundary-robust-eval.mjs`, including actual native-pixel IDs to prevent aliased
adjacent samples from inventing independent edges. These were promising fire
runners-up. They give at most two additional exact matches over green here.
Their scores also have no calibrated acceptance gate.

Individual validation outcomes for all14 methods are retained in
`soul-quad-results.csv`. Detailed top3 predictions, status, source hashes, quad
geometry and timing remain under ignored `.board/soul-quad/real/`.

## Interpretation and speed

These are appearance-matching errors on known-fire quads, not no-fire
false-positive rates. No negative/no-fire regions were evaluated. Of the55
three-times-tolerance gate passes,45 are wrong (81.8%); do not use that gate to
auto-confirm. The selected method's exact result is still only29/353 on validation
quads whose four edges are all at least32 output pixels, or18/171 at64 pixels.
Small projected size alone does not explain the failures.

Many recorded planes overlap other fire planes, and high recorded visibility is
not a dense proof of target-plane ownership. Diagnostic crops show such overlaps;
this is a plausible contributor, not a demonstrated explanation for every error.
Do not remove failed cases on that basis. There is no entity or isolated-plane
generalization claim, and this is one temporally correlated recording.

In the primary validation run, fixed green scoring took1.26 ms/quad plus7.12 ms
for its palette mask/sampling, averaged over all802 cases. Three-times tolerance
took1.80 ms scoring plus the same shared mask work. These exclude frame I/O,
decode/unveil, channel conversion and geometry fitting, and are descriptive CPU
timings rather than a playback or GPU benchmark. Boundary features add cost and
are cached between variants; incremental method timings are not standalone speeds.

Recommendation: keep the application unchanged. The recording is useful for
future target-plane ownership and colour/lighting diagnostics; ranking improvements
here do not justify automatic confirmation or a claimed solved soul matcher.

## Large, non-squashed quads: requested scope

The geometry cutoff was declared before inspecting its selected prediction counts.
It uses only recorded geometry and output resolution: all four corners inside the
frame, a projective Jacobian sampled on a33x33 grid covering texture-cell corners
and centres, minimum singular scale >=3 output pixels per texel, maximum singular
scale/minimum <=2.5. This checks diagonal compression as well as edge length.
It does not inspect sprite identity, outcomes, distance labels or colour scores.
It is a sampled geometric readability proxy, not proof that compression preserves
every colour boundary. Overlap/occlusion are not silently removed.

| Recorded material / scorer | Readable quads | Exact correct | Correct row | Correct / wrong gate passes |
|---|---:|---:|---:|---:|
| Normal fire, preceding independent-gain scorer |99 (18 frames)|41 (41.4%)|47|27 /8|
| Normal fire, established shared-gain scorer |99 (18 frames)|47 (47.5%)|53|26 /8|
| Normal fire blocks, established scorer |20 (5 frames)|2 (10.0%)|6|0 /8|
| Normal fire entities, established scorer |79 (16 frames)|45 (57.0%)|47|26 /0|
| Soul fire, unchanged colour basis |115 (13 frames)|3 (2.6%)|24|0 /0|
| Soul fire, green basis |115 (13 frames)|6 (5.2%)|34|0 /0|
| Soul fire, tuning-selected3x tolerance |115 (13 frames)|13 (11.3%)|45|3 /21|

The normal-fire source is the original Quad1 validation recording; it is not a
normal-fire measurement from the new soul video. The earlier7/802 number applies
the unadapted normal-fire scorer to soul textures/pixels. It is not the scorer's
accuracy on normal fire. The unfiltered normal-fire historical result is87/310
(28.1%), or78/310 (25.2%) before shared gain.

All14 soul variants were rerun on the115 selected cases. Each prediction matches
the corresponding cached all-quad prediction; only the denominator changes.
Six targeted geometry controls pass: adequate square, small square, diagonal
squash with long edges, rotation invariance, extreme stretch, clipping/degeneracy.
Production-adapter parity again passes on12 nonzero scores. The gate is still
unsuitable:21 of24 selected-method passes are wrong. No scorer was retuned on
this subset. The selected IDs, geometric scales and complete per-method summaries
are retained in `.board/soul-quad/size-audit.json`.

New default output is `readable-scores-SPLIT.json`; historical all-quad output is
only recreated with explicit `--all-quads`. To audit the same subset on both
recordings without rerunning inference:

```text
node FireCrackle/scripts/soul-quad-size-audit.mjs .board/soul-quad/real FireCrackle/src-tauri/target/actual-quad1 .board/soul-quad/size-audit.json
node --test FireCrackle/scripts/soul-quad-size-audit.test.mjs
```

## Reproduction and checks

From repository root, after decoding with the matching label log:

```text
python FireCrackle/scripts/prepare-soul-quad-eval.py VIDEO JOINED .board/soul-quad/real --ffmpeg FFMPEG --stride 60 --tune-end 5880 --validation-start 6120
node FireCrackle/scripts/soul-quad-eval.mjs .board/soul-quad/real tune --all-quads
node FireCrackle/scripts/soul-quad-eval.mjs .board/soul-quad/real tune green,tolerant,loose --tag tolerance --verify --all-quads
node FireCrackle/scripts/soul-quad-eval.mjs .board/soul-quad/real validation raw,blue,green,ratio,wide025,wide05,wide1,pair,tolerant,loose --verify --all-quads
node FireCrackle/scripts/soul-quad-eval.mjs .board/soul-quad/real tune green,boundary025,boundary1,gradient1,facing1 --tag boundary --verify --all-quads
node FireCrackle/scripts/soul-quad-eval.mjs .board/soul-quad/real validation green,boundary025,boundary1,gradient1,facing1 --tag boundary --verify --all-quads
```

Local Minecraft textures are loaded
from the ignored atlas directory; frames, textures and caches are never committed.

Six existing projection/normalization tests and nine existing boundary controls
pass. The `--verify` adapter checks12 nonzero baseline predictions against the
actual production `matchFireQuad(..., {refineGeometry:false})`, including exact
score, selected appearance, margin and status. This passes in primary validation
and the boundary runs. Tuning and validation production source hashes match.
Python parsing and Node syntax checks pass; no application build was needed.

Corpus manifest SHA256:
`04dea1eb91c161cb2a6e8a2441aacba5fd6a933dd44c3880e4d7db8483aff404`.
Production matcher SHA256:
`510a675c7b665722d319d5fc9411e7f738e1a23df6a90acc6496db9e62014d7c`.
Existing boundary research SHA256:
`e09b2e82ba9b751ed7da8f771c48cf5ff393d036b4aaad88cfc8ded6884ff8de`.
