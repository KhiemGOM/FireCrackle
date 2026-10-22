# HUD cadence — control experiment, 2026-10-22

Question: does the once-per-second F3 FPS counter keep a constant phase in a continuous recording, and does a
splice show up as a phase jump? Answered with our own footage, where ground truth exists.

## Setup

- Game: Minecraft 1.21.11, Fabric, Sodium 0.8.14, `fire-detection/mod-hud` (overlay line identical in layout to
  the reference footage, frame-ID strip at the right, per-frame log of `System.nanoTime` and the displayed FPS).
  GUI scale 3, VSync off, framerate unlimited (a capped, steady FPS never changes and gives the method nothing to
  measure).
- Recording: OBS, 60 fps constant, **1920×1080 output of a 2560×1440 game** (unintended downscale, kept because
  it is what a 1080p upload looks like). Read with `--prescale 2560:1440`. F3 was opened mid-recording, which
  hides the overlay and the strip (a realistic gap).
- Clip: `fire-detection/data/video/2026-10-22 17-57-23.mkv`, 107 s, 6,424 frames. Mod log
  `run/hudinfo/03f8edca-….jsonl`. Results: `results/control-2026-10-22.json`.

## Reader vs ground truth

| | |
|---|---|
| Frames with the overlay readable | 6,221 of 6,424 (the rest: F3 open) |
| Worst digit template mismatch | 30 of 360 px |
| Strip readable | 5,867 of 6,424 |
| Logged FPS changes inside the captured range | 106 |
| Detected changes | 105: **98 exact frame, 0 off by one**, 8 missed (inside the F3 gap), 7 not matching a logged change (edges of the gap, where the value differs on reappearance) |

## The game's own grid (from the log)

`nanoTime mod 1 s` of every FPS update: **572 ms ± 1** for 101 of 106 updates. The five others (677, 848, 35,
609 ms, and the first) are updates rendered late after a stall; the grid itself did not move, the next update was
back at 572. This is the `nextDebugInfoUpdateTime += 1000` behaviour read straight off the clock.

## What the recorder does

- Video phase (frame index mod 60) of the true change frames: **13 for 97 of 98**, including straight through the
  F3 gap and the late renders. The one exception is the first change, rendered late while the recording started.
- An earlier draft of this report described a six-second stretch at phase 8 as "OBS falling behind". That was an
  artifact: an advancement toast covered the top-right strip for 368 frames, and the truth mapping guessed the
  far edge of the gap. With gap-safe mapping (changes inside an unreadable strip stretch are dropped) the phase is
  flat. The strip now lives at the bottom right, away from toasts.
- 68 duplicated frames (1.2 %) and no backwards IDs in the strip. At 745 fps the recorder captures one in ~12
  renderer frames; `skipped renderer frames` is expected, not a loss.
- Reader vs truth with the corrected mapping: 96 of 98 exact, 0 off by one, 2 missed (F3 gap), 9 detected
  changes without a usable truth frame (gap edges).

## Splice test

A copy with 3.4 s removed at 50.0 s (`ffmpeg trim/concat`, re-encoded): `results/spliced-3.4s-2026-10-22.json`.

```
Jump at frame 3049 (50.82s): shift -24 frames
```

3.4 s mod 1 s = 0.4 s = 24 frames, phase 13 → 49. Exactly the cut, nothing else flagged. (A cut of a whole number
of seconds ±1 frame would be invisible to this check; that is the method's blind spot.)

## Consequences for the reference footage

- The reader and the phase maths are validated on identical geometry (3-px glyphs, 60 fps), including from a 1080p
  downscale.
- In this control the recorder never shifted the phase at all. The persistent shifts in the reference file
  (1023.5 s, −19 frames; 2858.5 s, +13 frames in the 81-minute span) therefore have no recorder explanation yet.
  They are still not proven cuts: a longer control recording, and one under heavy load, are needed to see whether
  OBS ever shifts phase on its own.
