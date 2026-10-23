# Minecraft perspective-reversal tools, and our solver

2026-10-23. Goal: from a frame (or video) of Minecraft, recover the camera (eye position, yaw, pitch, FOV), so a 3D
fire block or entity fire can be placed and drawn back over the video as exact quads.

## Existing tools

| Tool | What it does | Method | Notes |
|---|---|---|---|
| [PerspectiveReverser](https://gaider10.github.io/PerspectiveReverser/) (gaider10) | You click image points and type their world coordinates; it fits camera position, yaw, pitch, FOV, image scale/crop, plus optional per-frame linear motion/rotation speeds across several frames. | Minimises squared pixel error with plain numeric descent (gradient, per-parameter step, random step). | Browser, JS. Minecraft conventions verified below. No licence file seen. |
| [MCV / MinecraftCV](https://github.com/rubyswolf/mcv) (rubyswolf) | Label points (edge detection helps) with world coordinates; solves camera pose and focal length; tick-boundary positions; SVG export. | Described as PnL / PnP from 2D–3D correspondences, OpenCV. | TypeScript/React web + Python/Flask/OpenCV. MIT. Built for the Dream MCC 11 parkour question. README: data API "not yet implemented, project is being left here". |
| [mc-locate](https://github.com/LAOUUUUU/mc-locate) (LAOUUUUU), camera mode | Screenshot plus 4+ tagged pixel ↔ block-corner pairs (coordinates read from F3). | Solver not stated. | Rust, MIT. Part of a seed/coordinate toolkit. |
| "Andrew's" perspective reversal | Not found. Searches only turn up unrelated people named Andrew. | | Needs a link or full name. |
| Texture-rotation base finder ([Laggy, video](https://www.youtube.com/watch?v=gXTN9DD_Cp0)) | You draw the block grid by hand and extrude faces. "Auto analyze" then reads each face's texture rotation variant, and a GPU search finds the absolute coordinates. | Texture rotation (it depends on the block coordinate) + brute force. | The only automatic part is reading the texture variants. It gives **absolute** coordinates and north, which vanishing points cannot. Website and GPU cracker linked from the video. |
| Pack.png seed reversal ([HN](https://news.ycombinator.com/item?id=24621303)) | One famous image, reconstructed by hand. | Camera fitted by regression; texture rotations and clouds used for position. | A one-off, not a tool. |
| F3 readers ([MC-Maps](https://github.com/KK-mp4/MC-Maps); mc-locate mode 3/13) | Read the F3 debug text with OCR. | OCR. | Automatic, but only when F3 is on screen. |

**Triple-checked on 2026-10-23:** I read each project's README and controls docs, and MCV's source tree and its demo video
([MinecraftCV](https://www.youtube.com/watch?v=3rxNn3sZg_4)). Every tool needs a person to put in the geometry.
- **MCV:** you draw axis lines by hand and type anchor coordinates. Its "optical optimization" snaps a line you drew to
  the nearest strong edge (whiskers, then a line fit), which makes it look automatic in the demo.
- **PerspectiveReverser:** you click points and type their coordinates.
- **mc-locate camera mode:** you tag pixels by hand. Its automatic modes read F3 text only.

None of them finds the lines or the correspondences by itself, and none tracks through a video.

## PerspectiveReverser, tested

Run inside its own page against its own `project` / `reverseProjection` code, with a known camera (eye
(10.37, 70.62, −3.21), yaw 32.4°, pitch 18.7°, FOV 70°, 2560×1440) and the projected corners of real block-grid
points as "clicks".

- **Conventions:** Minecraft's. The look direction lands at the image centre for yaw/pitch (0,0), (90,0),
  (30,20), (−120,−45); world up is screen up; the player's right is screen right. Scale matches our
  `overlay::project` (one block at 5 blocks = 205.65 px at FOV 70 on 1440p).
- **Default run (3,000 iterations from a guess 1 block / 6° / 10° FOV off):** does not converge. Gradient descent
  stops early: with 6 exact clicks the camera is 0.79 blocks, 1.5° yaw and 2.6° FOV off (42 px RMS over all
  corners). Per-parameter and random steps are similar or worse unless given 30 points.
- **Run to convergence (100,000 iterations, pressing "Reverse" until it stops changing):** exact. 6 exact clicks give
  0.017 blocks / 0.01° / 0.07° FOV with gradient descent, and exact recovery with per-parameter steps (47 presses,
  9.7 s). With ±0.5 px click noise and 12 points: 0.006 blocks, 0.004° FOV.
- **Verdict:** the model is right, but the optimiser is slow and needs many presses. It's fine for manual use if you
  press until the error stops changing. It's not suitable as an automatic solver.

## Ours: `fire_core::camera` + `fire_core::fire_model`

- **Geometry:** the fire block's baked quads, reproduced from the game's model files with 1.16.5's
  `BakedQuadFactory` rules (1.16.5 and 1.21.11 models are identical). Every attachment (floor, 4 sides, up) and
  variant, with per-corner UV.
- **Camera:** Minecraft's view transform (yaw + 180 about y, pitch about x, roll for bobbing/hurt tilt) and
  `overlay::project`. Damped least squares (Levenberg–Marquardt) on eye, yaw, pitch, roll, FOV. FOV is held when all
  points are on one plane (it cannot be separated from distance).
- **The reversal itself does not use fire:** `camera::solve(points)` takes any world point ↔ pixel pairs (block corners
  clicked on a frame, like PerspectiveReverser) and needs no starting guess (a yaw/pitch/FOV start grid anchored on
  the points' centroid at the distance their spread implies, run on all cores). Tests: 8 exact block corners give the
  camera to 0.001 for three very different cameras (incl. FOV 70 and 110, pitch −12° to 55°); 12 corners with ±0.5 px
  clicks give it within 0.1° / 0.3° FOV; fewer than 4 points give nothing; one block face holds the FOV and says so.
- **Fire is only the test harness for our existing recordings** (they log fire quads, not the camera):
  `fit_label_frame` uses the same start search on the logged fire quads:
  1. Start from a yaw/pitch/FOV grid, with the eye placed on the ray through the first fire at its logged distance.
  2. Pair corners by UV, and pick each quad's model plane by nearest projection.
  3. Drop at most 3 quads that disagree with the rest.
- **Answer key:** the label mod now logs each frame's exact camera (`"cam"`, schema v3.3). Recordings before that have
  no camera, so they are checked by how well the solved camera reproduces the logged quad corners (logged to 0.1 px),
  and independently by the logged fire distance.

### On our labelled recordings (no camera logged; checked against the logged quad corners and distances)

Sample: every 20th labelled frame of quad1 (181 frames):

- 97.2 % of frames reproduce every logged corner to ≤ 0.06 px RMS. That is the log's rounding, so the camera is exact.
- Median distance error 0.008 blocks against the mod's logged distances, which the fit never used.
- 17 ms per frame.
- The solved FOVs cluster at the game's exact values: 110.0 (the FOV setting), 121.0 (×1.1), 126.5 (×1.15 sprint) and
  139.1 (×1.265, sprint × speed). Roll stays within ±0.3° (view bobbing).

Full runs (every labelled frame):

| Recording | Frames | Exact (≤ 0.06 px) | ≤ 2 px | Median distance error | Time |
|---|---|---|---|---|---|
| quad1 | 3,602 | 97.1 % | 98.4 % | 0.007 blocks | 17 ms/frame |
| survival1 | 23,785 | 94.5 % | 96.4 % | 0.009 blocks | 38 ms/frame |

The rest are mostly frames where every logged quad is consistent with several cameras, or quads the log carries that
no single camera explains. Many of these are one-block frames. Frames with a single plane (FOV held) are 1–2 %.

A check that doesn't involve fire: the block grid of the ground under the player, projected through a solved camera,
drawn over the real video frame (`fire_camera --grid N`) lies on the ground plane with one cell per block.

## Next

- A manual reversal tool in FireCrackle: click block corners, type their coordinates, and `solve` runs through a WASM
  binding of `fire_core::camera` (like `veil.ts`). After that, place a fire block or an entity's fire and draw its
  quads over the video.
- New recordings carry `"cam"`, so `solve` on clicked corners can be scored against the true camera.

## Locating the fire block from the camera (`fire_core::fire_locate`)

Given a solved camera and a fire's box on screen, `locate` ranks every block near the ray through the box, with every
attachment (floor fire draws its 4 side planes too), by the left/right/bottom box edges. The top is not compared:
flame tips are transparent and animate.

Held-out test (`cargo run --release --bin fire_locate <labels.jsonl>`): the camera is solved from the other fire blocks
of the frame, then a fully visible fire (vis ≥ 0.95, box clear of the screen edge) is located from its logged box only.

| Recording | Fires | Same drawn outline (every edge ≤ 1 px) | Right block first | Right block in top 3 |
|---|---|---|---|---|
| quad1 (every 10th frame) | 151 | 39.1 % | 48.3 % | 72.8 % |
| survival1 (every 20th frame) | 600 | 36.2 % | 42.7 % | 70.0 % |

Best at 4–8 blocks (53–100 % same outline). Beyond 16 blocks a fire is a few pixels wide and depth is a guess.
Two kinds of miss can't be fixed from a box:
- a side fire and the neighbouring block's opposite-side fire are the same plane, 0.0012 blocks apart;
- a fire with two or more flammable neighbours draws several side planes; those combinations are not candidates yet.

**Decision:** placing the fire is manual. The locator's top 3 are offered as one-click suggestions.

## Plan: automatic zero-shot reversal from the video alone (2026-10-23)

The owner wants the camera solved automatically on any video, with no labels and no clicks, and manual clicking only
as the correction when the automatic answer is wrong.

**What exists:** none of the tools above solve automatically. PerspectiveReverser, MCV and mc-locate all need
pixel ↔ world-coordinate pairs typed in by hand, and so did the well-known community reversals (seed finding from
screenshots). A search for automatic Minecraft camera solving found nothing. The general technique for this, though, is
standard for man-made scenes:
- auto-calibrating a camera by clustering line segments into three orthogonal vanishing points
  ([Grammatikopoulos 2007](https://pcvg.geo.uniwa.gr/wp-content/uploads/sites/350/2022/12/Grammatikopoulos2007-An-Automatic-Approach-for-Camera-Calibration-from-Vanishing-Points.pdf));
- tracking those vanishing points through video ([Elloumi 2013](https://www.scitepress.org/Papers/2013/42141/)).

Minecraft suits this method unusually well: every block edge, and every texture-pixel edge, lies along one of the three
world axes.

**What the video alone can give:**
- Rotation: pitch, roll, and yaw modulo 90°.
- FOV.
- The eye's position within the block lattice: its fractional part per axis.

It cannot give the absolute block coordinates or which of the four 90° yaw turns is north, unless the F3 screen is
visible. A later option is texture-rotation cracking (the base-finder above): once the lattice is known, reading the
rotation variant of each grass, sand or stone face gives the absolute position and north. Neither is needed to draw fire over the video: the camera is solved in a local frame anchored at one visible
block, and the fire is placed in that same frame.

**Pipeline.** Every stage extends `fire_core`. The camera stages extend `fire_core::camera`; there is no second
solver.
1. **F3 shortcut.** When the debug screen is visible, read `XYZ`, `Facing` and the yaw/pitch from it. The result is the
   exact absolute camera. The F3 glyph and layout knowledge already lives in `gui_mask` (its debug-text mask): build the
   reader on that, not on a new font table.
2. **Segments.** Find straight edge segments in the world pixels only. Mask out the GUI and HUD with `gui_mask`, unveil
   with `veil`, and leave out the hand and held-item region. `fire_core` has no line detector yet: add one
   (`fire_core::lines`) and register it. `FireCrackle/src/lib/post/edges.ts` is a display effect, not a detector.
3. **Manhattan frame.** Use RANSAC over segment pairs to find the three orthogonal vanishing directions. From them, solve
   rotation and focal length (that is, FOV). Abstain when fewer than two directions are well supported, for example on
   sky, water or a flat field. With only one horizontal direction, keep the FOV from neighbouring frames.
4. **Lattice phase and scale.** With rotation and FOV fixed, fit the eye's fractional position so that the integer
   lattice planes fall on the segments.
   - **Problem:** texture-pixel edges lie on a 1/16 lattice, so scale is ambiguous by a factor of 16 (and by other
     factors).
   - **Fixes:**
     - weight block boundaries (colour or texture change across the edge, depth edges) above texture edges inside a
       face;
     - use the eye-height prior: standing on the ground puts the eye 1.62 above the floor block's top (1.27 sneaking);
     - use the known 16×16 texel pitch of a face as a check.
5. **Refine with the existing solver.** Turn lattice corners and lattice lines into correspondences, then run them
   through `camera::fit`. To do that, `fit` gets a point-to-line residual next to its point residual, so one solver
   handles clicks, logged quads and detected lines.
6. **Video.** Track the pose from frame to frame: rotation through vanishing-point tracking, and the lattice phase
   (including the integer offset) through continuity.
   - FOV is quantised: the video's single FOV setting × {1, 1.1, 1.15, 1.265, …}. Snap to it after the first confident
     frames.
   - Cuts are already known from hud-cadence and JoltCracker breaks. Reset tracking at each cut.
7. **Confidence and fallback.** Each frame gets a confidence score: inlier count, reprojection residual, and agreement
   with the track. Below a threshold, the frame is marked "needs manual". The manual click tool runs the same
   `camera::solve`, seeded with the automatic answer, so a correction is a few clicks rather than a full solve.

**Measuring accuracy, without the log as input.** The automatic pipeline reads only the video's pixels. The answer
key is used only for scoring:
- **Recordings made with the label mod from schema v3.3 on** carry `"cam"`, the exact camera for each frame. None
  exist yet: a short new recording is needed, covering walking, sprinting, looking around, a cave and open ground.
- **quad1 and survival1** come before v3.3. Their answer key is the camera that `fit_label_frame` solves from the log,
  on frames where it reproduces every logged corner to ≤ 0.06 px: 97 % and 94 % of frames are exact.

Per frame, against the answer key:
- **Rotation:** angle of the relative rotation, after removing the best 90° yaw turn. Also report how often the turn was
  right when F3 or another cue claimed to know it.
- **FOV:** error in degrees.
- **Position:** the eye error after removing the best integer block offset. Also report how often the offset found by
  tracking equals the best one; this is what fire placement needs.
- **End use:** put the logged fire quads in the automatic frame with the answer key's integer offset, and measure the
  pixel RMS against the logged corners. This is the "does the fire drawn over the video line up" number.
- **Coverage and abstention:** the share of frames answered, and the share of answered frames that are wrong (more than
  2 px end-use RMS). A wrong answer that claims confidence is the worst outcome; abstaining is acceptable.

All of these go in one evaluation bin, the same shape as `fire_camera` and `fire_locate`, run on every Nth frame of
each recording. Samples are checked by eye (grid overlay) before any full run.

**Order of work:**
1. The line detector and the Manhattan rotation + FOV, scored on rotation and FOV first: the cheapest, most certain win.
2. The lattice phase and scale.
3. Line residuals in `camera::fit`.
4. Video tracking and FOV snapping.
5. The F3 reader.
6. The WASM binding and the app's automatic overlay, with the manual correction tool.
