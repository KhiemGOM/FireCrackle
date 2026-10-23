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
