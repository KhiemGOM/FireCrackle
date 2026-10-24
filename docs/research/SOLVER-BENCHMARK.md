# Camera solver benchmark: ours vs PerspectiveReverser, MCV, mc-locate

2026-10-25. Question: given the same clicked block corners, which solver gets the camera right, and does a fire placed
away from the clicks line up? Every solver gets identical inputs; each is scored the same way.

## Cases

One file, `cases.json`, written by `cargo run --release --bin fire_solver_bench -- cases OUT.json`
(`fire-detection/core/src/bin/fire_solver_bench.rs`). The truth camera and every pixel come from
`fire_core::camera::Camera::project` (the game's projection).

**Synthetic** (2560×1440, roll 0; FOV from {70, 90, 110, 126.5}, pitch −30° to 55°, any yaw; the ground is y = 0,
the eye 1.62–7.62 above it). Corners are integer block corners in front of the camera, 3–28 blocks away and at least
20 px inside the frame, picked spread out on screen the way a person would click them.

| Layout | Clicks | Held-out (scored, never given to the solver) |
|---|---|---|
| `spread` | n ∈ {4, 6, 8, 12} at three or more heights | a fire block's 8 cell corners among the clicks |
| `plane` | n ∈ {4, 6, 8} all on the ground (y = 0) | a fire block's 8 corners on the ground among the clicks |
| `plane-far` (the owner's frame) | n ∈ {4, 6} on the ground inside a 9×9 patch | a fire block 15–20 blocks from the patch and 5 below it |

Click noise: Gaussian σ ∈ {0, 0.5, 1} px. 20 cases per (layout, n, noise); fixed seeds.

**Real cameras** (quad1, survival1): keyed frames whose label-log camera (`fit_label_frame`) reproduces every logged
corner to ≤ 0.06 px. Clicks: n ∈ {4, 8} corners of the logged fire blocks' cells, through that camera, σ = 1 px.
Held-out: the logged fire quad corners at the pixels **the game drew** (not re-projected). This is the "does the fire
line up" number.

### Format

Pixels: x right, y down, (0, 0) the top-left corner of the frame (not the centre of the first pixel); the frame centre
is (w/2, h/2). World: Minecraft blocks, y up. Camera: eye x y z, yaw / pitch / roll (degrees; yaw 0 looks +z, yaw 90
looks −x, positive pitch looks down), vertical FOV (degrees).

```json
{"cases": [{"id": "plane-4-n0.5-007", "kind": "synthetic", "layout": "plane", "n": 4, "noise": 0.5,
  "w": 2560, "h": 1440,
  "truth": {"x": 0, "y": 0, "z": 0, "yaw": 0, "pitch": 0, "roll": 0, "fov": 70},
  "guess": {"yaw": 0, "pitch": 0, "fov": 70},
  "clicks": [{"world": [0, 0, 0], "px": [1280.3, 900.1]}],
  "heldout": [{"world": [3, 0, 4], "px": [1500.0, 1000.0]}]}]}
```

`guess` is the truth with automatic-guess-sized errors (σ 0.7° yaw/pitch, 2° FOV), for solvers that start from a guess
(ours, guided). A solver that takes no guess ignores it.

Each solver writes `answers-NAME.json`:

```json
{"solver": "NAME", "version": "commit or URL", "answers": [{"id": "...", "ok": true, "ms": 12.5,
  "camera": {"x": 0, "y": 0, "z": 0, "yaw": 0, "pitch": 0, "roll": 0, "fov": 70},
  "clicks_px": [[1280.1, 900.0]], "heldout_px": [[1500.2, 1000.4]], "note": ""}]}
```

`heldout_px` and `clicks_px` are projected **by the solver's own model**, so the pixel scores need no convention
conversion. `camera` is converted to the convention above (null when that is not possible); it is used only for the
camera-error columns. `ok: false` with a `note` for no answer (too few points, refused, crashed, timed out).

`fire_solver_bench score CASES.json ANSWERS...` prints, per (kind, layout, n, noise) and solver: answered %, held-out
RMS px (median, p90), held-out ≤ 2 px %, click RMS, eye error (blocks), rotation error (°), FOV error (°), time.

## How this benchmark could mislead, and the checks against it

- **A convention bug in an adapter looks like a bad solver** (pixel-centre offset, y up/down, yaw sign, horizontal vs
  vertical FOV, aspect). Each adapter must first reproduce noise-free `spread` cases to ≤ 0.01 px on the clicks; until
  it does, the adapter is wrong, not the tool.
- **Starting points.** Each tool runs from its own default start, as a person would use it. Ours is reported both
  clicks-alone (`solve`) and with the guess (`solve_guided`, the app's path); the guess is simulated.
- **PerspectiveReverser's iteration budget** decides its result: it is run at its default and to convergence.
- **Coplanar clicks:** a tool may refuse or hold the FOV (ours `solve` holds it at 70°). Recorded as it behaves.
- **Randomness:** fixed seeds; a tool with random steps is run as is and noted.
- **Real-frame truth** is a solved camera (exact to the log's 0.06 px rounding), not a logged one: no recording has
  `"cam"` yet.

## Results (2026-10-25; 772 cases: 540 synthetic, 232 from 118 real frames)

Held-out RMS px, median / p90, and the share of cases within 2 px. A case with no answer counts as a miss (—).

| Solver | spread (240) | plane (180) | plane-far (120) | real, 4 clicks (118) | real, 8 clicks (114) | ms p50 |
|---|---|---|---|---|---|---|
| **ours, guided** (the app's path; simulated guess) | 0.18 / 0.65 (99 %) | 0.30 / 0.96 (100 %) | 1.36 / 5.8 (63 %) | 1.25 / 2.4 (82 %) | 0.87 / 1.5 (96 %) | 5 |
| ours, clicks alone (`solve`) | 0.21 / 0.73 (97 %) | 87 / 227 (22 %) | 58 / 305 (16 %) | 2.05 / 9.2 (48 %) | 1.01 / 1.7 (94 %) | 5 |
| ours, clicks alone, FOV fitted on one plane (experiment) | 0.21 / 0.73 (97 %) | 0.29 / 1.0 (98 %) | 1.62 / 11 (55 %) | 2.01 / 8.3 (49 %) | 1.01 / 1.7 (94 %) | 5 |
| MCV (Python backend, points only) | 0.29 / — (80 %; 83 % answered) | 1.24 / — (52 %; 54 % answered) | 2.43 / — (48 %; 88 % answered) | 1.98 / 8.3 (50 %) | 1.06 / 2.2 (85 %) | 150 |
| MCV web path (as it would compute) | 0.45 / 7.5 (74 %) | 0.58 / 3.7 (80 %) | 1.88 / 15 (52 %) | 1.98 / 8.2 (50 %) | 1.06 / 2.3 (84 %) | 1,400 |
| mc-locate (FOV typed 70, solved with 6+ points) | 0.31 / 88 (78 %) | refuses all | refuses all | 39 / — (4 %) | 1.01 / 1.7 (94 %) | 0.2 |
| mc-locate, guess FOV typed | 3.8 / 16 (29 %) | refuses all | refuses all | 2.4 / — (43 %) | 1.26 / 6.1 (70 %) | 0.2 |
| mc-locate, **true** FOV typed (information no other solver has) | 0.19 / 0.61 (98 %) | refuses all | refuses all | 1.45 / — (70 %) | 0.91 / 1.5 (98 %) | 0.2 |
| PerspectiveReverser, one press from its start | 224 / 808 (0 %) | 152 / 1,009 (1 %) | 264 / 812 (0 %) | 125 / 518 (0 %) | 122 / 445 (0 %) | 4 |
| PerspectiveReverser, pressed until converged (≤ 3,000 presses) | 201 / 866 (28 %) | 85 / 929 (34 %) | 141 / 545 (28 %) | 50 / 595 (13 %) | 29 / 296 (25 %) | 6,700 |
| PerspectiveReverser, converged from the guess | 0.18 / 0.69 (98 %) | 0.30 / 1.0 (99 %) | 1.08 / 8.0 (64 %) | 1.96 / 492 (51 %) | 0.97 / 99 (80 %) | 1,360 |

**Findings.**
- **Same model, same answer.** Every tool's projection is Minecraft's (each adapter reproduces noise-free clicks to
  ≤ 1e-5 px). Where they converge with the FOV free, ours, mc-locate and MCV reach the same camera to every printed
  digit, and PerspectiveReverser from a good start matches too. The differences are robustness and speed.
- **Ours, guided (the app) is the best overall**: best or tied in every column but plane-far, and 5 ms.
- **Clicks on one plane: our clicks-alone `solve` was broken.** It held the FOV at 70° ("FOV cannot be separated from
  distance"), which is false for a plane seen at an angle, and then could not even fit the clicks (68–100 px). Fitting
  the FOV there (the experiment row) gives 0.29 px, the same as MCV's 4-point path and the guided solve. mc-locate
  refuses every coplanar layout; MCV with 5+ points often finds no answer (its RANSAC focal scan misses).
- **A fire far from every corner and off their plane (`plane-far`, the owner's frame) is hard for every solver**:
  best medians 1.1–1.6 px with a p90 of 6–11 px. That is the layout's limit, not a solver's. Corners near the fire's
  level fix it (a 4-ground-corner + 2-at-the-fire's-level simulation: 0.1–0.5 px).
- **PerspectiveReverser**: right model, weak optimiser. From its own start it almost never converges; from a good
  start it matches ours at ~250× the time, with a heavy tail on real frames (cameras mirrored behind the clicks: it has
  no in-front check and no roll).
- **mc-locate**: fastest (0.2 ms) and exact, but the FOV is typed unless there are 6+ points, and coplanar clicks
  are refused.
- **MCV**: only its point mode was measured; it also refines with drawn edge lines, which this benchmark doesn't give.

**Fairness notes** (from the adapter runs): PerspectiveReverser's default start is eye (0, 0, 0), yaw 0, FOV 70, far
from real coordinates, so its default rows are a floor; its guess-start rows get the guess plus an eye 10 blocks back
from the clicks' centroid. MCV's FOV search tops out at 133.6° (25 real cases are above, up to 139.3°), and the
adapter removes a 0.5 px offset that real MCV use carries. mc-locate fits roll freely. Times come from different
harnesses (MCV and PerspectiveReverser ran sharded in parallel, which inflates them).

**Reproduce.** Clone each tool at the commit above, then:
- `fire_solver_bench cases cases.json --per 20 --real fire-detection/data/joined/quad1.jsonl --every 25 --limit 60
  --real fire-detection/data/joined/survival1.jsonl --every 350 --limit 60`, `fire_solver_bench ours cases.json DIR`;
- adapters (our wrappers only; no third-party code) in `docs/research/solver-benchmark-adapters/`:
  - PerspectiveReverser (7cba395): `node build_verbatim.js PATH/js/main.js` writes `tool_verbatim.js`; `run.js`.
  - MCV (ef4bec1): copy lines 435–949 of `build/pipeline/pythonStandalone.template.py` to `mcv_solver_verbatim.py`;
    venv with opencv-python 4.10.0.84 and numpy 1.26.4; `python -I run_mcv.py CASES OUT [--web]`.
  - mc-locate (ca0d694): copy `src/pose.rs` lines 1–911 into `src/` without the two `use crate::session/ui` lines;
    `cargo build --release`; `mc-locate-bench-adapter CASES OUT --variant unknown|known|guess`.
- `fire_solver_bench score cases.json ANSWERS... --csv all.csv`.
