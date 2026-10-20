# Distributed GUI-presence evidence

The automatic detector now detects **260/261 interaction-GUI samples (99.6%)**,
with **0 false detections in 289 closed-GUI samples**. It recovers two of the
three remaining automatic misses, loses no previous detections, and changes no
existing exact-type decisions. These are the same 636 development segment
midpoints, not an independent recording or exhaustive per-frame evaluation.

## Why a mostly visible panel was being rejected

The earlier structure probes deliberately concentrated on the upper work area
to distinguish container types. The lower player inventory is shared across
many GUIs, so it had been excluded from that type evidence. In the filled
dispenser/dropper, foreground content mismatched 41/192 probes, leaving
151/192=78.65% agreement against an 85% gate. The failed-probe percentage is
not the percentage of the entire image or panel covered by foreground content.

For GUI presence, the shared player inventory is useful evidence. The new
fallback samples contrast anchors throughout eligible container panels while
retaining the existing border fit, 85% structure threshold, regional quorums,
source-colour comparisons and minimum visible support. It does not mark failed
probes as occluded or remove their errors from the denominator. Independently
supplied occlusion masks remain neutral through the existing API.

This whole-panel fallback is eligible only for uncoloured `inventory.*` source
panels at least 150x120 with no fixed-control identity requirement. Books,
sign/editor controls and menus do not gain a relaxed fallback. It runs only
when the type-specific structure check rejects a candidate after its border
passes. Strong existing type evidence always takes priority. A fallback match
returns `known_panel_presence`, `gui_detected=true`, possible known types, and
`matched=None`; it never establishes an exact type from shared slots.

## Cases recovered

| Main recording frame | Recorded GUI | New result |
|---|---|---|
| 22573 | Tiny creative search inventory | GUI detected, no exact type; source agreement score 0.8698 |
| 24639 | Filled dispenser/dropper | GUI detected, no exact type; source agreement score 0.9380 |

The source agreement scores combine border/structure fractions; they are not
calibrated probabilities. The tiny creative inventory at frame 22380 still
fails. Its visible tooltip overlaps the lower/right panel and its border fit
already fails before structure scoring. Spreading interior evidence cannot
repair that border gate. A follow-up diagnostic conservatively excluded the
entire manually identified visible tooltip rectangle `(983,565)-(1052,607)`
in native video pixels, in addition to logged slot/cursor footprints. It still
abstained: the tooltip alone does not explain this miss. Small-scale source
resampling/registration remains a separate issue. This is an oracle diagnostic,
not an automatically inferred mask or proof of exact foreground ownership.
No video-only tooltip estimator was added here.

## Verification and private evidence

- All 636 original samples were rerun using the actual native detector and the
  unchanged local `assets-v10` bank. Only the two GUI-presence decisions above
  changed versus `d42f77d`; every exact-type output stayed unchanged.
- The full supplied-mask compatibility rerun also gives 260/261 and 0/289
  closed false detections, with no losses relative to the automatic result.
  Its renderer-assisted mask limitations remain unchanged; it adds no recovered
  samples now that whole-panel evidence handles the earlier filled-container
  and tiny-creative cases automatically. The runner/results are under private
  `mask/{check_visits.py,supplied-mask-visits.json}`.
- Median native detection time was 12.188 ms / 12.162 ms in the two clips,
  versus 12.207 ms / 11.976 ms in the immediately preceding run. These are
  local sequential measurements, not a controlled speed claim.
- 18 integration tests plus the source-origin unit test pass. The new source
  fixture introduces sparse coloured foreground into an upper work area,
  verifies GUI presence with no exact type, and rejects a uniform-grey frame.
- Private `check/{report.json,predictions.jsonl,coverage.json}` under
  `.board/gui-distributed-presence-check/` records all decisions, video/source/
  asset/binary hashes, sample counts and catalogue coverage. No AI fitting,
  training or learned occlusion model was involved.
- Masks are still conservative neutral exclusions, not exact GUI ownership.
  The two clips share a session and have been inspected during development.
  Zero observed errors does not guarantee zero errors on other footage.
