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
| quad1 (every 10th frame) | 169 | 39.1 % | 47.3 % | 74.0 % |
| survival1 (every 20th frame) | 906 | 37.0 % | 44.6 % | 71.5 % |

Best at 4–8 blocks. (Rerun 2026-10-23 with the committed held-out filter; an earlier draft of this table came from a run before it.) Beyond 16 blocks a fire is a few pixels wide and depth is a guess.
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

## Stage 1 built: rotation and FOV from the picture (`fire_core::lines`, `fire_core::reversal`)

**How it works:**
- **Segments.** `lines::segments` is an LSD-style detector. It grows regions of pixels whose gradient directions agree
  within 22.5°, strongest first, and takes each region's principal axis as its direction. Minecraft draws without
  antialiasing, so a slanted edge is a staircase, and single-pixel or small-window gradients sit near 0°/90°. The
  region's axis still gives the true direction.
  - The first version used structure-tensor pixels. At the true camera, 42 % of those pixels were more than 6° off,
    and the answer was biased by 1–1.5°.
- **Score.** `reversal::orientation` scores a rotation + FOV by the length of segments that point at one of the three
  axis vanishing points (Coughlan & Yuille's "Manhattan world"). Each segment's own direction uncertainty
  (1.5 px / length) is part of its kernel.
  - The search starts from a coarse grid (yaw 0–90 in 3° steps, pitch ±88° in 4° steps, FOV 40–140), then runs a
    pattern search with a narrowing kernel.
  - It then refines the classic confusions (yaw + 45°, the 90° pitch swap, FOV × 0.6 / × 1.4), so the reported
    `margin` over the best rival more than 5° away is honest.
- **What the real recordings forced:**

  | Change | Why |
  |---|---|
  | Hand zones left out (bottom corners) | The first-person arm and held item are big boxes drawn with their own projection. |
  | Segments shorter than 16 px dropped | Netherrack and lava texture noise. |
  | Weight capped at 60 px | A few long non-world edges must not outvote the world. |
  | Segments within 1° of exactly screen-horizontal/vertical count ×0.1 | Screen-space drawing: menus the GUI mask missed, chat, the label mod's debug overlay. Random videos add facecams, subtitles and logos. Otherwise they pull the answer to a level, axis-aligned camera with a narrow FOV. |
  | Roll limited to ±6° | A larger roll is how a 90° pitch swap fakes a fit. |
  | FOV floor 45° | |

  The GUI comes from the shared mask: `GuiDetector::detect` + `add_screen_masks`, as in `pov`.
- **Synthetic tests** (`tests/reversal.rs`, `tests/lines.rs`) use ray-cast block worlds with 16×16-texel faces at
  1080p. They cover exact rotation/FOV, yaw modulo 90°, masked GUI, the arms, text, compression blocks, blur and noise,
  flat frames, the level-axis case (FOV unknown) and bad sizes.
  - These worlds are easier than the real recordings. Every real-data failure above passed the synthetic test written
    for it, so **the evidence for those changes is the recording evaluation below, not the unit tests.**

**On the recordings** (`fire_reversal`; the reversal reads only the video frame; the answer key is `fit_label_frame` on
frames where it is exact; rotation error after the best quarter turn of yaw; sample every 20th / 120th keyed frame):

| Recording | Frames | Clear (margin ≥ 0.1) | Clear: rotation p50 / p90 | ≤ 0.5° / ≤ 2° | Clear: FOV error p50 / p90 | All answers: rotation p50 | Time |
|---|---|---|---|---|---|---|---|
| quad1 (nether, 1080p) | 174 | 55 % | 0.42° / 1.79° | 55 % / 92 % | 0.75° / 2.85° | 0.60° | 270 ms |
| survival1 (nether + overworld, 1080p) | 182 | 56 % | 0.27° / 0.97° | 75 % / 96 % | 0.39° / 2.01° | 0.47° | 170–330 ms |

**What remains, and where it is fixed:**
- **4–8 % of clear answers are more than 2° off.** Example: riding a strider (survival1 frame 5031), where the mount's
  box edges dominate and the answer is the strider's yaw. Fix: tracking (stage 4). Things that move with the camera
  (mount, hand, overlays) are screen-static while the world moves.
- **The 90° pitch swap.** Near axis-aligned yaw, pitch p and p − 90° explain the edges equally (margin 0). This is
  flagged, never guessed, and resolved by tracking once the yaw moves off the axis.
- **Low-information frames** (dark netherrack, lava, sky) are flagged ambiguous or not answered.
- **Precision** is about 0.3–0.4° median. Drawing fire to within a pixel needs about 0.05°, which comes from stage 2–3:
  lattice correspondences through `camera::fit`.

## The assistant: automatic guess + a few clicks (`camera::solve_guided`)

The owner's target is the 3D quad, not zero-touch reversal, so the automatic answer is a starting guess that a few
clicked block corners correct.

**How `solve_guided` works:**
- For each quarter turn of the guessed yaw, the eye is solved linearly from the clicks with the rotation and FOV held.
  Each click gives two equations, and the optional eye height gives one more.
- Then everything is refined with a soft prior keeping the angles near the guess (0.5°, FOV 2°). This uses the existing
  Levenberg–Marquardt with prior residuals.
- Answers are ranked by click error plus prior cost, so a wrong quarter turn cannot win by bending the rotation.
- With 4+ clicks that don't lie on one plane, the clicks-alone `solve` is offered too. It goes first only when the
  guided answer misses the clicks by more than 3 px, meaning the guess was wrong.
- Coordinates can be relative: the first clicked corner can be called (0, 0, 0).

**Scoring.** Clicks are simulated: corners of the logged fire blocks, at their base and one block up, projected
through the answer key with ±1 px of wobble. Every logged fire quad corner of the frame is then compared under the
guided camera. Same samples as above.

| Recording | Guess + 2 clicks | Guess + 3 | Guess + 4 | 4 clicks, no guess | 1 click + eye height (best of 4 turns) |
|---|---|---|---|---|---|
| quad1 p50 / p90 px (≤ 2 px) | 6.7 / 74 (36 %) | 3.2 / 49 (45 %) | 1.8 / 39 (51 %) | 3.1 / 1380 (43 %) | 24 / 225 (29 %) |
| survival1 | 2.0 / 49 (51 %) | 1.6 / 32 (55 %) | 1.2 / 18 (66 %) | 2.3 / 21 (43 %) | 10 / 207 (21 %) |

**Reading:**
- The guess makes 4 clicks better than 4 clicks alone: 1.2–1.8 px median against 2.3–3.1 px. A few noisy clicks fit
  a wrong camera too well, and the soft prior stops that.
- With 2 clicks the guess's remaining rotation error (0.3–0.6°, a few px) shows; a third or fourth click removes most
  of it.
- The p90 tail is frames where the guess itself was wrong (ambiguous frames). There, the tool should ask for more
  clicks or show the alternatives.
- One click + eye height is weak: a wrong eye height or a tiny baseline leaves too much free.
- The simulated clicks sit on the fire blocks, close together. Real clicks spread across the frame will do better,
  and a ±1 px click is about what a person manages at 1:1 zoom.

**Tests** (`tests/guided.rs`): exact guess + 2 corners gives the exact camera; the clicks pick the quarter turn; a
0.5°-off guess places a fire within a few px; 1 corner needs the eye height; enough clicks override the 90° pitch swap;
click noise; degenerate input; points in front.
- One test was changed after the implementation: "5 exact clicks give the exact camera despite a 0.5°-off guess". The
  soft prior that wins on the real recordings keeps such an answer about 0.3° towards the guess. The test now asks that
  the guided answer place a held-out fire at least as well as the clicks alone, with realistic 0.7 px noise.

## 3D quad tool, redesigned and tested on a real frame (2026-10-24)

The first version passed every test but was unusable. The owner's review:
- it drew the 2D quad mask instead of its own quads;
- it had "+ fire / soul / entity" spawn buttons, although there are three modes and soul fire is the atlas;
- the controls were a pile on the left;
- nothing on the picture let you check the camera;
- the 3D view was an empty grid.

The redesign:
- **3D quad is its own Label tool** (toolbar, D). It draws its own planes, textured with the chosen sprite; the quad
  mask is off while it is on. The two share the sprite settings.
- **One fire, three modes,** each with its own coordinate entry: fire block (block x y z), burning block (cell +
  faces, defaulting to the side away from the camera), entity fire (feet x y z + entity type). Place by click lands
  on the floor plane.
- **Corners are typed where they are added:** the newest corner's x y z editor opens in the bar. The bar is two
  fixed rows (Sprite | Fire, Camera), so the picture never moves under the cursor.
- **The picture shows a block grid and the fire's cell (or hitbox) wireframe** to judge the camera by.
- **The 3D overview shows the player** whose eye is the camera (box model, `camera::player_boxes`), its view cone
  (`camera::view_cone`), the fire and the corners.

**Real-frame test** (quad1 frame 1367, 1920×1080):
- Five corners clicked on the floor around two fires (their footprint corners), positions typed relative to the
  first.
- The solved camera matches the answer key (`fit_label_frame`):
  - eye within 0.003 blocks;
  - yaw 0.03°, pitch 0.06°, FOV 0.12°;
  - corners fit to 0.03 px.
- The fire block placed one block over lands on the game's real fire: its 32 plane corners are 0.33 px median,
  0.54 px max from where the game drew them.

Bugs found by using it, now fixed:
- adding a corner made the bar wrap and moved the picture under the cursor;
- the status asked for more corners when it needed typed positions;
- there was no way to clear corners;
- at a narrow window the overview squeezed the video to zero width;
- a stale "solved" status remained after Clear.

**Guided solve prior loosened** (angles 0.5° → 1.5°, FOV 2° → 5°): the automatic guess is often 1–2° off even when
confident, and five exact corners on one plane could not overcome a 0.5° hold.
- Real frame: fire corner error 4.6 → 0.33 px.
- Simulated noisy clicks (±1 px on fire-block corners): 4 clicks 1.8 → 1.8 px median (quad1) and 1.16 → 1.31 px median
  but a 12 px rather than 18 px p90 (survival1).
- A version that let 4+ corners override the guess almost entirely was worse (4-click quad1 median 2.3 px, p90 155 px)
  and was dropped.
