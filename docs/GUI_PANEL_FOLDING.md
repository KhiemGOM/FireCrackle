# Exact GUI panel families — 21 October 2026

The shared presence/mask detector now folds **94 source profiles into 68 exact
matching families**, removing 26 redundant searches and their geometry plans.
Folding happens once in `InteractionDetector::with_workers`; each frame has
fewer profiles to check and no additional hashing or cached decisions.

## Safety rule and proof

Safety here means unchanged detection and masking behavior for the same input
bank and frame. Existing recognition limitations remain.

The key is built **after** source-template extraction. It compares:

- Width, height, recipe-book shift, horizontal/vertical/viewport placement.
- Every ordered border, structure, presence-fallback and fixed-control probe.
- Exact coordinate bits, RGB, optional blended RGB and occlusion-region group.

Different floating-point bits or probe sequences remain separate. Hash-table
collisions are resolved by full key equality. No colour tolerance, threshold,
visible-support requirement or occlusion rule is relaxed.

For equal keys, `poses` generates the same ordered geometry and `evidence` sees
the same ordered probes, colours, groups, denominators and global stage policy.
Consequently `find` returns the same first supported pose and scores for any
frame and the same current-frame tooltip mask. The old detector chooses the
first supported source in input order. A later equivalent source therefore
cannot win: its earlier equivalent either already won, or an earlier different
source won. Removing the later duplicate preserves the winning original source,
including its type/version/variant metadata. Relative order of retained sources
is unchanged, including the threaded detector's minimum-source selection.
The deterministic neutral-mask merge therefore receives the same bounds,
piece kind and metadata and preserves the same pre-existing HUD pixels.

Type/version/variant strings are omitted only because their effects on probe
extraction are already represented by the key, and the original first source is
retained for output. The original 94 packs and catalogue aliases remain intact;
legacy exact-type APIs still receive the original templates.

## What groups, and what stays separate

Furnace, blast furnace and smoker profiles form one six-entry family across the
1.16.5/1.21.11 source banks. Many unchanged profiles also fold across versions.
Beacon and shulker version pairs share the exact prepared evidence even where
unused source pixels differ. These are detector-profile equivalences.

Each of the six chest row counts remains distinct. Shulker's 167-pixel height
remains distinct from 166-pixel panels. Different work areas, fixed controls,
recipe shifts, placements and evidence layouts remain distinct whenever they
affect the ordered probes or mask geometry.
The complete family/alias inventory is in the JSON manifest.

## Source evidence

The six installed furnace-family RGBA crops were re-extracted from the actual
1.16.5 and 1.21.11 client JARs and match the runtime packs exactly. Full atlas
PNGs need not be identical; the 176×166 rendered base crops are identical.

Minecraft 1.16.5, Yarn 1.16.5+build.10-v2 source methods were re-read:
`GenericContainerScreen` constructor/`drawBackground` use height `114+18*rows`
and the corresponding two texture regions; `AbstractFurnaceScreen.drawBackground`
draws its base rectangle and separate progress overlays; `ShulkerBoxScreen`
increments the inherited panel height. Source-class and texture hashes are in
the manifest. All 90 base packs match the prior source manifest byte-for-byte;
four historical intermediate-artwork packs are preserved unchanged and included
in the exact-key audit. No layout rule or game asset is changed.

## Checks and measurements

**22 targeted tests passed**: exact aliases and first-source retention,
evidence/geometry differences, probe ordering, serial/threaded behavior,
malformed inputs and existing interaction/occlusion cases. Core and native Clippy passed
with warnings denied.

An embedded copy of the unmodified pre-fold detector was compared with the
candidate on **636 recorded frames across 44 screen states** from the two GUI
recordings. Complete detection metadata/scores and every merged class/piece
byte match, including seeded existing HUD evidence. Both paths detect the same
302 frames. This is an equality audit on reused development material, not a new
TP/FP accuracy estimate. The bank also passes exact metadata comparison on the
32 time-spread gameplay controls.

Before/after/after/before measurements, with initialization outside timing:

| Workload | Before | Folded |
| --- | ---: | ---: |
| Panel-only, one worker, 512 frames/pass from 32 controls | 56.5 fps | 71.5 fps |
| Full GUI mask, 12 workers, 1,200 consecutive 1080p frames/pass | 122.6 fps | 138.3 fps |

The GUI workload includes decoding and mask hashing; its full mask hash vectors
match on every frame in all four passes. These are GUI rates, not overall Auto
scan rates. Numbers are weighted by total frames/total seconds across the two
passes per path. Other owner apps remained open; within-run timing drift means
small differences should not be generalized to other machines. Models, shared
unveil, fire decisions and the source bank are unchanged.

The native release build passed in 4m 05s; its executable hash is in the manifest.
The running app is left open so active scans are not interrupted.
