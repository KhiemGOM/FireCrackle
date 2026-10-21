# Long-video playback and first-frame loading — 21 October 2026

The owner's 561,619-frame, 2560×1440 AV1 recording reproduced slow 1×
playback. A ten-second live-app test advanced 360 frames in 10.263 seconds:
six seconds of media, approximately 0.58× speed. Cached full-size frame IPC
returned in 5.9 ms; a separate paused ten-second observation had no UI long
tasks. Cached frame lookup alone did not explain the slowdown.

## Changes

- Keep elapsed time through brief presentation/IPC waits. Previously every
  not-ready timer tick reset the media clock. Waits of 250 ms or more still
  suspend media time and discard accumulated debt; presentation remains gated.
- Start original-frame loading alongside its optional thumbnail. A late
  placeholder cannot replace an original that has already arrived.
- Give interactive decoding a bounded input-thread budget: available logical
  CPUs minus two, divided by the configured concurrent decoder count, clamped
  to 2–8 threads per decoder. Preview/thumbnail jobs retain their two-thread
  input budget; JPEG encoding remains single-threaded.
- Decode the seek prefix but trim it before scaling, JPEG encoding and pipe
  transfer. Verify the timestamps of every requested output as before.
- End forward refills at nearby keyframe boundaries where useful, within the
  requested window and a maximum 480-frame refill. Very long GOPs, short
  keyframe intervals and backward work retain the existing capped plan.

## Measurements and verification

All measurements are local to the i9-13900HX machine, with other owner apps
left open. These are playback engineering checks, not AI training or accuracy
experiments. Models, fire thresholds and shared unveil rules are unchanged.

A representative cold refill sought to the keyframe at 33 seconds and kept
240 frames after a 240-frame prefix. The original two-thread path took
12.364 seconds, 19.4 useful fps, transferring 71.3 MB. Trimming the prefix
and using eight input threads took 4.899 seconds, 49.0 useful fps, transferring
33.7 MB. All 240 retained JPEG SHA-256 values matched exactly. Four, twelve
and sixteen threads were also measured; more than eight brought little gain.
An aligned 330-frame interval with eight threads took 3.311 seconds, 99.7
useful fps. This last figure is a different refill shape, not a same-job
speedup estimate.

The clock/thumbnail fix alone was insufficient: a 20.065-second live-app test
advanced only 764 frames after its ready buffer ran down. After the decoder
changes, the final standalone release build was tested on the same recording
after initial frame loading and five seconds of buffer warmup:

| Wall seconds | Current video frame |
| ---: | ---: |
| 0 | 2620 |
| 5.024 | 2920 |
| 10.077 | 3221 |
| 15.098 | 3524 |
| 20.110 | 3825 |
| 25.124 | 4126 |
| 30.149 | 4427 |

Final accounting: 1,807 source frames / 60 fps = 30.117 media seconds in
30.166 wall seconds, approximately 0.998× speed. The live image emitted 1,056
load events, approximately 35 displayed pictures per second. Playback can skip
intermediate frames to maintain speed; this does not establish 60 distinct
displayed frames per second or continuous playback of the entire 2.6-hour file.
The test crossed multiple decoder refills. Playback was paused afterward.

Targeted checks: 102 frontend clock/frame-buffer/VideoPane tests; 78 native
decode-plan/cache/timestamp/decoder tests; studio-core Clippy with warnings
denied; frontend production build; native release build with
`--features tauri/custom-protocol`. Timestamp alignment, B-frame ordering,
nonzero initial timestamps, cancellation, backward caching and short-read
failure checks pass. The short-read test now counts requested images rather
than the discarded seek prefix. New regressions cover short delivery waits,
nonblocking thumbnails, late placeholders and bounded keyframe-aware refills,
including intra-only and short-GOP inputs.

The optimized executable replaced the local test app and was relaunched with
its bundled frontend. No recordings, labels, game assets or model files are
included in this change.
