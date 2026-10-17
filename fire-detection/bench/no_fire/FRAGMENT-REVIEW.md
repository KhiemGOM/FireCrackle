# What the 13 radius4 false clears actually look like

## Owner's explicit review decision

**Later clarification:** portal-obscured fire is not excusable merely because
the portal makes detection hard. The four portal cases are reopened and must
abstain under the owner's subsequent translucency rule. The original three
explicit readable-fire misses remain. Current review bookkeeping is97 accepted,
3 explicit misses,4 reopened portal cases; the101/3 figures below describe the
earlier review before that clarification. Portal correction is now implemented
in the shared preprocessing path; see `PORTAL-RESULTS.md`.

After viewing the gallery, the owner selected exactly three crops as
inexcusable misses: **clip1:21330**, **survival1:41850**, **clip1:22950**.
The attached images match those gallery crop PNGs pixel-for-pixel. The other
ten cases are explicitly acceptable passes for the owner's task.

Thus the104 cleared outputs comprise **101 acceptable / 3 unacceptable** on
this reviewed set. The original capture-truth metric remains91TP/13FP; the
new number records the owner's case judgments, not a globally validated
readability policy. `fragment_review_decisions.json` preserves all13 decisions
separately. Do not turn the frame IDs into production exceptions.

The next detector work should retain those three readable-fire regressions:
two small burning entities and the dim inventory-background flame. Portal
undo remains useful, but the four portal cases are accepted under this review
and are not the immediate blockers for using this candidate.

A quick **post-review diagnostic**, not new validation: lowering the same
component threshold from2198 to1523 retains all three rejected cases for
review, but reduces acceptable clears from101 to68 (58 original no-fire plus
the ten accepted exceptions). That is a real coverage cost, so simply lowering
the threshold is not an attractive substitute for fixing the three failure modes.

The selected native crop interiors contain approximately872,1523,565 qualifying
orange pixels respectively (boxes can include background, so these are diagnostic
support counts, not exact fire areas). All are below the2198 component cutoff.
The two entity flames can be visibly recognizable while intrinsically too small
to satisfy that area rule. A small-readable-flame safeguard is a better direction
than assuming all low-area components are negligible.

2026-10-17. Review of **all13** errors from frozen `all:r4 <2198`:
91 correct clears and13 meaningful-fire frames cleared under the existing
24-native-pixel horizontal visible-box proxy. Original truth is unchanged.

All cases were decoded at their exact native video frame numbers, with three
video decoders in parallel. The gallery includes full-frame context, original
RGB, canonical auto-unveil RGB, and every capture fire box cropped losslessly
at native resolution and shown4x with nearest-neighbour scaling. No generated
or substitute flame pictures were used.

## Visual findings

These are visual categories, not validated automatic readability labels.

| Cases | Observed failure | Count |
| --- | --- | ---: |
| clip1:21330,22230,22950 | Small fire, roughly25–31px wide; two burning entities have smoke. Borderline sprite readability, not proof of absent fire. | 3 |
| clip1:22860,23040,23310 | Thin, oblique/foreshortened fire quads; some large box extents hide very little useful texture area. | 3 |
| quad1:5310,5760 | Heavy smoke hides most fire; one box spans104px but actual visible flame is fragmented. | 2 |
| survival1:41850 | Dim fire behind an open inventory; auto-unveil runs. The roughly82px-wide fire remains visible outside the inventory panel. | 1 |
| survival1:50760,51840,51930,52020 | Purple Nether-portal overlay changes the entire world picture's colours. Some fires are small; the portal also obscures larger near-camera fire. | 4 |

**They are not13 interchangeable tiny-flame cases.** The three small cases
may reasonably become negligible under an agreed readability policy, and
the foreshortened/smoke cases may become unlabelable. Those are judgments the
gallery makes reviewable, rather than reasons to silently discard errors.
The dim inventory-background flame and portal examples expose preprocessing
and visibility problems as well as size. GUI-piece masking alone does not
restore a purple-tinted world image.

## Portal undo is the most specific next experiment

The owner proposed a portal-animation veil undoer after seeing this review.
Four of13 failures directly motivate it. A known animated portal texture,
its phase and opacity would allow testing the inverse of the actual blended
layer, rather than widening the orange rule blindly. Fit those parameters
without using fire labels to choose them; assess recovered world pixels and
colour support against ordinary portal/no-portal footage.

Near-full-opacity pixels have little recoverable world information. A fit
must report uncertainty, and an uncertain correction must retain review.
This belongs in the **shared preprocessing path**; do not create a separate
Python/TypeScript portal inverse. The menu-gradient model must not be applied
as if it were a portal model. The original visual-review task did not implement
an undoer. The subsequent portal task does; see `PORTAL-RESULTS.md` for measured
results and limitations.

## A width-only fix is too blunt

Keeping the exact same104 cleared decisions and changing only the hypothetical
meaningful-fire width policy gives:

| Minimum native width | Correct clears under that policy | Remaining fire cleared | Previously meaningful evaluation frames newly ignored |
| ---: | ---: | ---: | ---: |
|24px, current|91|13|0|
|32px|96|8|35|
|40px|98|6|64|
|48px|99|5|83|
|80px|102|2|140|
|112px|104|0|195|

This is policy sensitivity, **not improved detector accuracy**. A box width
is not the number of distinguishable sprite columns: perspective, smoke,
portal texture and compression all matter. Ignoring everything below112px
merely to erase these errors would exclude195 of606 currently meaningful-fire
evaluation frames, including cases beyond these errors.

The owner has now resolved these judgments as recorded above. Use the three
unacceptable cases as explicit remaining failures; the width-only table is
retained as diagnostic context, not a replacement for that review.

## Evidence and reproduction

Local review gallery: `http://127.0.0.1:8794/`.
Ignored output: `.board/no-fire-parallel/fragment-review/` with `index.html`,
`manifest.json`, full pictures and all native crop PNGs. The manifest includes
raw RGB hashes, per-case sizes, auto-unveil decisions and cutoff sensitivity.

```powershell
python fire-detection/bench/no_fire/fragment_review.py .board/no-fire-parallel/fragment-review
```

Checks: exactly13 frozen-rule error rows selected;13 exact frames extracted;
all13 context images and all fire-box crop PNGs produced; manifest counts and
width sensitivity agree with direct cached-row scoring; native crops visually
reviewed. These are familiar correlated recordings. No app labels changed.
