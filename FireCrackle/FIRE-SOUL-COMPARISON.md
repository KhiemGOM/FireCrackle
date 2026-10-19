# Orange versus soul-fire quad audit

19 October 2026. Diagnostic re-evaluation of existing native recordings; no app
or matcher changes. Earlier aggregate figures did not compare the same source
types. They should not be described as a demonstrated cyan-specific collapse.

## Same readable-quad criterion

Full frame, >=3 native output pixels per sprite texel in the minimum local
singular direction, local anisotropy <=2.5. No outcome-based exclusions.
Exact means sheet, row and mirror all correct.

| Data | Quads / frames | Exact | Correct row | Median minimum pixels/texel |
|---|---:|---:|---:|---:|
| Old orange, all sources |99 /18|47 (47.5%)|53|5.55|
| Old orange, entities |79 /16|45 (57.0%)|47|5.52|
| Old orange, blocks |20 /5|2 (10.0%)|6|6.00|
| New soul, blocks |115 /13|13 (11.3%)|45|4.53|

Orange uses its established RGB narrow-tolerance scorer; soul uses its previously
tuning-selected green-basis loose scorer. These remain different recordings,
not paired evidence that colour makes no difference. The20 orange block cases
come from only5 frames. Soul has no corresponding entity subgroup.

The disparity remains absent in a descriptive size breakdown of block quads:

| Minimum native pixels/texel | Orange exact /cases | Soul exact /cases |
|---|---:|---:|
|3 to <5|0 /6|6 /65|
|5 to <8|1 /9|4 /38|
|>=8|1 /5|3 /12|

These small correlated groups cannot establish equivalence. They do show that
the old data did not have high exact accuracy on large block planes either.

## Recolour verified locally

Compared all32 row shifts and both mirrors for every sheet pairing. With the
historical orange asset layout and normalized soul layout:

- Orange sheet0 physical row r matches soul sheet1 row r: all8192 binary-alpha
  texels agree. All4492 opaque occurrences obey one deterministic RGB recolour.
  The424 observed orange colours map to336 cyan colours;86 cyan colours merge
  multiple distinct orange colours.
- Orange sheet1 row r matches normalized soul sheet0 row r+16 modulo32: all8192
  alpha texels agree. All4723 opaque occurrences obey one deterministic RGB
  recolour. The431 orange colours map to336 cyan colours;93 cyan colours merge
  multiple orange colours.

Thus the owner's recolour description is correct. The silhouette/patterns are
preserved after sheet/row correspondence; the colour mapping is many-to-one.
That loss of some RGB distinctions is measured, but its contribution to real
matching errors is not isolated by these different recordings.

A separate direct check against the local Minecraft1.16.5 client jar confirmed
the normal RGBA assets equal its physical PNG pixels, and prepared soul assets
equal its animation-ordered pixels. The historical orange benchmark targets use
physical PNG rows; the soul benchmark converts sheet0 targets once to animation
steps. Do not compare same-numbered sheets/rows without these conventions.
No game textures or jar content is committed.

## Common scoring and mask intervention

Ran the same original four-probe sampler and score implementations on both
corpora. RGB is original channel order; GBR rotates both image and atlas to use
green as the gain denominator. Narrow tolerances are .06/.10 and loose .18/.30;
gain half-width stays .12 stops. Unmasked changes only the palette eligibility
of valid native probes, leaving geometry, templates and scoring fixed.

| Basis /score | Orange blocks exact /20 | Orange entities exact /79 | Soul blocks exact /115 | Soul correct row /115 |
|---|---:|---:|---:|---:|
|RGB narrow|2|45|3|24|
|RGB loose|1|41|6|26|
|RGB loose, no palette mask|1|35|6|31|
|GBR narrow|2|42|6|34|
|GBR loose|2|48|13|45|
|GBR loose, no palette mask|2|42|17|59|

Bypassing the adapted palette mask improves soul exact matches13 to17 and rows45
to59 on this reused segment. It hurts orange entities48 to42 under the same
GBR-loose comparison. This is direct evidence that mask choice affects the soul
results; channel rotation of orange-specific rules is not a demonstrated best
soul segmentation strategy. It does not prove every extra unmasked vote belongs
to the target flame, provide a safe automatic gate, or justify removing masks
from production.

No new method is selected using this validation audit. The next focused
experiment should test soul-specific palette eligibility on tuning first,
retaining the current control, before further ownership/geometry complexity.
Overlapping block faces remain a plausible obstacle, but this audit does not
measure their individual causal contribution. The previous explanation leaned
too heavily on overlap without first doing this source-stratified comparison.

## Reproduction and checks

```text
node FireCrackle/scripts/fire-soul-comparison.mjs .board/soul-colour-audit
```

Requires the existing prepared native corpora and compiled scorer runtime from
the soul experiments. All99 orange control scores/identities reproduce the
historical shared-gain results, and all115 soul control scores/identities
reproduce the preceding loose baseline within1e-12. All214 readable cases remain
in the denominator. The old RGB frames are used unchanged; soul frames retain
their previously applied shared native automatic unveil. No extra inverse,
resizing, encoding, geometry fit or truth-based mask is introduced here.

Evaluator SHA-256: `d2635d0930dca8f90278bc395c7072033d84810d9443bcb4c215537206744c4c`.
Detailed per-case rankings, texture audit and local jar verification remain
ignored under `.board/soul-colour-audit`. Native recordings and game assets
remain local.
