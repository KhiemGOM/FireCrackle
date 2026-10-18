# Joint clocks for Minecraft animated textures

Research pass, 18 October 2026. Scope: vanilla Java Minecraft 1.16.5, Yarn
1.16.5+build.10. This proposes a joint analysis and chart design; it does not change
the shipped detector or establish accuracy on newly labelled water/lava footage.

Different texture periods can constrain one hidden **executed atlas tick**. The
useful addition is a joint feasible-state/path check, rather than averaging
different circular phases or running the fire checker on more rows. It supplies
two distinct certificates: no shared clock state in one game image, or no shared
progression between images under declared timing/reload assumptions.

## Verified Minecraft behaviour

Checked against the local vanilla `minecraft-client.jar` and the mapped source
archive under `fire-detection/mod/.gradle/loom-cache/minecraftMaven/`, using the
project's configured version. No game sources or assets are reproduced here.
The companion probe reads the installed JAR and prints hashes of the metadata.

| Texture | Physical tiles | Sequence positions | Ticks per position | Full period in ticks | Nominal seconds |
|---|---:|---:|---:|---:|---:|
| Fire and soul fire, either sheet | 32 | 32 | 1 | 32 | 1.6 |
| Still water | 32 | 32 | 2 | 64 | 3.2 |
| Flowing water | 32 | 32 | 1 | 32 | 1.6 |
| Flowing lava | 16 | 16 | 3 | 48 | 2.4 |
| Still lava | 20 | 38 | 2 | 76 | 3.8 |
| Nether portal sprite | 32 | 32 | 1 | 32 | 1.6 |

The seconds column assumes 20 executed atlas ticks per real second, not a
guarantee about video timestamps during holds, tick loss or speed changes.

Still lava's sequence is `0,1,...,19,18,...,1`. It is **not** a 20-step forward
cycle and not a 40-step ping-pong cycle: neither endpoint is duplicated.
`fire_0` and `soul_fire_0` use the 16-row rotation; their sheet-1 companions use
identity order. All nine inspected metadata files leave interpolation off.

Relevant source locations in the inspected archive:

- `Sprite.java:36-41,43-94,244-265`: a new sprite starts with sequence index and
  within-position ticks zero; elapsed ticks advance through metadata positions.
  Displayed tile is a lookup through that sequence. The metadata reader defaults
  duration to one and interpolation to false (`AnimationResourceMetadataReader.java:17-51`).
- `MinecraftClient.java:302,1022-1024,1479-1482`: nominal client rate 20 Hz;
  at most ten client ticks per game render; animated textures tick while a world
  exists. The texture tick is outside the pause gate. The ten-tick limit is not
  a bound between recorded pictures: see [PHASE-EVIDENCE E9](../PHASE-EVIDENCE.md).
- `TextureManager.java:142-146` and `SpriteAtlasTexture.java:261-275`: the block
  atlas updates every animated sprite on the same tick, without visibility tests.
  Looking away, spawning a new block or loading a chunk does not start its own
  animation clock. `FluidRenderer.java:35-39` selects shared atlas sprites for fluids.
- `SpriteAtlasTexture.java:57-80,283-289`: atlas upload replaces sprite objects,
  uploads their starting images and rebuilds the animated list. Model a reload
  as a shared new epoch, not arbitrary independent offsets per texture.

**Initialization exception:** `Sprite.java:230-231` implements the initial
`upload()` by uploading **physical tile 0**, not the first metadata sequence
entry. Thus freshly rebuilt `fire_0` / `soul_fire_0` initially show row 0, even
though metadata position 0 corresponds to row 16. Their first atlas tick moves
to position 1 and uploads row 17. The periodic formulas apply after that first
tick; an atlas reconstruction needs one additional bootstrap state. The initial
all-tile-zero display must not produce a hard contradiction. This refines the
reset description in PHASE-EVIDENCE E5; it does not change the established
steady-state 16-row sheet offset. Out of world, that bootstrap state may persist.

These are client texture animations. Fluid simulation speed, server TPS and world
time are different mechanisms. Switching between a still and a flowing surface
can change which sprite is drawn; material identity therefore belongs in label
uncertainty. Packs, shaders and animation-changing mods require a different model.

## What the literature contributes

The existing baseline is [PLAN-PHASE-V2](../PLAN-PHASE-V2.md) and its
[paired benchmark](RESULTS.md): fixed-clock residuals, circular PELT and PCID,
with capture holds and long-gap ambiguity retained. This pass adds joint modular
constraints; it does not replace those independent anomaly checks.

1. [Xia and Wang, Phase Unwrapping and a Robust Chinese Remainder Theorem](https://www.eecis.udel.edu/~xxia/RobustCRT.pdf),
   IEEE SPL 2007: a small error in a remainder can cause a large reconstructed
   wrap error. Transfer: never turn a best-fitting noisy residue into a certain
   long-range tick. Their radar assumptions are not evidence about this footage.
2. [Xiao, Xia and Wang, Multi-Stage Robust CRT](https://arxiv.org/abs/1303.3251),
   IEEE TSP 2014: handles more general non-coprime moduli and grouping. Transfer:
   use the least common multiple, not the product, and keep error bounds explicit.
   The familiar quarter-gcd sufficient guarantee has hypotheses; it is not a
   universal Minecraft tolerance. Our row labels are sets, sometimes disconnected,
   not noisy point residues. In particular, the global gcd here is only four.
   Dividing by four gives 8,16,12,19, which are not pairwise coprime; the special-case
   quarter-gcd bound therefore cannot simply be imported as this app's guarantee.
3. [Allgeier et al., Robust phase unwrapping based on non-coprime fringe pattern periods](https://publikationen.bibliothek.kit.edu/1000096445/113522975),
   SPIE 2019, Sections 2.2-2.3: distinguishes allowed and forbidden phase pairs and
   displays their structure in a matrix. This directly motivates the proposed
   compatibility chart. Transfer the constraint geometry, **not** automatic
   correction of the user's labels or their optical measurement accuracy.
4. [Xiao, Xia and Huo, Towards Robustness in Residue Number Systems](https://arxiv.org/abs/1602.03115),
   IEEE TSP 2017: reconstruction range and robustness trade off. Transfer: restrict
   candidate wraps using justified local timing evidence, rather than always
   selecting a unique solution across the entire joint period.
5. [Alur and Dill, A Theory of Timed Automata](https://www.cis.upenn.edu/~alur/TCS94.pdf),
   1994: state transitions with timing constraints and reachability/emptiness.
   Transfer: a discrepancy certificate is an empty set of allowed paths. Our
   small, discrete atlas model can use straightforward dynamic programming; it
   does not require implementing a general timed-automata solver.
6. [Killick et al., PELT](https://arxiv.org/abs/1101.1438) and
   [Loizidou et al., PCID](https://arxiv.org/html/2603.10772v1) remain relevant to
   segmenting changes and ranking sustained departures. Their statistical
   detections do not certify impossible joint sprite states. A new joint segment
   cost would need its own pruning proof; the old circular PELT proof does not
   automatically carry over.

## Observation model

Let `N` count executed block-atlas ticks since the current atlas epoch. Each
material has a known periodic lookup `F_i(N)` from a tick to a displayed tile.
Handle the pre-first-tick bootstrap state above separately.
For a labelled tile `r`, retain the entire inverse set:

    A_i(r) = { n modulo P_i : F_i(n) = r }

Examples:

- Canonical fire step `r`: `A(r)={r}` modulo 32. For sheet 0 first use
  canonical step `(displayed_row - 16) modulo 32`.
- Still water row `r`: `{2r,2r+1}` modulo 64.
- Flowing lava row `r`: `{3r,3r+1,3r+2}` modulo 48.
- Still lava row `r`, for `1 <= r <= 18`:
  `{2r,2r+1,76-2r,77-2r}` modulo 76. Endpoints 0 and 19 have just one
  two-tick interval each. Direction and within-row dwell are genuine hidden states.

Ambiguous visual labels union these sets. Missing textures add no constraint.
Do not collapse dwell to its midpoint or choose a lava direction before evidence
resolves it. Normalising each row to an angle and averaging mixes different
frequencies; it has no shared-clock interpretation.

For co-observed materials, lift their sets to the common period `L` and intersect:

    C_frame = { n in [0,L) : F_i(n) is an allowed observed tile for every i }

For exact point residues, CRT compatibility is equality modulo the pair's gcd.
For interval/set observations, search the alternatives; a scalar CRT formula
alone is insufficient. Exact enumeration over only 3,648 states is a practical
reference oracle. A packed candidate mask is 456 bytes before indexing overhead.

The shared epoch follows from the verified atlas implementation. Do not separately
fit a free phase origin for each material: doing so erases the cross-material
contradictions we are trying to detect. If shared initialization is unknown,
record that uncertainty and weaken the result accordingly.

## Charts beyond overlaid offsets and rows against time

### 1. All-material clock compatibility timeline

One time axis with a joint status strip: feasible, ambiguous, inconsistent, or
no observation. Display `|C_frame|` and the number of contributing independent
periods; unknown/missing evidence must not look like agreement. Clicking a time
opens a material-by-material agreement matrix and a small conflicting subset of
the actual observations. This combines every material into one meaningful result.

The matrix is an explanation, not the final test. With uncertain labels, all
pairs can intersect while the complete intersection is empty: sets `{0,1}`,
`{1,2}` and `{0,2}` are the simplest counterexample. For these four particular
vanilla maps with **exact** rows, exhaustive enumeration found no such counterexample
among 327,680 tuples; that is a finite check, not a theorem for future uncertainty models.

### 2. Allowed-state phase portrait

Put one material's phase/tile on each axis and shade combinations that can share
an atlas tick. Overlay actual observations; forbidden cells make a hard conflict
visible immediately. This is a row-versus-row constraint view, not a row/time
chart. A linked matrix of pair portraits can show all materials at once. Retain
both lava branches; a raw lava row axis avoids pretending its direction was measured.

Fire versus still water has only 64 allowed cells out of 1,024. Fire versus
flowing lava has 96 out of 512; fire versus still lava has 320 out of 640.
These counts describe exact constraint geometry, **not** false-positive or cheat
detection rates. Modelling the full vector as a path on a product of circles
(a torus) is mathematically natural, but a spinning 3D torus is a poor default
review interface: important branches and contradictions can be hidden.

### 3. Shared advance chart across a selected interval

Horizontal axis: possible executed-tick advance, not wrapped phase. Each material
contributes a row of permitted advances; a final row shows their joint solution.
Overlay the permitted nominal-time/lag interval and show the minimum advance
required by all observations. This makes incompatible choices of cycle count
visible without pretending that each individual unwrap was uniquely determined.
It also works across sparse gaps and can recommend which extra label would
remove the most remaining alternatives.

Recommended order: compatibility timeline and exact candidate engine first;
phase-pair portrait for explanation; interval advance view for detailed gap review.
Keep the existing individual flags alongside these new joint ones.

## Two stronger joint flags

### Same-image clock contradiction

Canonical fire step 0 requires `N=0 modulo 32`. Still water row 4 requires
`N in {8,9} modulo 64`. There is no shared `N`, even with unlimited elapsed time.
This can be flagged without using video time or a 20 Hz rate assumption.

A whole-frame capture hold, ordinary common catch-up, or server lag cannot fix
that combination in one fully captured vanilla game render. A label/material
mistake, modified assets/animation or a torn/composited image remain possible
explanations. The certificate is **incompatible with one vanilla atlas clock**,
not a verdict that somebody cheated.

### Joint advance contradiction

Synthetic, exactly enumerated example, with row order fire / still water / flowing lava:

    first image:  (0,0,0)
    second image: (0,0,5)
    declared allowed advance: 0..40 executed ticks

Every separate animation can fit that interval:

| Material | Standalone possible advances within the interval |
|---|---|
| Fire | 0, 32 |
| Still water | 0, 1 |
| Flowing lava | 13, 14, 15, 16, 17 |

Together the first image fixes age 0 modulo 192; the second fixes age 64 modulo
192. At least **64 ticks** are needed, so there is no joint path within 0..40.
This demonstrates extra detection power beyond independent pass/fail checks.
The value 40 is a synthetic declared bound, **not** a universal vanilla/video cap.

Temporal hard flags require an explicit model of capture lag, tick loss and
possible reloads. The game-render ten-tick cap cannot supply that bound for
recorded samples. Unlimited unknown capture delay prevents an unconditional
temporal speed-impossibility claim. The app may still use its current hard
severity for a strong timing discrepancy, including lag, but should expose the
different reason and assumptions rather than label it mathematical impossibility.

## Longer periods and remaining ambiguity

| Co-observed periods | Joint repeat in ticks | Nominal seconds |
|---|---:|---:|
| Fire + still water | 64 | 3.2 |
| Fire + flowing lava | 96 | 4.8 |
| Fire + still lava | 608 | 30.4 |
| Fire + still water + still lava | 1,216 | 60.8 |
| Fire + still water + flowing lava + still lava | 3,648 | 182.4 |

These are least common multiples, not products. Extra 32-tick materials improve
coverage/checking but do not extend the modular range. Under an unchanged epoch,
an exact 32-tick cut is invisible to fire alone but generally visible to the longer
periods. An exact 3,648-tick shift preserves every listed animation state.

The joint repeat is **not** a promise of unique recovery within that interval.
There are 1,920 distinct exact row tuples in 3,648 ticks: 192 tuples have one
candidate tick and 1,728 have two. Example: ticks 18 and 210 both display
`(18,9,6,9)` for fire/water/flowing lava/still lava. Two ticks later the still-lava
rows are 10 versus 8, resolving that example's direction ambiguity. Keep multiple
paths until such evidence arrives; a single best-looking unwrap is insufficient.

## Detector design for a future implementation

1. Give observations material, displayed tile candidates, video frame identity,
   timestamp uncertainty and atlas/version identity. Mirror and geometric
   nuisance choices remain attached to the observation.
2. Precompute exact inverse sets from the same metadata used for the picker.
   Intersect all labels belonging to one source image. Produce a minimal
   conflicting subset if none survive; do not silently replace a label.
3. Propagate the surviving clock states across time with integer wrap branches
   and allowed advances. Retain a full path set: adjacent pair feasibility alone
   need not establish one path through the entire sequence.
4. Model holds/recovery and shared reloads explicitly. A new epoch restarts the
   metadata schedules together. Gaps alone are not evidence of holds or reloads.
5. Hard contradiction means every allowed label/dwell/direction/path alternative
   is ruled out under the displayed assumptions. Otherwise retain a soft
   disagreement score or an ambiguous status. Statistical thresholds affect
   ranking, not exact model feasibility.
6. A probabilistic/HMM likelihood over these states can rank noisy alternatives;
   it must not hide candidate branches or convert low likelihood into a proof.
   Do not multiply correlated duplicate frames as independent evidence.

Validation should include the two certificates above, the 18/210 ambiguity,
32-tick versus 3,648-tick cuts, alternate lava direction, two/three-tick dwell,
uncertain rows, missing materials, a shared reload, out-of-world gating, and
the initial physical-tile-zero bootstrap state before the first tick, plus
the measured long capture hold from E9. First verify material mappings against
instrumented captures that log actual atlas steps and within-frame counters.
No new real-clip recall/false-positive numbers are claimed by this research pass.

## Reproduce the mathematical examples

Run `joint_modular_probe.py` with the local client JAR using Python 3.10 or newer.
It verifies metadata, CRT compatibility, all exact row tuples and the synthetic
counterexamples. `--jar` overrides the standard Gradle-cache location; optional
`--plot path.png` renders the explanatory figure with Matplotlib. Its output
contains metadata hashes and derived numbers, never assets or decompiled source.
