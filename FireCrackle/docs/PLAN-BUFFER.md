# Look-ahead frame buffer and playback readout

Request (2026-10-18): "investigate why we fixed some of the stutter issue, there's still ZERO caching or speculative
loading AT ALL … very stutter even on just 1x". Then: "build the look-ahead buffer in the app and a small timing
readout so we can see drops in the real window. Tests first."

## What the investigation found (measured, not assumed)

- The backend caches and prefetches (`FrameService`): on the user's real 1080p60 recording at 1x, a frame fetch is a
  median 0.0 ms and a step 0.21 ms; the one stall is the first frame after a seek (~0.9 s, ffmpeg's start-up).
- The app side has **no** caching or look-ahead. Every frame is fetched only when the playhead lands on it
  (`backend.frame(view.current)`), then Blob → object URL → `<img>` decode on the main thread, and a frame that
  finishes late is thrown away (`token`), so a late frame is a visible drop. Measured in the web view: blob → `<img>`
  decode ~9 ms per 720p and ~18 ms per 1080p frame (noisy test frames, so an upper bound), against a 16.7 ms budget.
- Nothing shows what the app is doing, so a pause looks like "nothing is loading".

## Design

`src/lib/frameBuffer.ts` (no DOM; fetch / URL / decode are injected, so it runs in node tests):
- Holds the JPEG bytes of the frames around the playhead and, for the next few, a ready object URL that has already
  been decoded (`Image.decode()`), so showing the frame is a swap, not a decode.
- `load(frame)` returns the frame from the buffer or fetches it (one fetch per frame however many ask).
- `prefetch(current, {dir, speed})` plans what to fetch: playing forward fetches ahead of the playhead (every
  `speed`-th frame when speed > 1), backward the other way; paused fetches both sides, nearest first. At most
  `parallel` fetches at once; nearest first; work for a direction that has gone is dropped.
- Eviction: frames outside `[current − behind, current + ahead]` leave the buffer and their URLs are revoked, except
  the one on screen.
- Settings (all in the settings panel, with explanations; Rust `label.*`): `buffer_ahead` 90 frames,
  `buffer_behind` 30, `buffer_decode_ahead` 8, `buffer_parallel` 3.

`src/lib/playbackStats.ts` + `PlaybackReadout`: per frame, when the playhead needed it and when it was shown, and
whether it came from the buffer. The readout (status bar, while playing and for a while after) shows the achieved
frame rate, dropped frames, late frames, the 95th-percentile wait and how many frames are buffered ahead.

Hook-ups (queue-only files, through the patch queue): `VideoPane.tsx` (load through the buffer, readout), `App.tsx`
(pass the playback state and the buffer settings), `lib/api.ts` untouched.

## Failure cases (tests first)

Buffer: a frame is fetched once (hit; two concurrent loads share one fetch); never more than `parallel` in flight;
nearest first; forward play fetches only ahead and backward only behind; paused fetches both sides; a speed of 4 fetches
every 4th frame; a reversal drops the queued old-direction work; a seek far away discards in-flight results of the old
place (no stale insert) and evicts the old window; eviction revokes URLs but never the shown one; a failed fetch rejects
`load`, is not cached and is not retried in a tight loop; prefetch failures are silent; frames outside 0..count−1 are
never requested; zero frames, zero ahead, NaN or negative settings are safe; `dispose` revokes everything and ignores
later results.

Stats: steady 60 fps = no drops; skipped frames while playing count as drops, a jump while paused (a seek) does not; a
wait over the frame time is late; percentiles; old samples age out; no data, fps 0 or NaN print "—", never NaN.

Settings: four new keys with defaults, set, range checks and explanations (49 → 53 settings).

## Late frames (found by the readout in the first browser run)

With a backend that is slower than the playhead (the mock renders each frame on demand), every load finished after the
playhead had moved on and was thrown away: the picture stayed at frame 6 while the playhead was at 213 and the readout
turned red (18 fps, 113 dropped). The same starvation would hit the real app whenever the backend has to decode (a seek,
or ffmpeg busy with the thumbnail pass). Now a late frame is still shown when it is newer than the one on screen, in the
direction of play, and not more than `label.buffer_late_show` (30) frames behind the playhead
(`src/lib/lateFrame.ts`, `shouldShowLate`). Late frames are not counted as shown for the readout's wait.

## Status (2026-10-18): built, not committed

Settings (Rust, with explanations; 49 → 54): `label.buffer_ahead` 90, `buffer_behind` 30, `buffer_decode_ahead` 8,
`buffer_parallel` 3, `buffer_late_show` 30.

Tests, written first and run red (module or fields missing):
- `frameBuffer.test.ts` (24), `playbackStats.test.ts` (19), `lateFrame.test.ts` (10), settings in `tests/config.rs`
  and the count in `tests/workspace.rs`.
- Three test inputs were my own mistakes, fixed after the red run and not changed to fit the code: a seek target past
  the end of a 1000-frame test video (frameBuffer), `shown: 90` in the two "exactly at the lag" cases (lateFrame), and a
  `process` type for `tsc` (frameBuffer).

Hook-ups through the patch queue (`VideoPane.tsx` patches 109, 110, 112; `App.tsx` 108, 111). The buffer is created in
an effect because the app runs in React StrictMode. Its effects are declared after the first two, because
`VideoPane.interaction.test.ts` picks effects by position. With Veil or Portal on, the frame bytes come from the buffer
but the corrected picture is still made per frame as before.

Results:
- `tsc` clean; 944 frontend tests; all studio_core suites; `src-tauri` checks.
- Browser, mock backend at 30 fps: before the late-frame fix 18 fps, picture 200 frames behind; after, ~28 fps with the
  picture following the playhead and the buffer 46 to 90 frames ahead.

Not verified: the real desktop window on a real recording (I cannot drive it). That is what the readout is for: play,
and read the line under the video; green is fine, amber lost a frame, red is stuttering. If it is red on real footage
the numbers say where: `buffer +0` means the backend is not keeping up, a high p95 means the web view is.

## Seek burst (2026-10-18): the app lagged right after a timeline skip, and the owner's PC went down

After a seek the buffer asked the backend for the sought frame and the next three at once. None of them is in the
backend's cache yet, and a request for a missing frame starts a decode of its own (`FrameService::get`: only a frame
inside a published background range waits for it), so one seek started four ffmpeg decodes of about 120 frames each,
where there had been one. That is the defect I can point at; I could not prove it was the whole cause of the crash (the
event log shows a hard power-off at 03:11 with no bug check and no dump, so Windows recorded nothing about the cause).

Fix, inside `frameBuffer.ts` so the app needs no change: by default the buffer holds the look-ahead until the frame at the
playhead is in the buffer (`holdForCurrent`). The pane loads that frame; its one decode fills the backend cache; then the
neighbours are hits. While a seek waits, finished fetches start nothing around the old place either. Tests first (the
"holding" group in `frameBuffer.test.ts`, 7 new cases); the 24 planner tests run with the hold off.

Test slips of mine, fixed after the red run and not bent to the code: a seek to frame 5000 in a 1000-frame rig, and a
`follow(100)` that legitimately fetches 103-105 before the seek. The API went from a separate `follow()` to the hold
option because the board refused my session after a reconnect and `VideoPane.tsx` (queue-only) could not be patched.

Still open (not done): the backend has no global limit on concurrent decodes, so any burst of missing-frame requests
(from anything) still starts one ffmpeg each. A small semaphore (two at a time) in `FrameService` is the proper guard.

## The decode cap (2026-10-18)

What other tools do (searched, not copied code): decode forward from a keyframe and keep decoded frames in an LRU cache
(we do), treat a seek inside the cached range as free (our cache hits; mpv's cached seeks, Media3's scrubbing mode), and
bound decoder concurrency, because stale scrub requests make the decoder restart from different keyframes and waste work.
No source describes a ready-made "latest request wins" cancellation to copy.

Built here, tests first (`tests/decode_gate.rs`, 11 tests; settings tests in `tests/config.rs`):
- `src/decode_gate.rs`: a process-wide counting gate. At most `decode.max_parallel` (new setting, default 2, 1 to 8)
  ffmpeg frame decodes run at once; further requests wait their turn and give up when cancelled; a slot always comes
  back (even after a panic); lowering the limit does not stop running decodes.
- `frames::decode_job` takes a slot before it starts ffmpeg.
- `proc::background_command`: ffmpeg frame decodes start hidden and at below-normal priority (Windows
  `BELOW_NORMAL_PRIORITY_CLASS`), so a busy decode makes the app slower, not the machine. Tested with a child that reports
  its own priority class.
- Settings 54 → 55. The full studio_core suite passes (run at reduced parallelism).

Not covered: the thumbnail pass is one long ffmpeg of its own and is not gated; a queued decode for a position the
playhead has already left still runs when its turn comes (dropping those needs a change in `workspace.rs`, which is
queue-only and my board session is invalid).

## Lean pass (2026-10-18)

The owner called this the backbone of the app and asked for every line to earn its place. Measured first (a loop of
60 000 playback ticks through the real buffer and stats code, fake instant I/O): planning 2.4-3.3 us, load and show
1.6-2.1 us, stats 0.3 us per tick, so about 5 us of a 16 700 us frame (0.03%). Raw speed was never the problem; the one
real defect found was memory: the stats kept every sample until somebody read the summary (no reader, no pruning).

Done: `frameBuffer.ts` 305 -> 233 lines. Removed `onChange` and its notify plumbing, `readyUrl`, the per-entry
decoded/decoding flags only `readyUrl` read, `frames()`, the options object, the sanitiser (one `clamp`), and the arrays
the planner allocated each tick. `playbackStats.ts`: dropped and skipped are one `lost` count, samples are bounded on
write (2048), `reset` is gone. After: planning about 1.9 us, load and show 1.1 us, stats 0.24 us, summary bounded.
All 30 + 20 tests pass; two buffer tests and the reset test went with the features they tested.

Seen but not mine to change (`VideoPane.tsx` is queue-only and the board refused my session): `new PlaybackStats()` is
built on every render (`useRef(new ...)`; a lazy init would stop that) and `bufferKey` is rebuilt as a string each render.
Both are far below a microsecond; the pane's own per-frame re-render is the larger cost and predates this work.
