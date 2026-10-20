# GUI interaction detector — initial native implementation

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

- 56 local source variants for 22 container/inventory screen classes: inventory,
  creative, crafting, crafter, furnace/blast furnace/smoker, brewing, enchanting,
  anvil, grindstone, smithing, stonecutter, loom, cartography, beacon, hopper,
  dispenser/dropper, shulker, merchant, horse/mount and 1–6-row containers.
- `Detection.matched` is an accepted exact known class with input-pixel bounds,
  x/y scale, asset version/variant and source-anchor agreement scores. The asset
  version is **not** an inferred Minecraft version. Score is not a probability.
- `matched=None` is abstention: `no_known_panel_match` or
  `ambiguous_known_types`. It never proves that a GUI is closed. Alternatives
  preserve known class IDs without promoting unknown-looking rectangles.
- Different asset versions of the same class do not count as semantic ambiguity.
- `merge_neutral_panel` adds Unknown/neutral panel exclusions to the existing
  GUI mask while preserving existing HUD evidence and its reliability/fit. The
  conservative rectangle is not an opaque ownership mask. It can exclude a
  transparent preview hole; do not call it exact pixel supervision.
- Input must be uncropped vanilla GUI capture. Current search is 0.75–8 video
  pixels/GUI pixel, with limited vertical stretch and origin-rounding search.
  Crops, arbitrary resource packs and larger transforms are not validated.
- Menus, book/lectern/sign editors, nautilus, server dialogs and operator editors
  are not implemented in this first source-template path. The source catalogue
  remains broader than implemented recognition. Sodium settings is modded and
  must abstain. No app scan button/automatic label path is enabled yet.

## Development check, not final accuracy

On the two aligned 20 Oct GUI recordings, select one real midpoint per
contiguous labelled screen visit, including closed and unsupported screens:

| Clip | All samples | Correct accepted type | Supported-type abstentions | Other/closed abstentions | Median native time |
|---|---:|---:|---:|---:|---:|
| `14-09-57` | 587 | 191 | 32 | 364 | 7.92 ms |
| `14-22-45` | 49 | 14 | 1 | 34 | 5.67 ms |
| Combined | 636 | 205 | 33 | 398 | — |

**Zero wrong accepted types; zero false accepts on 289 closed-GUI samples.**
Accepted-type coverage among currently supported class samples is **205/238
(86.1%)**. This is explicitly **not** 99% overall GUI detection: unimplemented
GUI classes are additional misses for an all-GUI objective. Most exact-type
ambiguity is furnace/blast-furnace/smoker: their sampled static panel anchors
agree, so the detector retains competing IDs instead of inventing a type.

Both clips share one game session and have already been inspected during
development. Frames/visits are correlated. There is no independent-session
final validation here, no measured guarantee for 1.16.5, no full-video detector
scan, and no automatically recovered exact open/close boundaries. Successful
barcode alignment of every video frame is a separate data-quality check.

Private evidence: `.board/gui-interaction-detector/final-check/` contains the
per-sample predictions, per-recording report, coverage of every catalogue
original, source hashes, raw preprocessing description and binary/asset/source
versions. Earlier diagnostic checks remain separate. Source textures/packs,
videos and label snapshots are ignored, never committed.

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
