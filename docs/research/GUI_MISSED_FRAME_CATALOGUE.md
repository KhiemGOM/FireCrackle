# Exhaustive GUI miss audit

All **512 missed frames in 75 contiguous stretches** from the whole-video check
have a per-frame rejection category. Every miss was decoded again and reproduced
under the frozen detector source. An image from every missed stretch was reviewed.
The detector, thresholds and source bank were not changed during this audit.

The complete local catalogue is `.board/gui-miss-catalogue/catalogue.md`. It
lists every stretch, every individual missed frame, source GUI scale, confirmed
rejection gate and a link to each of the 512 image crops. `catalogue.json` is the
machine-readable equivalent. The full frame/label mapping and images remain
private/ignored; this document contains only aggregate research results.

## Confirmed detector rejection

| Screen | Border gate | Interior gate, including presence fallback | Fixed control/text gate | Total |
|---|---:|---:|---:|---:|
| Creative inventory | 222 | 250 | 0 | 472 |
| Chest/container | 0 | 12 | 0 | 12 |
| Smithing | 0 | 10 | 0 | 10 |
| Dispenser/dropper | 0 | 8 | 0 | 8 |
| Merchant | 0 | 4 | 0 | 4 |
| Horse inventory | 0 | 3 | 0 | 3 |
| Hanging-sign editor | 0 | 0 | 3 | 3 |
| **Total** | **222** | **287** | **3** | **512** |

These categories describe the first blocking evidence gate across the actual
searched template variants/positions, not the percentage of the panel occluded:

- Border: no searched candidate satisfies the existing border evidence gates.
- Interior: a border candidate survives, but none also satisfies the interior
  check, including the distributed whole-panel presence fallback where eligible.
- Fixed controls: border/interior evidence survives, but the sign editor's
  required fixed heading/button evidence does not.

Truth-type-template and all-template rejection categories agree on all 512
frames. No miss is an unexplained post-gate rejection or an unsearched template
bank. This does not prove that the correct subpixel geometry was among the poses
searched; sampling/alignment can still contribute to failed colour evidence.

Six missed stretches change between border/interior rejection on different
frames. The per-frame catalogue preserves those changes rather than assigning
one rejection gate to the entire stretch.

## Visible context and cause confidence

| Reviewed representative context | Stretches | Frames in those stretches |
|---|---:|---:|
| Tooltip visible over the GUI | 70 | 489 |
| Items/counts/carried-stack foreground, no tooltip visible | 3 | 20 |
| Hanging-sign controls, no obvious foreground over controls | 2 | 3 |

The tooltip group includes all creative-inventory failures plus horse,
smithing and merchant cases. The item/count group contains the filled chest
and dispenser/dropper stretches. The sign-control group is at GUI scale2
(1.5 output pixels per GUI texel); small-text sampling is a hypothesis.

**These are representative-image context counts, not proven causal-occlusion
counts.** One representative of every stretch was visually reviewed; all 512
frames have machine-confirmed rejection gates and saved crops. Pixel ownership
was not recorded, and no automatic tooltip estimator was added. Tooltip presence
does not establish that neutralizing it alone recovers every frame. The earlier
tiny-creative diagnostic still failed after conservatively excluding its full
visible tooltip, so sampling/registration is an additional known concern.

## Is it good enough, and what should improve next?

The existing noncreative result (99.40% frame recall with no observed closed-GUI
false detections in these recordings) is useful for optional interaction finding.
Exact per-frame masks/open-close boundaries still have gaps, and neither this
audit nor the familiar same-session recordings establishes general accuracy.

The next useful development targets are:

1. **Source-based tooltip detection and neutral exclusion.** Tooltips appear in
   70/75 reviewed miss contexts. Recognize the GUI layer independently of failed
   template probes, then exclude covered evidence from both errors and support
   denominators while retaining minimum visible support. Measure actual recovery
   and closed-screen false detections; 489 is not a promised recovery count.
2. **Dynamic item/count/carried-stack handling.** The remaining 20-frame item
   contexts warrant distributed or independently masked evidence that tolerates
   foreground over any region. Their small visible area can intersect many
   sampled contrast edges. No permanently visible corner should be required.
3. **Fixed-text sampling tolerance.** Investigate the three sign-control frames
   after the common tooltip/item cases; verify text rendering against game source.
4. **Another recording/session before a broad accuracy claim.** Preserve the
   present recordings as known development evidence. Temporal filling, if later
   tested, must also measure its effect on real GUI boundaries and video cuts.

This audit supplies a concrete improvement queue; it does not require a new AI
model. Any later AI fitting/model comparison still needs its separately agreed
run plan and catalogue protocol.

## Provenance

Private `.board/gui-miss-catalogue/` contains:

- `source.sha256`: original production source hash, exactly matching the frozen
  all-frame benchmark (`63e209c7ff711bde736a815576b111417f1aa076fa75ee6aee6ca72f15cd3063`).
- `instrumented.rs`: snapshot of that source with only counter calls inserted
  at gate boundaries, and documentation comments removed for `include!`.
  Scoring, geometry, thresholds and pixel comparisons are unchanged.
- `trace.rs`, `run.py`: persistent native trace and full re-decoding of the 512
  misses; every prior miss must reproduce as `gui_detected=false`.
- `catalogue.json`, `catalogue.md`: complete per-frame/run results, scope and
  confidence annotations, source/instrumented-source/binary hashes.
- `contact-01.jpg` through `contact-09.jpg`: all 75 reviewed representatives;
  `frame-*.png` contains every missed-frame crop. Logged layout geometry is
  used only to crop review images, never supplied to detection.

All 512 frames and 75 stretches are accounted for exactly once. This was a
read-only deterministic audit, with no training, fitting or detector changes.
