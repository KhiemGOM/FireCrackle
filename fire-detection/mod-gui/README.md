# GUI recording instance — Java 1.21.11

Run **`record-gui.cmd`**. This starts a separate game directory at `run/` with
Sodium and Fabric API installed there. It does not change the old 1.16.5 fire
recorder or its worlds. Java 21 is selected by the launcher.

Recording starts automatically. **F8** toggles labels and the small black/white
sync strip. Record the game window normally in OBS; preserve the strip at the
top left. Do not crop it away or cover it with another overlay. Quit normally
after recording so the writer drains and writes its completeness footer.

The recorder has **no fire scans, world-plane projections, ownership pass,
GPU readback or image encoder**. JSON writes run on a bounded background queue.
A red line below the sync strip means the label log failed or overflowed; that
session cannot be treated as complete ground truth. Startup metadata reports
whether Sodium is loaded. This implementation does not measure an FPS gain.

## What it labels

Each rendered GUI submission gets a renderer-frame ID and a screen-state row,
including open/closed, exact known GUI type, container type, transition ID,
screen instance, world/pause/overlay state, scaled/framebuffer dimensions, mouse
position and GUI scale. A screen/overlay transition during rendering is flagged
`stable_render_state=false`; do not use it as an ordinary classification target.
An unknown class is logged as unknown; no fallback guesses a known GUI type.
Social screen rows remain identifiable but are marked excluded from the intended
interaction detector. Menus are separate from interaction screens.

Container panel bounds and slot coordinates are written as deduplicated layout
records. These are **geometry annotations, not pixel ownership masks**. Recipe
book, tooltip, animated previews and transparent holes are not silently covered
by an opaque rectangle. Exact pixel masks are not implemented in this recorder.
No claim of 99% detector accuracy follows from having these ground-truth states.

Opening targets (chest versus barrel, villager identity, etc.) are not inferred
from screen titles. Shared visual families retain a known screen/menu identity;
target provenance needs a later interaction hook if required.

## Files and schema

Private output: `run/guilabel/<session-UUID>.jsonl`. No recording is uploaded.
Record types:

| `record` | Fields / meaning |
|---|---|
| `session` | `schema_version=1`, game version, session UUID, UTC, Sodium flag, strip specification, `geometry_only=true`, `mask_ground_truth=false` |
| `frame` | `frame`, `elapsed_ns`, `transition_id`, `screen_instance_id`, `changed`, `world_present`, `paused`, `stable_render_state`, `screen_visible`, `screen_open`; known class/type/category and title when open; optional overlay; image sizes/scale, mouse coordinates, optional `menu_type` and `layout_id` |
| `layout` | ID, first frame, panel x/y/width/height in **scaled GUI coordinates**, slots `{id,x,y,enabled}` relative to panel, `mask_ground_truth=false` |
| `recording_toggle` | frame ID and active state; disabled intervals are excluded, not labelled closed |
| `session_end` | dropped-record count and completeness flag; absent footer means interrupted/unclean session |

Renderer IDs are not video frame indices: OBS can duplicate or drop frames.
Match the strip first. The 128 cells encode a 16-bit `0xD3A5` preamble, low
32 bits of renderer ID, and CRC16-CCITT-FALSE of the four ID bytes. Fields are
MSB-first, Manchester pairs white/black for 1 and black/white for 0. Each cell
is 2 scaled GUI pixels wide and 3 high; total 256 × 3 GUI pixels. For recorded
coordinates, apply framebuffer/scaled dimensions and the video rescale. Keep the
strip region excluded from detector evidence. No fire/Jolt clock is involved.

The known-screen registry comes from
[`docs/gui_screens_1_21_11.json`](../../docs/gui_screens_1_21_11.json), using
Fabric intermediary names so development and remapped builds use the same IDs.
`generate_registry.py` refreshes that resource from locally cached verified
official/Yarn mappings; no upstream game classes or textures are embedded.

## Build and dependencies

`gradlew.bat test build` with Java 21. Built mod: `build/libs/gui-label-0.1.0.jar`.
Install it with Fabric Loader 0.18.4+ in a **1.21.11** instance. The supplied
development launcher already loads this project's classes; do not also copy
the built mod into its `run/mods/` directory.

`python install-sodium.py` installs pinned hash-verified versions into this
instance: Sodium 0.8.14+mc1.21.11 and Fabric API 0.140.2+1.21.11. They are separate
downloads, not bundled into our mod or committed to the repository.

Credits: [Sodium](https://modrinth.com/mod/sodium) by CaffeineMC;
[Fabric API](https://modrinth.com/mod/fabric-api) and
[Fabric Loader](https://fabricmc.net/) by FabricMC. Preserve upstream licenses
inside their distributed jars. Gradle wrapper scripts are Apache-2.0 upstream.

For footage, use the interaction checklist in
[`GUI_SCREEN_CATALOGUE_1_21_11.md`](../../docs/GUI_SCREEN_CATALOGUE_1_21_11.md).
Register actual new recordings and frame alignment in the training catalogue
before research use; leave complete recordings/sessions held out for evaluation.
