# hud-cadence

Finds places where a Minecraft recording is not continuous, using the on-screen FPS counter.

Minecraft's F3 FPS value (and any overlay mod that shows it) updates once per second on a fixed grid of the
game's clock:

```java
while (now >= nextDebugInfoUpdateTime + 1000L) { currentFps = fpsCounter; nextDebugInfoUpdateTime += 1000L; ... }
```

The grid is never re-based, so lag cannot move it. In a constant-rate recording the frame where the number
changes therefore lands on the same frame-within-the-second, every second, for the whole recording. A cut
that removes anything other than a whole number of seconds shifts that phase permanently. `hud-cadence`
reads the number on every frame, finds the change frames, and reports every phase jump, ranked by how much
the value changed at that boundary, so each one can be checked by other means.

What it is validated against (see [REPORT.md](REPORT.md)): a control recording with a frame-ID strip and a
per-frame game log (reader exact on 96 of 98 changes, 0 off by one; game grid 572 ms ± 1), and a 3.4 s splice
found as exactly −24 frames. Known blind spot: a cut of a whole number of seconds (±2 frames) is reported as
drift or not at all. A capped, steady FPS gives nothing to measure.

## Install

Needs Rust (stable) and an `ffmpeg` executable. For AV1 recordings use a build with `libdav1d` (the gyan.dev
"full" build on Windows), it is about twice as fast as libaom.

```
git clone <this repo> hud-cadence
cd hud-cadence
cargo build --release
```

The binary is `target/release/hud-cadence` (`.exe` on Windows).

## Use

```
hud-cadence find VIDEO --ffmpeg PATH/TO/ffmpeg [--scale 3] [--fps 60] [--prescale 2560:1440] [--out report.json]
```

- `--scale`: the GUI scale the game was rendered at (3 = each font pixel is 3×3 video pixels at 1440p).
- `--fps`: the recording's frame rate (the period of the phase, in frames).
- `--prescale W:H`: when the recording or upload is smaller than the game's render size (a 1080p upload of a
  1440p game), scale every frame back to the game size before reading, otherwise the glyphs are not integer-sized.
- `--start S --duration S`: analyse a window instead of the whole file.

Output is a ranked table, highest |ΔFPS| first:

```
rank  kind          time      frame   shift  before  after   |d|  note
   1  Jump   00:17:03.467     61408     -19     103    120    17  phase moved -19 frames and stayed: not continuous here
   2  Value  00:48:12.633    173558             231    159    72  largest value swings (top 1 %): no phase change, listed for cross-checking
   3  Gap    00:00:00.000         0                                overlay unreadable for 271 frames (4.5 s)
```

- **Jump**: the phase moved by three frames or more and stayed. The video is not continuous at this frame.
- **Drift**: one or two frames. Recorders do this on their own (dropped/duplicated frames); it is also what a cut
  within two frames of a whole second looks like, so it is listed but not conclusive.
- **Value**: the largest 1 % of second-to-second value changes at ordinary boundaries. Not evidence by itself
  (natural swings in gameplay reach p99 ≈ 270 fps); listed so a hidden whole-second cut between very different
  scenes can be cross-checked.
- **Gap**: the overlay was unreadable for more than a second (F3 open, menu, occlusion). The phase is tracked
  separately on each side; a different phase after a gap is not called a jump.

`--out report.json` writes the findings as JSON **and** the same table to `report.json.txt`. The JSON holds no
per-frame data unless you add `--dump-values` (then `report.json.values.json` is written too, large).

**Got a JSON and want the table back?**

```
hud-cadence report report.json
```

prints it (Jumps first, in time order, then everything ranked by |ΔFPS|). If the file still contains every
frame's reading (`values`: reports from older builds, or `--dump-values`), the findings are recomputed with the
current rules first, so old reports pick up newer flags such as `UNSTABLE READINGS`.

Two flags to read before trusting a Jump: **UNSTABLE READINGS** means the digits flicker in that stretch
(something drawn over them, or a glyph at the edge of the template margin); phase findings there are not reliable.
**PARTIAL READ** means one reading is a prefix/suffix of the other (`367` vs `36`): a covered digit, not a swing.

Speed: about 300 frames/s on a 1440p60 AV1 file with dav1d (decode-bound), so an hour of video takes ~12 min.

## What it reads

The vanilla Minecraft font (`assets/ascii.png` from the game jar) at an integer GUI scale. It looks for the
text `FPS: ` and reads up to four digits after it, on the top-left 1500×40 px of each frame (`--prescale`
applies first). It copes with a dimmed overlay (inventory/pause tint) and with the label being covered while
the digits are intact. Other overlays with a different label would need a different anchor string.

## Other commands (research)

```
hud-cadence sweep  VIDEO --ffmpeg F [--scale 3] [--out sweep.json]
hud-cadence scan   VIDEO --ffmpeg F --start S --duration S [--fps 60] [--strip bottom-right --width 2560] [--prescale 2560:1440] [--out scan.json]
hud-cadence report report.json
hud-cadence replay scan.json
hud-cadence truth  scan.json --log <run/hudinfo/session.jsonl>
hud-cadence labels scan.json --log <run/hudinfo/session.jsonl> --out <dir> [--source VIDEO --ffmpeg F]
```

`sweep` decodes keyframes only and lists where the overlay is readable. `scan` is `find` for a window with the
phase histogram and, with `--strip`, decodes the frame-ID sync strip drawn by the companion control mod
(`mod-hud`, a Fabric 1.21.11 mod that draws the same overlay plus a strip and logs every rendered frame).
`truth` compares detected changes with that log; `labels` writes per-frame label files and frame-exact cuts of
the usable segments. `results/` holds the control and splice runs the report is based on.
