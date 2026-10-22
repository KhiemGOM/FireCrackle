# Historical thumbnail milestone

The status and counts below describe the original implementation checkpoint. The current
thumbnail integration is preserved in source and covered by the workspace/FFmpeg tests;
use the root contributing guide for current commands.

# M4: timeline thumbnails (plan)

**Status: built.** 425 Rust tests (38 `thumbs`, 17 `thumbs_workspace`, 36 settings), 141 TypeScript tests, `tsc`,
the Vite build and the Tauri shim clean. Real ffmpeg: the pass is verified on synthetic videos (GOP, stride, 1.5 s
start offset, one keyframe, paths with spaces, cancel, missing tool) and on a copy of a real 1080p60 recording
(9400 frames: 40 thumbnails in 0.97 s, reopening reuses the cache). In the browser against the mock: "making
thumbnails..." then the picture row. Not verified: the real Tauri window drawing the row.
Deviations from the plan, stated openly: (1) the UI asks `thumb_nearest(frames)` (slots are anchored to the video,
not equal divisions of the view), so the planned `strip()` was dropped before it was written; (2) the
"failed save keeps the old store" test was changed after the red run to block the staging folder (`thumbs.tmp`)
instead of a picture file, because the store is written to a staging folder and swapped in; (3) two existing tests
had their counts bumped to 36 settings, and my first wording of two setting explanations tripped the existing
"no mention of the old strip" guard, so the wording (not the test) was changed.

Goal: a picture strip along the timeline (like a video editor) so the user can see where scenes and fire are
without stepping. Decoding ten arbitrary frames costs seconds (each needs its own seek), so thumbnails come from
**one single ffmpeg pass over the keyframes only**, once per video, cached on disk.

## Design

- **Which frames**: keyframes only. `ffmpeg -skip_frame nokey -i VIDEO` decodes only the keyframes (a 1 h recording
  has a few thousand, decoding them is fast). `select=not(mod(n\,K))` thins them to at most
  `timeline.thumb_max_count`: `K = ceil(keyframes / max_count)`. One pass, stdout MJPEG, `showinfo` on stderr.
- **Matching is by timestamp, not by count**: every picture's time (`showinfo`, made absolute like the frame decoder
  does) is mapped to the nearest index frame and must be within `decode.align_tolerance` of that frame's interval.
  (The decoder's idea of a keyframe can differ from ffprobe's packet flag; a count check would reject good output.)
- **Cache** (`<video>.firecrackle/thumbs/`): `<frame>.jpg` per thumbnail plus `meta.json`
  `{fingerprint, width, quality, stride, frames}` written **last, atomically**. A store is valid only when the meta
  equals the expected key (same video fingerprint, width, quality, stride) and every listed file exists; otherwise
  it is stale and regenerated. A torn run (crash before `meta.json`) is therefore never half-trusted.
- **Background**: `Workspace::thumbs_start()` spawns one job thread (a second call while running does nothing);
  `thumbs_status()` = idle | running | ready | failed(message) | disabled, with a count. Dropping the workspace
  cancels the job (kills ffmpeg). A failure never blocks labelling.
- **Row**: the UI cuts the visible video into slots (`thumbSlots`, anchored to the video so panning does not
  re-cut them) and asks `thumb_nearest` for the stored thumbnail nearest to each slot's centre frame; zooming in
  shows the nearest keyframe (coarse where keyframes are far apart: a stated limit, not a bug).
- **Settings** (all documented, ranges in `config.rs`): `timeline.thumb_width_px` (exists), `timeline.thumb_quality`
  (MJPEG q 2-31, default 5), `timeline.thumb_max_count` (default 600), `timeline.thumbs_enabled` (default on).
- Tauri: `thumbs_start`, `thumbs_status`, `thumb_strip`, `thumb` (raw bytes). UI: `lib/thumbs.ts` (slot geometry,
  pure), a thumbnail row in `Timeline.tsx`, polling status while running.

## Ways this can break (tests cover each)

- `stride`: 0 keyframes, fewer keyframes than the cap, exactly the cap, one over, max_count 1; selected frames
  always include the first keyframe, are strictly increasing, never exceed the cap.
- `assign`: times with a start offset, a time between frames, a time matching no frame (misaligned error naming it),
  two pictures mapping to one frame, empty list, non-increasing times.
- Store: missing file, corrupt/partial `meta.json`, other video (fingerprint), other width/quality/stride,
  frame not in the store, empty save, a failed write leaves the old store valid, atomic meta.
- `nearest`: empty store, one thumbnail, ties, frames before the first / after the last thumbnail.
- ffmpeg: missing tool, cancel before and during, a video with a single keyframe, a start offset (1.5 s),
  stride > 1, width bigger than the video (no upscale needed: `min(w, iw)`), odd sizes, paths with spaces.
- Workspace: persists across reopen (no regeneration), settings change makes it stale and regenerates, a failing
  source gives `failed` and a later start retries, two quick starts run once, drop while running does not hang,
  disabled does nothing, a source without thumbnail support gives `failed` not a panic, unknown frame is an error.
- UI (pure TS): slot geometry for any viewport/zoom/width, zero width, thumbnail wider than the view, frames
  outside the video, de-duplication of requested thumbnails.

## Tests first

Rust: `tests/thumbs.rs` (pure + real ffmpeg), `tests/thumbs_workspace.rs`, `tests/config.rs` (36 settings).
TS: `src/lib/thumbs.test.ts`. Red first, then implement; test files unchanged between red and green.
