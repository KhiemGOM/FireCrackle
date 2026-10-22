# M2b: frame decoding, workspace, Tauri commands, React Label tab (plan)

**Status: built.** 347 Rust tests (27 real-ffmpeg decode tests, 26 workspace tests, 16 frame-service tests),
105 TypeScript tests, `tsc` and the Vite build clean. Verified on a real 1080p60 B-frame recording (every probed
frame passes the timestamp check; cold seek 0.3-0.9 s, stepping instant, 7.9 ms per frame while playing with
prefetch), in the browser against the mock (labelling by click, typed rows, Enter-accept, undo, playback, next
flag, timeline zoom, generated settings panel), and in the real Tauri window (it opened a video and decoded
frames while in use). Not done / not verified: **timeline thumbnails** (a per-frame thumbnail strip needs its own
single-pass ffmpeg job: decoding ten arbitrary frames costs seconds, so the lane, ruler and flags ship first),
the **Phase tab** (chart), an automated click-through of the real window (it was in use), Linux.
Things learned while building: `-ss` is relative to the file's start time unless `-seek_timestamp 1`, and
`-copyts` breaks seeking in files that do not start at 0 (found by a failing test and fixed).

M2a built the pure logic. M2b connects it to ffmpeg, to the disk, to Tauri and to the screen. Everything that
can be logic stays in `studio_core` and is tested there; the Tauri layer is a thin shim and the React layer only
draws state and forwards events.

## 1. Frame decoding (`frames.rs`)

`decode_job(tools, video, job, max_width, cancel)`: one ffmpeg run for a planned `DecodeJob`:

    ffmpeg -ss <keyframe pts - 0.5 ms> -i VIDEO -fps_mode passthrough -frames:v <decode_count>
           -vf "scale=w=min(MAX\,iw):h=-2,showinfo" -f image2pipe -c:v mjpeg -q:v 3 -

- **Alignment is verified, not assumed**: `showinfo` prints every decoded frame's pts on stderr; each must match
  the index pts of the frame it is assigned to (within half the local frame interval). A drifting seek,
  a dropped frame or a container/index mismatch is an error naming the frame, never a silently wrong picture.
- `-ss` is half a millisecond *before* the keyframe pts: ffprobe prints pts rounded to 6 decimals, and a seek
  that lands a hair after the keyframe would drop it (off-by-one for the whole job).
- `split_jpegs`: the mjpeg stream is split by walking the JPEG segment structure (SOI, segments, entropy data
  with `FF00` stuffing and RSTn, EOI), not by searching for `FFD9`.
- The first `first - keyframe` frames are decoded and dropped; frames `first..=last` are returned in order.
- stderr is drained on its own thread (a full pipe would deadlock ffmpeg), cancel kills ffmpeg, a missing
  ffmpeg is `ToolMissing`, a short stream is `ShortRead{expected, got}`.

Can break: B-frame reordering, open-GOP keyframes, VFR timestamps, a job that runs past the end of the file,
odd widths (`h=-2` keeps the height even), paths with spaces and non-ASCII, enormous frames, ffmpeg writing a
warning line that looks like a frame line.

## 2. Workspace (`workspace.rs`)

- `FrameSource` trait (real: `FfmpegSource`; tests: a fake that counts calls and returns deterministic bytes).
- `FrameService`: byte cache (the `FrameCache` LRU decides what to evict, the evicted bytes are dropped),
  `get(frame)` (decode the planned run on a miss, wait for nothing else), `prefetch(frame)` on a background
  thread following the planner's hysteresis, `wait_idle()` for deterministic tests. A failed decode is an
  error to the caller and leaves the cache consistent.
- `Workspace::open(tools, video, settings)`: project folder `<video>.firecrackle/` with `project.json`,
  `labels.jsonl` and `settings.json`; re-opening loads instead of re-importing, refuses a replaced video
  (fingerprint) and a label log of another video; reports a repaired torn log; falls back to default
  settings (with a warning) when `settings.json` is unreadable.
- `UiAction` (serde enum, one per user action) -> `apply` -> `View` (serde): current frame, label, pick,
  pending typed digit, suggestion, counts, flag count, warnings and `save_error`. Every action flushes the
  autosave queue; a failed write is requeued and reported in `save_error`, never lost, never fatal.
- timeline (`lane::buckets`), flags with extents, settings (`describe`, `set`, persisted), frame JPEG bytes.

## 3. Tauri commands (`src-tauri`)

Thin: `open_video`, `view`, `act`, `frame` (raw bytes, `tauri::ipc::Response`), `timeline`, `flags`,
`settings_describe`, `settings_set`. State: one `Mutex<Option<Workspace>>`; decode runs on a blocking thread so
the window never freezes. Dialog plugin to pick a video.

## 4. React Label tab

Layout: video (center), timeline (below), picker + status + typed-row hint (right). Pieces:
- `api.ts`: typed wrapper over `invoke`, with an in-browser **mock backend** (synthetic frames, same shapes) so
  the UI can be developed and checked without Tauri;
- `VideoPane`: the current frame (Blob URL from the bytes), overlay with frame number, time and label;
- `Timeline`: canvas, thumbnails strip, ruler (`timeline.ts`), label lane + flag marks (`lane` buckets),
  playhead, wheel zoom at the cursor, drag pan, click to seek, follows the playhead;
- `Picker`: the 4 x 32 grid (`grid.ts`), current label, suggestion and alternative highlighted;
- hotkeys through `keymap.ts`; play/shuttle are UI timers that issue `step`;
- `Flags` list (jump on click) and a generated `Settings` panel (from `settings_describe`, with the explanations).

## 5. Verification

- Rust: `cargo test` (frames integration tests with real ffmpeg, workspace with the fake source + one real);
- TS: `vitest` for the pure logic that moved into the UI layer (action mapping), `tsc`, `vite build`;
- UI: exercised in the built-in browser against the mock (screenshots, interaction), then `tauri dev` to check
  the real app starts and the commands answer. What cannot be checked from here is stated plainly.
