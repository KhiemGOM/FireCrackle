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

## Hidden cuts: how close to a whole second must a cut be to pass?

Same control clip, a cut at 50.0 s of exactly 3.000 s and of 3 s plus 1, 2, 3 and 6 frames:

| Cut | Result |
|---|---|
| 3.000 s | nothing flagged: the blind spot is real |
| 3.000 s + 1 frame | `Drift −1` (a persistent one-frame shift, classed as recorder drift) |
| 3.000 s + 2 frames | `Drift −2` |
| 3.000 s + 3 frames | **`Jump −3`** |
| 3.000 s + 6 frames | **`Jump −6`** |

So an edit is flagged as a cut when it is at least 3 frames (50 ms) away from a whole number of seconds; within
±2 frames (±33 ms) it is reported as drift, which the reference file also shows naturally, so it cannot be
distinguished. An editor who trims on exact 1-second multiples at 60 fps is invisible to this check.

## Could the FPS value itself expose a hidden cut?

Second-to-second changes of the displayed value in the reference footage (6,515 changes across the scanned
spans): |ΔFPS| p50 = 10, p90 = 93, p95 = 139, p99 = 268, p99.9 = 425, max = 510; relative to the previous
value p90 = 0.40, p99 = 1.2 (the max, 173×, is a stall second at ~1–3 fps). A cut between two ordinary scenes
produces a jump of the same order as natural variation, so a value threshold is not a detector: at |Δ| > 425
it would still raise one false flag per ~1,000 s and miss most cuts. The stronger whole-second-cut check is
continuity of the overlay's own XYZ and yaw fields (a position can only move so far in one frame); that is
future work for the reader.

## Consequences for the reference footage

- The reader and the phase maths are validated on identical geometry (3-px glyphs, 60 fps), including from a 1080p
  downscale.
- In this control the recorder never shifted the phase at all. The persistent shifts in the reference file
  (1023.5 s, −19 frames; 2858.5 s, +13 frames in the 81-minute span) therefore have no recorder explanation yet.
  They are still not proven cuts: a longer control recording, and one under heavy load, are needed to see whether
  OBS ever shifts phase on its own.

## Reference footage: full scan, cross-checked with two other methods (2026-10-22)

`hud-cadence find` over the whole 2 h 36 min file (561,619 frames, overlay readable on 81.4 %):
3 Jumps, 488 Drifts, value swings and gaps. Jumps:

| Cadence Jump | Shift | Readings | JoltCracker 2.5 `removed` break | FireCrackle fire-phase flag |
|---|---|---|---|---|
| 0:12:21.85 (frame 44,511) | −4 frames | 92 → 113 | none (nearest 279 s away; Jolt's run 1:41–17:01 is continuous) | none (overlay fully readable, no flag) |
| **0:17:03.47 (frame 61,408)** | **−19 frames** | 103 → 120 | **0:17:01.17–0:17:03.48, jump 0.284 s ≈ 17 frames** | none (no fire labels there) |
| **0:47:38.53 (frame 171,512)** | **+13 frames** | 231 → 221 | **0:47:36.62–0:47:38.30, jump 0.767 s ≈ 46 frames ≡ +14 mod 60** | none (no fire labels there) |

Two independent signals (hunger/heart-bar ticks in Jolt; the FPS counter's 1-second grid here) agree on the same
two frames, and the sub-second amounts agree within 1–2 frames. Jolt's third break (0:01:37.83–0:01:41.38,
0.25 s) is before the overlay appears (8:26), so the cadence cannot speak to it. The −4-frame jump at 0:12:21.85
is cadence-only: a 67 ms removal may be below Jolt's resolution, or it is something else; unconfirmed.

FireCrackle's 17 fire-phase flags (1:03–2:36, where fire labels exist) have **no cadence Jump within ±3 s**, and the
overlay was fully readable around every flag before 2:34. In particular the soft `PhaseShift`s at 1:21:47,
1:25:40, 1:48:01 and 2:00:05 are not video cuts by this measure: the FPS grid runs straight through them, so they
are game-side (lag, reload, dimension change) rather than edits. Files: `results/find-recovered-video-2026-10-22.json`,
`results/jolt-2.5-recovered-video-2026-10-22.json`, `results/firecrackle-flags-recovered-video-2026-10-22.json`,
`results/crossmatch.js` (`node crossmatch.js find.json flags.json jolt.json`).

### Locating the cuts inside the windows (overlay XYZ / yaw / tick grid)

Jolt's `from`/`to` and the cadence change frames only bracket a cut (the next food-bar jolt and the next FPS
boundary after it). The overlay's XYZ updates once per client tick, i.e. every 3 video frames, so the tick grid
and the per-tick position step pin it down:

- **Cut 1:** between frames **61389 and 61390**. The boat's X step is a constant 0.251/tick for 10 ticks, then
  61389→61390 jumps 0.582 (Z 0.720), the tick grid shifts by one frame (ticks at 61387, 61390, **61391**, 61394…),
  and yaw moves −20.3→−18.9 across it. Food-bar jolt (food 17: every 17·3+1 = 52 ticks = 156 frames) at ticks
  149240 and 149292 lands 139 frames apart instead of 156: **17 frames (0.283 s) removed**, the cadence's −19 ±2.
- **Cut 2: at frames 171482 → 171483.** The barrel GUI closes on that frame pair, the FPS reading goes 144 → 231 on
  the same frame, and frame-to-frame pixel difference spikes there (45 vs <1 on the frames before). The cadence
  pattern explains it exactly: changes at 171439, 171483, 171512 (gaps 44 and 29). Removing 46 frames at 171483
  swallows the 1-second boundary that was due at original frame 171499, so the splice itself shows the next
  second's value (231) and the following boundary lands 46 frames early (171559 − 46 = 171513, observed 171512).
  The tick grid is ≡1 mod 3 before and ≡0 mod 3 after, the one-frame shift that removing 46 frames (46 ≡ 1 mod 3)
  produces. Food-bar jolt (food 16: every 49 ticks = 147 frames) at ticks 185955 and 186004 lands 101 frames apart
  instead of 147: **46 frames (0.767 s) removed**, the cadence's +13 ≡ −47. The removed stretch is time spent in
  the open barrel: the player is stationary before and after.

So the earlier reading "clock discontinuities, not content cuts" was wrong: the first stacked frames (61397–61420)
were after the cut. With the tick grid as a third clock, all three agree, and the position jump is visible at cut 1.

## Second video: YouTube LNsxw4VRTgQ (2026-10-23)

2560×1440 AV1 60 fps, 3 h 53 min (839,411 frames). Overlay off for the first 52 min and hidden for ~5 min in the End
(boss bar over the digits), readable elsewhere. Files: `results/find-yt-LNsxw4VRTgQ-2026-10-23.json`,
`results/jolt-2.5-yt-LNsxw4VRTgQ-2026-10-23.json`.

| Where | Jolt 2.5 | Cadence | Frames | Notes |
|---|---|---|---|---|
| 0:07:39.8 | removed 0.133 s (8 f), bracket 27,522–27,652 | overlay off | **27,589 → 27,590** | inventory screen closes; only abrupt change in the bracket |
| 1:56:07.7 | residual step +2.5 f (no break flagged: below its 0.1 s threshold) | Jump −4 f: spacing 60 60 60 60 60 **56** 60 60… | change at 418,062; cut within the second before | player stationary in a GUI that closes at 418,032→418,033 |
| 1:59:46.6 | residual step +2.0 f | Jump −3 f: … 60 **57** 60 … | change at 431,197 | |
| 2:07:44.7 | no readings nearby | Jump +4 f in a jittery stretch (59 60 60 64 62 58 59 61) | change at 459,881 | weak |
| 2:11:57.6 | residual step +3.0 f | Jump −3 f: … 60 **57** 60 … | change at 475,057 | player stationary, starts moving at 475,043 |
| 2:15:30.6 | no readings nearby | Jump −3 f: … 60 **57** 60 … | change at 487,834 | |
| 3:25:54.6 | removed 0.333 s (20 f), bracket 741,273–741,409 | overlay hidden (End) | **741,327 → 741,328** | a hunter appears between two frames while the camera is still; visible seam |
| 3:41:50.9 | removed 0.100 s (6 f), bracket 798,481–798,613 | Jump −5 f: … 60 **55** 60 … | change at 798,659 | the whole bracket is a frozen frame (client stall); 5–6 frames of wall time missing across it |

The three Jolt breaks are confirmed as frame removals where a second clock exists (3:41:50, both agree to a frame)
or by a visible seam (3:25:54); 0:07:39 rests on Jolt plus the GUI-close seam. The four 3–4-frame cadence items at
1:56–2:15 are the signature seen for real cuts (one short interval amid exact 60s) and Jolt's tick residual steps by
2–3 frames across the three it has readings for; they are below Jolt's own break threshold and happen while the
player is stationary or in a GUI, so the XYZ grid cannot place them inside the second. 2:07:44 is not trusted.

## Speed: what was tried (2026-10-23)

`find` runs at ~750–1,000 frames/s on 1440p60 AV1 with one ffmpeg (dav1d, `-threads 0`), decode-bound. Before
that it was 109 frames/s on stretches without the overlay (the anchor search ran at every position, twice); a
summed-area prefilter that only scores windows whose lit-pixel count can pass made those frames cheap, with results
identical to the brute-force search (unit-tested) and to the previous build on five reference windows.

Tried and rejected:

- **Parallel chunks** (keyframe-cut `-ss <keyframe> -frames:v n` per worker): joins are byte-exact (verified on both
  reference videos), but 2–6 workers gave 744–890 vs 744–817 frames/s single, within noise: one dav1d decode already
  uses the cores. Not worth the frame-count risk.
- **NVDEC** (`av1_cuvid`, crop on the GPU): 824 frames/s alone, ~1,435 combined with three CPU workers, but on the
  Dream file 7 of 1,800 frames read completely different values (the decoder returns a different picture for some
  frames of that damaged file). A decoder that substitutes frames can create or hide exactly the one-frame events
  this tool measures, so software decode stays the reference.
- **`extractplanes=y`** instead of the grey conversion: as fast as the pinned `format=yuv420p,format=gray`, but it
  skips the tv→full range expansion and lost 34–36 dimmed-overlay readings per 30 s window.
- **A pipe-reader thread**: no consistent gain.

## Any resolution (2026-10-23)

Reported: the tool "only works at 1440p". Reproduced: a 60 s clip of the Dream footage downscaled to 1920×1080 read
0 % of 3600 frames, with and without `--prescale 2560:1440` (4.9 % once, by luck). Two causes:

1. **The reader demanded 97 % of the `FPS: ` template lit.** A label that went down to 1080p and back up is soft and
   rings; 90–95 % of the strokes are still above the threshold. The coverage is now 80 % (85 % read 1080p but not
   720p; 65 and 75 % also passed every test). Native footage: five segments, 60,000 frames on both Dream and the
   YouTube video, readings identical to the 97 % build except one frame it now reads (frame 423 of the Dream file, a
   `189` between two `189`s that the old build lost to a flicker); speed unchanged.
2. **The size had to be given by hand.** `find` now finds the font pixel size itself (`src/autoscale.rs`): 16 sample
   frames (then 64), candidates `scale 1–8 × screen height` for the file's own height and 720–2880, the one that
   reads in most samples wins. The band is cropped and scaled by `3 / size` with ffmpeg lanczos.

Checked end to end on the same 20–60 s of Dream footage stored at 720p, 900p, 1080p, 1440p and 2160p:

| stored at | font pixel | auto result | against the 1440p reading |
|---|---|---|---|
| 2560×1440 | 3.000 | 16/16 samples | reference |
| 1920×1080 | 2.250 | 16/16 | 3600 of 3600 frames identical |
| 1280×720 | 1.500 | 16/16 | 1200 of 1200 identical |
| 3840×2160 | 4.500 | 16/16 | 1200 of 1200 identical |
| 1600×900 | 1.875 | 16/16 | 1195 of 1200; 5 frames read a prefix (`1` for `107`) or nothing |

Found on the way: ffmpeg's scaler pads an **odd** input width to even, which stretches the band by a pixel and moved
the label 1 px off the grid the reader searches (0 % readable). The crop is always even now.

Not covered: a font pixel size that is not scale × a usual screen height (an unusual window size; the 1445-px test
passes because 2.25 is within 1 %), and footage where the overlay is never on screen in 64 samples (it says so and
asks for `--scale`/`--prescale`). The 1080p files here are made by downscaling the 1440p original; a real 1080p game
recording at GUI scale 2/3/4 is covered by the same sizes (2, 3, 4) but was not available to test.
