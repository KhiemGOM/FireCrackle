# Whole-video GUI detection check

**All 27,385 decoded frames of both aligned GUI recordings were processed.**
The frozen detector is the implementation at `8a90f6f`, using the unchanged
local `assets-v10` source bank. No tuning, frame skipping, temporal smoothing,
supplied occlusion masks or renderer-position hints were used for detection.

## Frame-level results

| Scope | GUI frames detected / present | Recall | False detections / closed frames |
|---|---:|---:|---:|
| Main, `2026-10-20 14-09-57.mkv` | 8,542 / 9,050 | 94.39% | 0 / 12,123 |
| Supplemental, `2026-10-20 14-22-45.mkv` | 916 / 920 | 99.57% | 0 / 835 |
| Combined | **9,458 / 9,970** | **94.86%** | **0 / 12,958** |
| Combined, excluding creative inventory | 6,573 / 6,613 | **99.40%** | Same closed negatives |

The primary scope is recorded `inventory.*` interaction screens, including
inventory, containers, books and sign editors. GUI-type ambiguity and the
presence-only fallback count as GUI detected. As requested earlier, menus,
chat and modded screens are outside that primary metric; their 4,457 frames
were still scanned and are reported separately (1,185 detected, 3,272 abstained).
Those other-screen outcomes must not be called closed-GUI false positives.

The earlier **260/261=99.6%** result is a segment-midpoint result, not full-frame
recall. The sequential scan reproduces every one of those 636 sampled presence
and exact-type decisions; the lower full-frame result comes from additional
frames, not a changed detector or a disagreement between the two runners.

## Misses

| Recorded screen | Missed frames / present frames |
|---|---:|
| Creative inventory | **472 / 3,357** |
| Chest/container | 12 / 782 |
| Smithing | 10 / 263 |
| Dispenser/dropper | 8 / 524 |
| Merchant | 4 / 247 |
| Hanging-sign editor | 3 / 383 |
| Horse inventory | 3 / 1,229 |
| All remaining recorded interaction types | 0 / 3,185 |

Creative inventory accounts for 472 of 512 misses (92.2%). It is not only a
tiny-GUI issue: failures also occur at the largest recorded GUI scale. The
40 noncreative misses are short failures, not wholly missed interaction
segments. Representative failed images show item/count foreground and tooltips;
this inspection alone does not establish the cause of every failed probe.
No masks or thresholds were adjusted after observing these full-frame errors.

There are 75 contiguous miss runs. The longest is 46 frames (0.767 seconds at
60fps), in creative inventory. The longest noncreative run is 12 frames
(0.200 seconds), in a chest/container. Across the 261 contiguous same-type
interaction segments, 260 have at least one detected frame and 240 have every
frame detected. This is a separate segment metric, not a substitute for the
94.86% frame-level recall. The only entirely missed segment is the tiny creative
inventory at main frames 22360–22400 (41 frames).

## Protocol and limits

- Decode every frame at native 1920x1080 RGB24 and feed it through the same
  persistent native source-template detector, independently per frame.
- Match output index to the previously CRC-verified renderer-aligned state
  stream. Both recordings have zero `stable_render_state=false` rows; thus no
  unstable transition frames were dropped from the primary counts.
- Include all repeated OBS frames: 80 repeated renderer frames in the main
  video and 132 in the supplemental, for 27,173 distinct recording/renderer
  identities. Repetitions and neighbouring frames are correlated observations.
- Hash the detector source, binary, source-bank manifest and runner before
  execution and verify they remain unchanged after both recordings complete.
- Both videos share a session and have already been used during development.
  This is exhaustive coverage of these recordings, not independent validation
  or evidence of a zero general false-positive rate.
- Median native time was 16.720 ms / 16.097 ms in the two clips; end-to-end
  scan times were 441.8 s / 39.0 s, including pipe/decode overhead. These local
  timings are not a controlled performance comparison.

## Reproduce and evidence

```powershell
python fire-detection/bench/gui_interaction/check_all_frames.py --assets .board/gui-soft-guard-check/assets-v10 --output .board/gui-all-frames-check
```

Private `.board/gui-all-frames-check/` contains per-frame `predictions-0.jsonl`
and `predictions-1.jsonl`, pooled/per-recording reports, coverage accounting for
the catalogue's original videos, all input/source hashes and every miss run.
`secondary-analysis.json` adds GUI-scale, type and segment counts using the
independently logged renderer metadata only after scoring. `failure-contact.jpg`
and six extracted frames support visual inspection. No recordings, label
snapshots, game assets or frame images are committed.

The scoring helper was checked against the preceding 636-sample report and
reproduces its 260 positives detected, one missed and 289 closed abstentions.
Every selected midpoint also matches its decision inside this full sequential
scan. This check involves no AI fitting, training or calibration.
