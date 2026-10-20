# GUI false-negative audit

The current interaction-GUI presence result is **242/261 (92.7%)**, with
**0 false detections in 289 closed-GUI samples**. Menus and Sodium settings
are outside this metric. Type ambiguity counts as GUI detected.

This audit traces all **19 actual misses**, using their exact decoded OBS
frames, frozen renderer labels and the unchanged production probe code. It is
a same-session development diagnosis, not independent accuracy validation.
During that diagnostic run, no model fitting, threshold changes or production
matcher changes were made.
The measurements below trace the pre-mask source revision (`af9376f`).
Subsequent caller-supplied-mask normalization is described separately below;
it does not supply an automatic occlusion estimator or change these results.

## Findings

| Count | Case | Rejection mechanism | Evidence |
|---:|---|---|---|
| 14 | Smallest GUI scale | Border gate fails at every searched pose | GUI scale1 at2560×1440 was recorded at1920×1080:0.75 video pixels per GUI texel. Single-texel highlights no longer preserve source colours. |
| 1 | Filled dropper/dispenser | Interior structure gate fails | Outer border100%; structure151/192=78.6%, below85%.41 failed probes overlap item/count/carried-stack evidence;26 lie within slot item rectangles. |
| 1 | Merchant | Coarse origin search plus regional quorum | A renderer-derived alignment passes all gates. The closest tested alignment shifts0.375 video pixels and fails the upper-left evidence quorum. |
| 3 | Hanging-sign editor | Texture-border/structure sampling fails | Headings are visible and match at the best correctly registered poses. Nearly all failed texture probes find the expected colour within one native video pixel. |

### 14 small panels: actual source colours are lost

Frames22075,22107,22151,22178,22208,22238,22266,22295,22329,22380,
22467,22499,22573 and22653 from the main recording all use GUI scale1.
The renderer reports framebuffer2560×1440; the recorded frames are1920×1080.
The factor is0.75 on both axes. These include crafting, crafter, hopper,
dispenser/dropper, smithing, chest, blast furnace, creative, shulker,
cartography and mount inventories.

All production candidate poses were traced, including both recipe shifts,
all scale/vertical-ratio candidates and all configured origin offsets.
**None passed the border gate** for these14 frames. At renderer-derived
placements, source255 highlights often read184–198 after recording; the
production channel tolerance is24. Border agreement at those placements is
58.3–88.5%, below the90% global requirement. Structure evidence is also degraded.
This establishes the failed comparison, not the exact OBS resampling kernel.

### Filled dropper, main frame24639

GUI scale3, intact outer frame. The canonical source bank calls the shared
dropper/dispenser layout `inventory.dispenser_screen`; the displayed name is
not used to identify it.

- Border:100%.
- Structure:151/192=78.6458%;41 failed source anchors.
- 26 failed anchors lie inside the renderer-reported16×16 item rectangles.
- Remaining failures occur around item/count/carried-stack overlays, visible
  in the saved probe overlay. The scene has multiple filled slots and a stack
  attached to the cursor.

The matcher incorrectly treats some content-bearing pixels as static panel
evidence. This is not a missing screen profile. Minecraft GuiGraphics renders
item decorations after the items, with shadowed count text positioned relative
to the item rectangle; interiors alone are not a complete content exclusion.

### Merchant, supplemental frame1026

GUI scale3. Using the renderer-derived logical panel origin converted to video
coordinates gives x650.25,y353.25 at scale2.25. Evaluating that placement with
the canonical scorer gives border100%, structure179/192=93.2292%, and all
regional gates pass. This is a verified passing image alignment.

The production search instead samples x650.625 at the nearest border-passing
alignment. Structure falls to169/192=88.0208%; its upper-left quadrant drops
from17/22=77.3% to15/22=68.2%. The local requirement is70%, so the frame is
rejected even though its global structure score exceeds85%.

Thus a valid match exists but the finite origin search skips it. Renderer
geometry was used only for this diagnosis, never as detector input in the
reported242/261 result. Fractional GUI/capture registration needs explicit
handling; this is not evidence that merchant content should simply lower the
whole detector threshold.

### Hanging signs, main frames783,4165,5965

The vanilla1.21.11 HangingSignEditScreen places the16×16 texture at(-8,-8),
after a4.5 scale and translation to(screenWidth/2,125-13). The current source
pack first rasterizes that texture to72×72, then samples it at the fitted
GUI/video scale. These operations are sensitive to fractional pixel phase.

- Crimson, frame783, GUI scale6: the best registered pose has border100%,
  heading100%, but structure31/37=83.8%, below85%. Five of the six failed
  structure probes find a matching colour within one video pixel.
- Bamboo, frames4165/5965, GUI scale2: correct-heading poses have structure100%
  and heading100%, but border29/34=85.3%, below90%. All five failed border
  probes find the expected colour within one video pixel. Moving the whole
  template0.75 video pixels down passes its texture gates but moves the
  independently rendered heading out of alignment, leaving only37% agreement.

This is exact-pixel texture-registration/resampling brittleness, not absence
of an editor or unknown wood type. A one-pixel neighbourhood was inspected
only as a diagnostic; neighbourhood matching has not been enabled or validated.

## Implementation direction supported by this evidence

1. Model capture resampling/fractional origins rather than demand exact source
   texel colours after subpixel downscaling. Keep independent negative checks.
2. Keep source reference evidence but treat known occlusion anywhere on the GUI
   as neutral: remove covered probes from both mismatches and denominators.
   Items, counts, dragged stacks, tooltips and cursors can cover borders as
   well as slot interiors. No particular region is guaranteed visible.
   Use enough surviving consistent evidence; do not label mismatches as
   occlusion merely because doing so improves the score. Slot-only exclusion
   is insufficient. Do not infer screen type from its name.
3. Refine origin registration; the merchant has a demonstrated passing pose.
4. Treat hanging-sign texture transforms separately from its fixed controls,
   or use the shared source-defined editor controls for presence detection.

These are targeted next changes, not results or new accuracy claims.

### Caller-supplied occlusion normalization

`detect_with_occlusion` now accepts a video-pixel mask from its caller. Nonzero
pixels are neutral: their source probes do not vote and do not contribute to
score denominators or regional quorum denominators. A fully covered evidence
stage is unavailable, rather than a failed stage; remaining stage weights are
renormalized. Even the entire border may be covered while interior evidence
supports a match. Too few surviving probes remains uncertain.

This is scoring support, **not automatic occluder discovery**. The caller must
provide an independent occlusion mask. No improved real-video detection rate
is claimed from controlled-mask tests. Unmasked mismatches still count.

## Reproducibility and source evidence

- Source: `fire-detection/core/src/gui_interaction.rs` (`score`, `detect`).
- Production source SHA256:
  `a4387e83305186d7e3d245c9272be1ebbf28371c59ac3ad844202342fa1ede48`.
- Source-pack manifest SHA256:
  `88e50a2f428ca8c41c83544e77022b5f77d87bf7fbc4d1b104ac2c59a6abd065`.
- Minecraft1.21.11 source rules: AbstractContainerScreen, GuiGraphics,
  AbstractSignEditScreen and HangingSignEditScreen. Compiled class/source asset
  hashes are recorded in the local source-pack manifest.
- Private trace adapter: `.board/gui-interaction-fn-trace/{run.py,trace.rs}`.
  It compiles the production module byte-for-byte except inner documentation
  comments, then calls its actual template builder, detector and scoring
  functions. No executable rule is reimplemented or relaxed.
- All19 negative decisions reproduced. Per-template searched-pose gate counts,
  raw/gated scores, probe coordinates/expected/observed colours, renderer
  metadata and source hashes are saved in `trace-00.json` through `trace-18.json`.
- Probe overlays and exact input frames remain ignored/private. No footage,
  renderer logs or Minecraft assets are committed with this report.
