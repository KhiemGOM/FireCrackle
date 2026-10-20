# GUI interaction detector — source-template implementation

`fire_core::gui_interaction` recognizes **known vanilla container panels** from
RGB pixels. It fits GUI scale and centered/recipe-shifted geometry independently
of the hotbar. Fixed source-texture borders must match across the panel; upper
work-area slot/separator anchors identify the screen. Mount/trading panels also
use their static lower inventory because their upper previews/list are dynamic.

No AI model, generic pretrained initialization, synthetic-fire examples,
recorded-frame template fitting or learned calibration is used. Assets come
only from local official 1.16.5 and 1.21.11 jars. Source corrections (shulker
height, shared player inventory, source preview exclusions) are explicit.

## Current scope and contract

- 88 local source variants for 35 known screen classes. The 22 container classes are inventory,
  creative, crafting, crafter, furnace/blast furnace/smoker, brewing, enchanting,
  anvil, grindstone, smithing, stonecutter, loom, cartography, beacon, hopper,
  dispenser/dropper, shulker, merchant, horse/mount and 1–6-row containers.
- New 1.21.11 paths cover book editing/signing/viewing, lectern, both sign
  editors, pause, options, accessibility, chat settings, controls, skin settings
  and sound settings. Book-view recognition has no recorded positive yet.
  Fixed controls currently use the source English font/translation; other
  languages and replacement fonts are not covered by these new paths.
- Container titles are deliberately ignored: anvils can rename containers.
  Fixed button labels/editor headings may identify screens, but renameable
  inventory titles must never break a layout tie.
- Books use their source top alignment and exclude writable content. Hanging
  signs require the source wood texture AND their fixed editor heading; a
  world sign texture alone is insufficient. Ordinary sign editors require
  their fixed heading and Done button at the source positions.
- Menu recognition checks both the source button texture and fixed labels at
  independent header/footer positions. Minecraft rounds vertical layout
  placement, so a 20px button in a 33px footer starts at H-26, not H-27.
  The pause grid and sign-editor button use quarter-viewport positioning.
- Source rules are checked against 1.21.11 BookEditScreen, BookSignScreen,
  BookViewScreen, LecternScreen, AbstractSignEditScreen, HangingSignEditScreen,
  PauseScreen, OptionsScreen/OptionsSubScreen, AccessibilityOptionsScreen and
  the vanilla layout classes. GuiSpriteScaling.NineSlice defaults
  `stretch_inner=false`; GuiGraphics tiles the button centre and crops its
  final tile. It must not be approximated by stretching the source interior.
  The local manifest records the corresponding compiled-class hashes, plus
  texture, font/provider-map, scaling metadata and translation dependencies.
- **`Detection.gui_detected` is the primary result.** Any known layout passing
  the evidence gates counts as GUI detected, even if several types fit equally
  well. `candidate_types` retains those plausible IDs without inventing a winner.
- `Detection.matched` is an accepted exact known class with input-pixel bounds,
  x/y scale, asset version/variant and source-anchor agreement scores. The asset
  version is **not** an inferred Minecraft version. Score is not a probability.
- `matched=None` means exact-type uncertainty: `no_known_panel_match` or
  `ambiguous_known_types`. The latter still has `gui_detected=true`.
  A missing GUI match never proves that a GUI is closed. Alternatives
  preserve known class IDs without promoting unknown-looking rectangles.
- Different asset versions of the same class do not count as semantic ambiguity.
- `detect_with_occlusion` accepts a separate input-video-pixel mask. Nonzero
  pixels are neutral: covered source probes are removed from error counts,
  normalization denominators and regional denominators. Empty stages contribute
  no negative vote; remaining score weights are normalized. No border/corner
  is assumed permanently visible. Conservative support guards require at least
  16 visible probes for a scored stage and 32 total across two source groups;
  these guards are not calibrated accuracy claims. All-hidden evidence abstains.
  `PanelMatch.visible_probes` distinguishes unavailable stage scores from zero
  agreement. The caller supplies occlusion independently; this API does not
  find occluders or automatically discard mismatching pixels. Existing `detect`
  retains the original unmasked path and reported real-recording results.
- `merge_neutral_panel` adds Unknown/neutral panel exclusions to the existing
  GUI mask while preserving existing HUD evidence and its reliability/fit. The
  conservative rectangle is not an opaque ownership mask. It can exclude a
  transparent preview hole; do not call it exact pixel supervision.
  Type ambiguity does not prevent this merge: the best-supported known panel
  geometry supplies the neutral exclusion while its possible types are retained.
  Fixed-control matches currently exclude their button patch only, not the
  complete menu/sign editor. Their piece ID is MenuButton; these masks are
  partial, neutral exclusions rather than complete GUI ownership.
- Input must be uncropped vanilla GUI capture. Current search is 0.75–8 video
  pixels/GUI pixel, with limited vertical stretch and origin-rounding search.
  Crops, arbitrary resource packs and larger transforms are not validated.
- Remaining menus, nautilus, server dialogs and operator editors
  are not implemented in this source-template path. The source catalogue
  remains broader than implemented recognition. Sodium settings is modded and
  must abstain. No app scan button/automatic label path is enabled yet.

## Current tiny-GUI/sign development check

**260/261 interaction-GUI samples detected (99.6%); 0/289 closed-GUI false
detections.** The bounded subpixel source-colour guard, inherited hanging-sign
controls, source-rounded container origin and whole-panel presence evidence
recover 18 misses without losing previous detections. Shared-slot evidence
returns GUI presence without claiming an exact type. The same-session,
sampled-development limits still apply. See
[`GUI_DISTRIBUTED_PRESENCE_CHECK.md`](../../../docs/GUI_DISTRIBUTED_PRESENCE_CHECK.md)
for the latest presence check,
[`GUI_FINAL_MISS_CHECK.md`](../../../docs/GUI_FINAL_MISS_CHECK.md) for the
final cases and source-origin fix, and
[`GUI_SOFT_GUARD_CHECK.md`](../../../docs/GUI_SOFT_GUARD_CHECK.md) for the earlier
edge/sign method. Regenerate local source packs to
include the new hanging-sign control alternatives.

## Historical pre-soft-guard development check

**Primary interaction-GUI detection: 242/261 (92.7%), with 19 actual misses.**
This includes all recorded `inventory.*` visits (books and sign editors too),
excludes menus and modded screens, and counts 17 ambiguous-type matches as
detected. There were **0 false GUI detections in 289 closed-GUI visits**.
The source-template presence gates are unchanged; exact-type ambiguity is no
longer incorrectly reported as a GUI-presence failure.

On the two aligned 20 Oct GUI recordings, select one real midpoint per
contiguous labelled screen visit, including closed and unsupported screens:

The following is the secondary exact-type diagnostic, including menus:

| Clip | All samples | Correct accepted type | Supported-type abstentions | Other/closed abstentions | Median native time |
|---|---:|---:|---:|---:|---:|
| `14-09-57` | 587 | 243 | 42 | 302 | 14.382 ms |
| `14-22-45` | 49 | 23 | 2 | 24 | 9.07 ms |
| Combined | 636 | 266 | 44 | 326 | — |

**Zero wrong accepted types; zero false accepts on 289 closed-GUI samples.**
Accepted-type coverage among currently supported class samples is **266/310
(85.8%)**, compared with 205 correct accepts before expansion. This is explicitly **not** 99% overall GUI detection: unimplemented
GUI classes are additional misses for an all-GUI objective. Most exact-type
ambiguity is furnace/blast-furnace/smoker: their sampled static panel anchors
agree, so the detector retains competing IDs instead of inventing a type.
All six book/lectern visits, all seven ordinary sign-editor visits and seven
of ten hanging-sign-editor visits were accepted correctly. Of 17 pause visits,
11 were accepted; one inspected miss used subpixel-sized GUI texels after OBS
resizing. Unreadable tiny controls remain abstentions; thresholds were not lowered.

Both clips share one game session and have already been inspected during
development. Frames/visits are correlated. There is no independent-session
final validation here, no measured guarantee for 1.16.5, no full-video detector
scan, and no automatically recovered exact open/close boundaries. Successful
barcode alignment of every video frame is a separate data-quality check.

Private evidence: `.board/gui-interaction-detector/check-v9/` contains the
per-sample predictions, per-recording report, coverage of every catalogue
original, source hashes, raw preprocessing description and binary/asset/source
versions. Earlier diagnostic checks remain separate. Source textures/packs,
videos and label snapshots are ignored, never committed.
The explicit presence contract was rechecked in
`.board/gui-interaction-miss-audit/presence-check/`, with the same frame visits
and source bank; its reports include separate `gui_presence` counters. All 19
actual misses were extracted and matched to frozen renderer metadata. Fourteen
occur at GUI scale 1, which OBS reduced to 0.75 video pixels per GUI texel.
Three are hanging-sign editors; two are filled dispenser/trading screens at
scale 3. These are verified failure conditions, not yet proof that a particular
anchor, occluder or resampler caused each miss.

## Reproduce

1. Read `docs/TRAINING_DATA_CATALOGUE.md`, register/refresh inputs and preserve
   original recording/session identity. Do not silently substitute fire labels
   or old hand-picked cached subsets for GUI screen-state truth.
2. `python fire-detection/bench/gui_interaction/prepare_assets.py --output .board/gui-interaction-detector/assets`
3. `cargo test --manifest-path fire-detection/core/Cargo.toml --test gui_interaction`
4. `cargo build --release --manifest-path fire-detection/core/Cargo.toml --example gui_interaction_frame`
5. `python fire-detection/bench/gui_interaction/check_recorded.py --assets .board/gui-interaction-detector/assets --output .board/gui-interaction-detector/check`

The check streams selected **native 1920×1080** RGB frames through a persistent
native process; it does not use renderer geometry to locate the GUI. Renderer
labels are read only for selection and scoring. The barcode region is outside
the panel candidates. Downsampling tiny GUI scales can destroy one-pixel
bevels, so the final check retains native resolution.

Any future AI fitting/model comparison still requires the owner's concrete run
plan agreement under AGENTS.md. This deterministic implementation is not such a run.
