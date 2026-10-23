# Mod plan (Fabric, Minecraft 1.16.5, Yarn mappings)

## Iteration 1 scope

1. **Sync strip overlay**: after the whole frame (HUD, GUI) is rendered, draw the strip from `sync/PLAN.md`
   in the top-left, in **framebuffer pixels**, independent of GUI scale. Done with GL scissor + clear so
   it is pixel-exact and opaque (no blending, no scaling).
2. **Label log**: one JSONL line per rendered frame:
   `{"f":<frame id>,"tick":<client ticks since launch>,"f0":<fire_0 frame>,"f1":<fire_1 frame>}`.
   `f0`/`f1` are the **displayed image row** of the `block/fire_0` and `block/fire_1` atlas sprites: the
   sprite's animation step mapped through its .mcmeta frame order (fire_0 is rotated by 16 rows, see
   `../NOTES-minecraft-1.16.5.md`), read via a mixin accessor. `-1` = unavailable.
3. (Iteration 2, below.) Per-frame fire visibility, bbox, per-block sheet/mirror.
4. OBS start/stop stays in the Python controller for now (not inside the mod).

## Iteration 2: per-frame fire labels as real data

Goal: every rendered frame gets a label row that says whether fire is visible, where (bbox in framebuffer
pixels, **top-left origin, same as the strip and the video**), and which texture each fire block shows.

Method (what the game itself draws, no guessing):
1. Fire blocks near the camera are tracked from the real render path.
2. For each, take the **actual baked quads** (the model variant chosen for that position): their sprite gives
   the **sheet** (fire_0 / fire_1) and the UV winding gives **mirrored** (`*_alt*` models flip U).
3. Project the quad corners with the **same model-view and projection matrices the world render used this
   frame** (captured from `WorldRenderer.render`, so view bobbing and hurt tilt are included).
4. Walk the quad texel by texel (16x16): only texels that are **opaque in the currently displayed image row**
   count, so the box hugs the visible flame, not the whole plane.
5. Occlusion: for each macro-cell of texels, test the camera->point segment against **opaque full-cube blocks**.
   Texels outside the screen or behind the camera do not count.
6. Frame-level `fire` = at least one visible texel on screen; `box` = union of all visible texel boxes.

Per-frame row schema (JSONL, extends iteration 1):

`{"f":N,"tick":T,"f0":R0,"f1":R1,"fire":true,"box":[x0,y0,x1,y1],"blocks":[{"pos":[x,y,z],"sheet":0,"mirror":false,"row":17,"box":[x0,y0,x1,y1],"vis":0.62,"dist":3.25}]}`

- `row` is the displayed image row for that block's sheet (= `f0` if sheet 0 else `f1`).
- `vis` = visible opaque texels / opaque texels of that block (0..1). Only blocks with at least one visible
  texel are listed. No fire: `"fire":false,"box":null,"blocks":[]`.
- Numbers: box coordinates 1 decimal, `vis` 3 decimals, `dist` 2 decimals.

As built (iteration 2):
- One label per **(block, sheet, mirrored) group**, so `pos` can repeat: a block's floor plane and each side
  plane pick their own model variant, and each variant shows a different texture.
- Back faces are culled (`Quad.isFrontFacing`): fire is drawn in the cutout layers, which have face culling on,
  so a plane seen from behind is not drawn and does not count as visible.
- Fire positions come from a mixin on `BlockRenderManager.renderBlock` (what the chunk builder really renders;
  priority 500 so it runs before Indigo's cancelling injection) and are re-validated against the world each frame.
- If labelling throws, the frame is **omitted** from the log (a gap in frame ids is detectable; a guessed
  "no fire" row would silently poison the data).
- Dev-only debug overlay (`-Dfirelabel.debug=true`, set by `gradlew runClient`): red = fire_0, green = fire_1,
  magenta/cyan = mirrored variants, yellow = frame box. Not enabled in a normal run (it would be recorded).
- Status: pure core unit-tested (91 tests); the glue compiles but is **not yet verified in a running game**.
  Open checks: matrix convention (boxes must hug the flames), Indigo hook order, quad winding assumption.

### Iteration 2b: every source of the fire_0 / fire_1 textures

Fire textures are drawn in three places in 1.16.5; all three are labelled, with a `src` field:

1. `"block"`: fire blocks (above).
2. `"entity"`: burning entities, `EntityRenderDispatcher.renderFire`: stacked camera-facing quads that alternate
   fire_0 / fire_1 and flip U every other pair. The vertices are captured as the game emits them
   (`drawFireVertex`: local position + UV + the matrix entry, i.e. view space), four per quad, so the geometry is
   exact and nothing is re-derived. Only captured during the world render (an entity previewed in the inventory
   GUI uses other matrices and is ignored, documented below).
3. `"overlay"`: first-person on-fire overlay, `InGameOverlayRenderer.renderFireOverlay`: two fixed quads of
   fire_1 in front of the camera, drawn with depth test ALWAYS, so no occlusion. Built from the hand matrix
   captured at the call plus constants from the vanilla code (translate +-0.24/-0.3/0, rotate +-10 degrees about Y).

New schema key: `"fires":[...]` replaces `"blocks":[...]`. Entry fields: common `sheet, mirror, row, box, vis, dist`;
block adds `"src":"block","pos":[x,y,z]`; entity adds `"src":"entity","id":<entity id>,"type":"minecraft:zombie"`;
overlay is just `"src":"overlay"` (`dist` 0).

`mirror` means "appears horizontally flipped on screen", worked out from the UV mapping AND the winding as seen
from the camera (`Quad.isMirroredFrom`), so it is right for quads whose winding is not the block-model one.
Entity and overlay quads are not back-face culled in the visibility check (they face the camera by construction).

Hook for the projection: 1.16.5 has no projection getter and the hand pass uses a different projection from the
world pass, so `GameRenderer.loadProjectionMatrix` is hooked to remember the one currently in effect.

Failure modes added by this work:
- View-space -> world conversion (needed so entity fire can be occluded by blocks) wrong when the view matrix has
  a bobbing translation -> `ViewTransform` handles rotation + translation, round-trip tested.
- Rotation direction of the overlay quads (+-10 degrees) wrong -> pinned by a hand-computed vertex in a test and
  checked by eye with the debug overlay.
- Entity fire captured outside the world pass (inventory preview) would get world-pass boxes -> capture is only
  armed between `WorldRenderer.render` HEAD and RETURN.
- Quads that use another sprite (e.g. soul fire textures) are ignored: classified by UV against the fire_0/fire_1
  sprite rectangles, and a quad whose vertices straddle both is rejected.
- A partial quad (fewer than 4 vertices) must never turn into a label -> assembler drops it on reset.
- Entity type text must be JSON-escaped.

Found by the first in-game run (and fixed):
- `RaycastContext` in 1.16.5 builds a `ShapeContext` from its entity argument, so `null` throws an NPE. It was
  hit on every frame with visible block or entity fire, so those frames were (correctly) left out of the log
  instead of being written as "no fire". Now the camera entity is passed, and with no camera entity the frame is
  skipped explicitly. Lesson: a data-quality check should compare the number of frames with fire against what
  was actually on screen, not only look at the log's internal consistency.
- `Matrix4f.writeRowFirst` writes column-major, so every projection was transposed (pinned by `MatricesTest`).
- Fire blocks were never tracked: the chunk-builder hook (`BlockRenderManager.renderBlock`) is bypassed by Fabric's
  Indigo renderer. Tracking is now a scan of loaded chunk sections near the camera (every 15 frames, a section is
  only walked if its palette contains fire) plus an immediate hook on client `WorldChunk.setBlockState`; the old
  hook stays for setups without Indigo. A dev-only stats line (`tracked / evaluated / blockLabels`) makes a miss like
  this visible instead of silent.
- A one-time debug line (dev client only) prints the overlay's projection and hand matrices, to settle whether
  the overlay's low `vis` is real (few opaque texels on the visible part of the sprite) or a wrong matrix.

Not covered (documented): soul fire / soul-on-fire textures (different sprites), campfire flame texture, the
entity-in-GUI preview, and fire drawn by other mods.

### Schema v3 (supersedes the row shape above): one box per fire block / entity / overlay

A single rectangle around every fire on screen is a poor label when fires are far apart, and several entries for
one physical fire block (one per sheet/mirror variant) is awkward for detection training. So the frame-level
`box` is gone, and each source has ONE box, with the texture variants inside it as `parts`:

(v3.1: every row also has `"w":W,"h":H`, the game framebuffer size in pixels right after `f1`. All boxes are in
those pixels, so they can be scaled to whatever size the video was recorded or uploaded at; the window can be
resized mid-session, so it is per row, never a one-off header.)

`{"f":N,"tick":T,"f0":R0,"f1":R1,"w":2560,"h":1369,"fire":true,"fires":[`
`{"src":"block","pos":[x,y,z],"box":[x0,y0,x1,y1],"vis":0.62,"dist":3.25,"parts":[`
`{"sheet":0,"mirror":false,"row":17,"box":[...],"vis":0.43,"veil":0.0},{"sheet":1,"mirror":true,"row":1,"box":[...],"vis":0.18,"veil":0.75}]}`
(v3.2: `"veil"` follows `"vis"` in every source and every part: mean GUI alpha over the visible texels, 0..1;
a source's veil is the visible-texel-weighted mean of its parts.)
(v3.3: every row whose world was captured ends with `"cam":{"pos":[x,y,z],"view":[16],"proj":[16]}`: the camera's
world position and the view and projection matrices the labels were projected with, both row-major, values exact
(`Double.toString`). Block geometry lands at `proj * view * (world - pos)`, then the perspective divide and the
framebuffer size. View bobbing, hurt tilt and FOV changes (sprint, effects) are inside the matrices. It is the
answer key for camera solvers (perspective reversal). Rows without a capture have no `cam`.)
`]}`

- Source `box` = union of its parts' boxes (that one block's / entity's / overlay's fire). Source `vis` = visible
  opaque texels / opaque texels over all its parts. Parts are distinct `(sheet, mirror)` groups.
- `src` is `block` (with `pos`), `entity` (with `id`, `type`) or `overlay`. `dist` is 0 for the overlay.
- `fire` is true iff `fires` is non-empty. A frame with no fire: `"fire":false,"fires":[]`.
- Detection training uses `fires[].box`; fire-cracking analysis uses `parts[]` (which sheet, which row, mirrored).

Iteration 2 failure modes:
- Projection convention mixups (column vs row major, camera-relative vs world coordinates, y flipped between
  GL bottom-left and video top-left) -> tests project a quad with known geometry and assert pixel coordinates.
- Points at or behind the near plane (w <= 0) produce wild coordinates -> skipped, never clamped into the box.
- Quad partly off screen -> clamped to the screen, texels fully outside excluded; box never leaves the frame.
- Mirrored quads: UV winding flips which side of the quad shows which texel -> test with a half-opaque mask
  on normal vs mirrored quads and assert opposite sides.
- Degenerate/zero-area UVs or quads -> empty result, no NaN, no exception.
- Raycast cost per frame: occlusion is tested per 4x4 macro-cell and cached, so rays per quad <= 16.
- `fire:true` with an empty box (or the reverse) would corrupt the dataset -> `FrameRecord` derives both from
  the same blocks and a test pins that invariant.
- JSON number formatting must not depend on the system locale (`1,5` vs `1.5`) -> format with `Locale.ROOT`.
- Fire block set gone stale (burnt out, chunk unloaded) -> every tracked position is re-validated against the
  world before use.
- Matrices captured from the wrong render call (e.g. hand or GUI pass) would shift every box -> capture only
  in `WorldRenderer.render`, verified once in game with a debug overlay.

Occlusion model: opaque full-cube blocks block exactly (voxel ray cast per 4x4 texel cell); **entities block by
their hitbox** (segment vs axis-aligned box, `RayBox`). A burning entity is excluded for its own fire, and an entity
that contains the camera (your own body in first person) is ignored; invisible and spectator entities are skipped.

### GUI occlusion (iteration 2c): what the GUI really draws hides fire

The GUI (HUD, chat, menus, inventory, tooltips) covers the world, so fire under it must not count as visible. No
flag and no guessing from widget sizes: use what was actually drawn.

Method: the GUI is drawn into the same framebuffer after the world, and 1.16.5's GUI blending writes each drawn
pixel's own alpha (`blendFuncSeparate(SRC_ALPHA, ONE_MINUS_SRC_ALPHA, ONE, ZERO)`). So right after the world pass
(hand and on-fire overlay included) the framebuffer's **alpha channel is cleared to 0** (RGB masked), and after the
GUI the alpha channel is an exact coverage mask: glyphs and icons carry their real alpha, panels are opaque, dimmed
backgrounds are partial. At the end of the frame, **before** the strip and any debug boxes are drawn (they would
write alpha too), the alpha is read back for the screen rectangle around each fire source only (cheap), and texels
under the mask are removed from `vis` and from the boxes.

- **Revised after the first in-game run** (see "found by the first GUI run" below): the mask is `alpha 0..1`, not a
  yes/no. Only (near-)**opaque** GUI hides fire: a texel cell is hidden when at least 5 of 9 sample points in its
  on-screen box have alpha >= 0.98. A translucent GUI (a pause-menu or inventory veil, ~75% dark) does NOT hide fire:
  it can still be recognised, so it is recorded as data instead: each part and source gets `"veil"`, the mean GUI
  alpha over its visible texels (0 = nothing over it, 0.75 = a 75% dark veil), so the detector can be stress-tested
  against veil darkening. `veil` = alpha, i.e. how far the pixel was blended toward the GUI colour.
- This also covers the fire overlay itself being under the GUI; held items and the hand are NOT modelled (world pass).
- The label order in `FireLabel.onFrameRendered` changes: labels first, strip and debug boxes after.

Found by the first GUI run: alpha is only a faithful coverage value for draws that use the default GUI blend
`(SRC_ALPHA, ONE_MINUS_SRC_ALPHA, ONE, ZERO)`. The **vignette** blends `(ZERO, ONE_MINUS_SRC_COLOR, ONE, ZERO)`
(darkens only the screen edges) but its alpha part still writes the quad's alpha over the WHOLE screen, so every
region read looked covered and no fire was ever labelled (`blockLabels=0` for minutes). Fix: alpha writes are
switched off (`colorMask(true,true,true,false)`) while `InGameHud.renderVignetteOverlay` runs. Debug mode now also
logs the alpha at 5 fixed screen points, which should be ~0 with no GUI open; if not, another full-screen draw
writes alpha and must be masked the same way.

Failure modes:
- The framebuffer has no usable alpha channel, or some GUI draw masks alpha writes -> a **self-test** every session
  (clear alpha to 0, read a pixel, then a pixel the strip-less frame must still show as 0) throws if alpha cannot be
  cleared; the frame is then omitted loudly instead of silently labelled without GUI occlusion. A debug histogram of
  alpha values shows whether the HUD really writes alpha.
- glReadPixels stalls the pipeline -> only the rectangle around each source, never the full frame.
- Bottom-up row order of glReadPixels vs top-left pixel coordinates -> `AlphaMask.fromBottomUpRows`, tested.
- Reading after the strip/debug draw would see their alpha (clear colour alpha 1) -> reordered, asserted by structure.
- Bytes are signed in Java -> unsigned compare, tested.
- Coordinates outside the read rectangle or NaN -> "not covered", never an exception.
- Alpha cleared too early (before the hand) would let the hand's alpha leak in as GUI -> cleared after `renderWorld`.

Known limits (documented, not hidden): the hitbox approximation can hide fire that peeks around a thin model
(and a fire block under a standing mob is treated as hidden by that mob's box); the held item, particles and
translucent/non-full blocks do not occlude; far-from-camera fire beyond the tracked radius is not labelled; the box
is accurate to the texel projection, not an exact rasterisation of the GPU output (a pixel-exact mask pass is a later
option).

Structure for this iteration: pure, unit-tested core (`Projector`, `BBox`, `Quad`, `QuadVisibility`,
`FrameRecord` + JSON format) first; the Minecraft glue (matrix capture, fire tracking, quad extraction, block
raycast) after the internals have been checked in the real 1.16.5 code.

## Structure

- `...firelabel.core` (pure Java, no Minecraft imports, unit-tested): `StripPattern`, `Crc8`,
  `LabelLog`, `FrameCounter`.
- `...firelabel` (Minecraft glue, not unit-testable): client entrypoint, `GameRendererMixin`
  (draw strip + write label at end of render), `SpriteAccessor` mixin.

### Schema v4: per-quad screen geometry (additive; older readers ignore the new key)

Why: one box per (sheet, mirror) group is the hull of several overlapping quads, so a detector cannot be scored against exact geometry.
Each source gets an optional `"quads"` list, in DRAW ORDER (later quads are drawn over earlier ones):
`{"s":sheet,"m":0|1,"row":r,"c":[x0,y0,x1,y1,x2,y2,x3,y3]|null,"uv":[u0,v0,...,u3,v3],"vis":V,"veil":W}`
- `c`: the four corners projected to framebuffer pixels (top-left origin) in the quad's own vertex order, `null` when any corner is behind
  the camera; `uv`: the sprite-local texture coordinate (0..1, v = 0 is the sprite top) of each corner, same order; `m`: appears mirrored;
  `vis` = visible texels / opaque texels (as for parts), `veil` = mean GUI alpha over its visible texels.
- Only quads with at least one visible texel are written (hidden ones carry no evidence and would bloat the log).
- A source without visible quads has no `quads` key. Blocks, burning entities and the first-person overlay all write it.
Failure modes covered by tests: quad with a bad row / sheet / non-4 corners or uv / NaN or infinite numbers / visible > opaque; corners `null`
formats as `null`; list is copied (later changes cannot leak in) and immutable; empty list writes no key (old lines unchanged byte for byte);
numbers use Locale.ROOT (never a decimal comma); log lines stay valid JSON.
Size: roughly 3-5x the label log per frame with many fire blocks on screen (about 100 bytes per quad); the log is still one buffered line per frame.

## Must match the Rust codec exactly

`StripPattern` is a second implementation of the format that `core/src/sync.rs` defines. To keep them from
drifting, Rust generates `core/testdata/strip_vectors.txt` (strip pixel rows for several widths and ids) and
both sides test against that same file.

## How it could break (failure modes)

- Java and Rust disagree on cell rounding (the 5.33 px case) -> golden vectors across widths incl. 1280, 854.
- Framebuffer size differs from window size (HiDPI / fullscreen): use the framebuffer size, not window size.
- GL scissor origin is bottom-left; stamping at the wrong corner or mirrored -> draw at the top-left, and
  verify visually in game once.
- GL state left dirty (scissor test stays enabled) corrupts the next frame -> save/restore the scissor state.
- Frame id overflow (24 bits, ~77 h at 60 fps): wraps to 0; a decreasing id in the log is the marker.
- Label log I/O stalls the render thread: buffered writer, flush on close and periodically, never per frame.
- Log file not closed on crash/quit: flush every N frames and on client stop.
- Sprite internals differ from expectation (private fields, non-animated sprite): accessor returns -1, never throws.
- Mixin target names wrong for 1.16.5: caught at compile/launch; keep injections tiny.
- Strip drawn before HUD would be overpainted -> inject at the very end of `GameRenderer.render`.
- Recording only part of the screen (OBS crop) can cut off the top-left corner; document it.

## Tests (before implementation)

Pure Java (JUnit 5): golden strip vectors for 5 widths x 4 ids; CRC-8 check value; ids 0 and 0xFFFFFF accepted,
-1 and 0x1000000 rejected; widths < 480 give no strip; cell 0 white and cell 1 black; label line exact format;
label line for unavailable sprite (-1); log refuses writes after close, double close safe; frame counter
starts at 0, increments, wraps at 2^24.
Rust: the golden file equals what the codec generates now.
Not unit-testable (checked by compiling and one manual in-game look): the mixins and GL drawing.
