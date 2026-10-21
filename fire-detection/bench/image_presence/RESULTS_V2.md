# Reviewed-crop model v2 — 2026-10-17

**This experiment did not improve coverage. Keep v1 as the reference model.**
Everything remains research only on `codex/fire-presence-research`, explicitly
excluded from0.2.1, with no app integration or saved-label changes.

## Primary comparison

Same919 sampled survival frames, same542 clear-eligible targets, same377
meaningful-fire targets, identical canonical preprocessing hashes and
translucency veto. Both thresholds were separately fixed using clip2 before
survival scoring, with the same strict-minimum-calibration-fire rule.

| Model | Eligible clear candidates | Coverage | Meaningful fire wrongly cleared | ROC area |
| --- | ---: | ---: | ---: | ---: |
| v1, frame bags and640px tiles | 33/542 | 6.09% | 0/377 | 0.749 |
| v2, reviewed crops and320px tiles | 10/542 | 1.85% | 0/377 | 0.712 |

Calibration coverage rose from8/93(8.6%) to14/93(15.1%), but this did not transfer
to survival. V2's frozen threshold is−1.8976476192474365. Without the shared guard,
the same v2 threshold gives12/542 correct clears and0/377 meaningful-fire misses.
At logit zero it gives156/542 correct clears and61/377 meaningful-fire misses,
so that threshold is unsuitable. Scores are not calibrated probabilities.

All10 v2 clears have no recorded fire (none is a negligible-fire target). The
review sheet shows mostly very dark scenes and settings menus. Five overlap
v1's33 clears; five are additional frames (#11070,15030,21600,28440,30420), while
28v1 clears are lost. An exploratory union of the two frozen candidate sets
would give38/542(7.01%) and0 observed misses here, but it was considered after
seeing these results, mostly adds dark scenes, and is not adopted or independently
validated. No threshold was raised to manufacture a coverage improvement.

## Training and checks

- Sampled1,048 fitting-frame candidates (stride30), versus350 in v1 (stride90).
  The actual crop corpus uses610 unique fitting frames:188 positive frames plus
  422 confirmed no-fire frames.
- Proposed192 stratified positive crops; inspected all192 visually. Approved188.
  Excluded clip1#5610,#6720,#13350 and quad1#5250 as obscured or ambiguous. Excluded
  positives are not used as negative supervision.
- Selected844 hard negative crops: two of four random320px proposals from each
  of422 true no-fire fitting frames, scored by frozen v1 weights. Checked source
  labels and split boundaries: no calibration/evaluation frames enter mining.
- Trained8epochs in38seconds; development whole-frame BCE selected epoch3
  (0.322594). The same83 development frame IDs are retained from v1.
- Five new contract tests pass, covering crop bounds, screen coverage, strip
  exclusion, recording roles and mandatory complete boolean crop review. Together
  with v1 there are10 targeted tests.
- Standalone v2 inference on the independently decoded clip2#15840 image matches
  the evaluation logit exactly:1.1282732486724854.

That menu frame was v1's threshold-limiting positive. At full resolution, a flame
is visible at lower right after shared auto-unveil. It remains positive truth.
V2 retains it with a clear margin, but fails to improve overall generalization.

## Additional scale diagnostic

After seeing the primary result, froze a separate post-hoc diagnostic protocol:
use the same v2 weights with the eight cached640px tiles per branch, excluding
v1's whole-screen view. Recalibrate on clip2 only before survival scoring. This
changes inference tile scale/count, not weights or training selection.

This gave8/93 eligible calibration clears and2/542 survival clears(0.37%), with
0/377 meaningful-fire misses. Survival ROC area was0.741. Larger tiles did not
recover v1's conservative coverage. This is exploratory and does not establish
which of the combined training changes caused the regression.

## Interpretation and artifacts

The crop model learned useful examples, but clean-crop supervision and more
adjacent samples from the same two fitting recordings did not solve the broader
scene/generalization problem. More distinct fitting scenes, balanced difficult
positives and a new independent recording are the next useful data work. These
results do not justify replacing v1 or shipping either model.

Survival is a familiar diagnostic set: earlier results informed the broad v2
proposal. Zero errors in correlated sampled frames cannot guarantee zero future
errors. Recorded width24 boxes and visibility remain approximate. The shared
purple/supplied-translucency veto does not automatically recognize water/glass/
ice or prove opacity. Open-menu coverage remains incomplete.

All data, crops, review decisions, models and screenshots remain local under
the primary checkout's `.board/image-presence/run2/`. Important files:

- `protocol.json`, `dataset.json`, `candidate-plan.json`, `review.json`, `review-notes.json`
- `best.pt`, `freeze.json`, `history.json`, `mined-negatives.json`, `calibration.json`
- `report.json`, `clip2-predictions.json`, `survival1-predictions.json`
- `positive-review-1.png` through`positive-review-4.png`, `positive-review-doubts.png`
- `survival1-correct-clears.png`, `old-threshold-case.png`, `old-threshold-unveiled.png`
- `coarse-ablation/protocol.json`, `coarse-ablation/report.json`

Checkpoint SHA256:
`05d4cd9c9be81fa294c99e4f9837c529676c573add9e849a7ff5e0713f5d8d3b`.
Review SHA256:
`c9798fb2f5da360c6aa60bed1842dc43ef6808dc5a2c321e5e2ad1d7174b3b67`.
