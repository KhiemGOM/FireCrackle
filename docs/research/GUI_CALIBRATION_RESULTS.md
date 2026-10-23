# Interaction-GUI calibration

**Recall improved from 94.86% to 99.97%: 9,967/9,970 GUI frames detected,
with 0/12,958 false detections on closed frames.** The candidate recovers 509
of the original 512 misses without losing any original detections.

This is a calibration result on two existing development recordings, not an
independent test. The next recording session stays untouched until the selected
configuration is frozen. The production detector is unchanged by this research.

## Results and frozen candidate

| Configuration | GUI frames detected | Recall | False detections / closed frames |
|---|---:|---:|---:|
| Original, 90% border / 85% interior, regional checks | 9,458 / 9,970 | 94.86% | 0 / 12,958 |
| Original thresholds + automatic tooltip masking | 9,851 / 9,970 | 98.81% | 0 / 12,958 |
| Best unmasked, 80% border / 65% interior, regional checks off | 9,967 / 9,970 | 99.97% | 0 / 12,958 |
| **Frozen: tooltip masking, 80% border / 70% interior, regional checks off** | **9,967 / 9,970** | **99.97%** | **0 / 12,958** |

The masked candidate wins the declared tie-break because it reaches the same
maximum recall with stronger combined global thresholds. Masking alone recovers
393 misses with no regressions; the selected combination recovers 509. All 294
configurations had zero observed false detections on this cohort, so that
constraint did not distinguish them. This is not evidence of zero general error.

| Recording | Detected / GUI frames | False detections / closed frames |
|---|---:|---:|
| Main `14-09-57` | 9,047 / 9,050 | 0 / 12,123 |
| Supplemental `14-22-45` | 920 / 920 | 0 / 835 |

Creative inventory is now 3,357/3,357. Every remaining miss is a hanging-sign
editor frame in the main recording: 5239, 5250 and 5251. These are the same
fixed-control identity failures catalogued previously; that check was held fixed.
There are no remaining missed frames in the other recorded interaction types.
The 4,457 out-of-scope frames remain separate: 1,185 detected and 3,272 abstained.

Renderer-weighted recall is 9,956/9,959 (99.9699%). An exact rational-weight
audit reproduces the selected candidate and its tie-break, avoiding floating
point tie artifacts. Default-setting parity passes on all 27,385 decoded frames;
the source, binaries and research implementation hashes stayed unchanged.
The scan used 2,697.92 child-process CPU seconds, with approximately 29.1 MB of
private artifacts at completion, within the approved ceilings.

Frozen selection: family `masked`, grid index `95`, border `0.8`, interior
`0.7`, regional margin `null`. Minimum visible support and fixed-control
identity checks remain unchanged. Private `run-v1/frozen-winner.json` SHA256:
`cad3ad7c9cc3d9e6570c875c2de2b2cd34bddf5931eed9691fdace71f3a8f3fa`.
No new-session frames have been used. Apply this fixed candidate to that test
without further selection on the test results.

## Approved experiment

- Real recordings `2026-10-20 14-09-57.mkv` (25,121 frames) and
  `2026-10-20 14-22-45.mkv` (2,264 frames), decoded at native 1920x1080 RGB24.
- Primary task: interaction GUI present (`inventory.*`) versus closed. Exact
  container type is not required. Menus, chat and modded screens are processed
  but excluded from this metric.
- 9,970 positive frames, 12,958 closed frames and 4,457 excluded frames.
  Selection weights each repeated recording/renderer identity to total one;
  ordinary frame counts are also reported. Both recordings share a session.
- Two families: unchanged source-template matcher, and the same matcher with
  independently detected tooltip rectangles removed from evidence denominators.
- Per family: border agreement 60–90% and interior agreement 55–85%, each in
  five-point steps; regional floors 15 or 30 percentage points below the stage
  threshold, or disabled. Total: 147 settings per family, 294 candidates.
- Hold colour tolerance (24), fixed control identity (90% global / 75% regional),
  template bank, geometry search and minimum visible support unchanged.
- Choose maximum renderer-weighted recall with zero observed closed-frame false
  detections. Break ties by stronger combined global thresholds, stricter regional
  checks, then the simpler unmasked family.
- No AI, pretrained initialization, synthetic examples, temporal smoothing or
  renderer-position hints. Owner-approved ceiling: two child-process CPU hours
  and two billion bytes of experiment caches.

The original thresholds are 90% border and 85% interior, with regional floors
75% and 70%. Those settings are checked against the frozen full-frame baseline
on every decoded frame. The masked profiler also checks default-setting parity
against the actual occlusion-aware production API whenever it proposes a mask.

## Tooltip evidence

The implementation was checked against the local official Minecraft 1.21.11
`TooltipRenderUtil`, `DefaultTooltipPositioner`, `GuiGraphics`, and default
`tooltip/background` and `tooltip/frame` sprites and nine-slice metadata.
The renderer uses separate background/frame layers, configurable tooltip style,
mouse offset and viewport clamping. Private source evidence records their hashes.

The experimental detector requires compatible horizontal rims, paired vertical
edges and a dark-purple interior quorum before masking a rectangle. It does not
derive occlusion from failed GUI comparisons, use renderer truth to place masks,
or introduce another unveil/inverse-colour implementation. Its thresholds are
fixed before the sweep. Default tooltip style is the scope; custom styles are
not claimed supported.

Inspection found both real tooltips and false proposals on enchanting-table
world texture. A tooltip proposal is not a GUI-positive decision. Downstream
GUI false detections and recovered/regressed positives must be measured
separately; the mask estimator itself is not claimed to have perfect precision.

## Reproduction and evidence

Read the training catalogue, refresh its inventory, obtain agreement on a
bounded plan, and prepare the local source bank and frozen all-frame baseline.
Then run:

```powershell
python fire-detection/bench/gui_interaction/calibrate.py `
  --plan .board/gui-calibration-plan/approved-plan.json `
  --baseline .board/gui-all-frames-check `
  --assets .board/gui-soft-guard-check/assets-v10 `
  --output .board/gui-calibration-reproduction
```

`--build-only` builds without starting calibration. The research profiler is
bound to production source SHA256
`63e209c7ff711bde736a815576b111417f1aa076fa75ee6aee6ca72f15cd3063`;
changed detector code requires re-verification. The public reproduction build
matches the running frozen binary on four cached difficult frames for all 294
candidate decisions and tooltip rectangles.

Private `.board/gui-calibration/run-v1/` retains per-frame predictions,
configuration metrics, the approved coverage manifest, implementation hashes
and the frozen selection. Recordings, renderer labels, source assets, frame
images and build caches are not committed. The previous results remain in
[GUI_ALL_FRAMES_CHECK.md](GUI_ALL_FRAMES_CHECK.md) and
[GUI_MISSED_FRAME_CATALOGUE.md](GUI_MISSED_FRAME_CATALOGUE.md).
