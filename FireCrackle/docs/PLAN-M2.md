# M2: the Label tab (plan)

**Status: M2a (the logic below) is implemented and tested: 275 Rust tests, 86 TypeScript tests, tests unchanged
between red and green. M2b (ffmpeg frame I/O, Tauri commands, React components) is not started.**
Known follow-ups noted while building: `Session::suggestion` scans all labelled frames per call (fine at 20k
labels, add a neighbour lookup to `LabelStore` before 650k); `FrameCache::touch` is linear in the cache size.

Layout from the brief: **center** = the video frame, **below** = an editor-style timeline, **right** = the sprite
picker (4 x 32 grid like the reference image: Normal sheet 0 / Normal sheet 1 / Mirrored sheet 0 / Mirrored
sheet 1, rows 0..31). Click a cell = label this frame, then advance. Full keyboard control.

Split: **logic is pure and tested** (Rust in `studio_core`, TypeScript in `src/lib`), the React/Tauri layer
is thin glue over it. M2a (this milestone's first half) is the logic; M2b is the ffmpeg frame I/O, Tauri
commands and the React components.

## 1. Decode window (`decode_plan.rs`, pure; ffmpeg I/O in M2b)

Frames are decoded on demand, never dumped. Seeking is frame-exact only from a keyframe, so:
- `plan(index, cache, want, cfg)` -> what to decode so that `want` and a window `[want - back, want + ahead]`
  are cached: the missing run containing `want` (or the first one after / before it), started at
  `index.keyframe_at_or_before(run.start)`; frames between the keyframe and the run are decoded and dropped.
- **Hysteresis**: when `want` is cached, prefetch only if the cached frames ahead (or behind) fell under
  `prefetch_fraction` of the window, and then fetch a whole window, so playback does not spawn ffmpeg per frame.
- `slow` is set when the keyframe is more than `max_gop_frames` before the run (YouTube-style 5-10 s GOPs):
  the UI shows a spinner instead of pretending it is instant.
- `FrameCache`: LRU by bytes (`cache_mb`), `touch` on read, deterministic eviction order.
- M2b decoder: `ffmpeg -ss <keyframe pts> -i video -fps_mode passthrough -vf scale=W:-2 -f image2pipe -c:v mjpeg`,
  read exactly the planned count, cross-check the count (a short read = corrupt frame, reported, not silent).

## 2. Session (`session.rs`, pure)

One object owns the label store, the current frame, the sheet/mirror pick, the typed-row buffer, the cached phase
analysis and the autosave queue. Everything the UI does is one method:
- moves: frames +-n, to frame, home/end, next/previous unlabelled, next/previous flag;
- labelling: click a cell, type a row (`RowTyper`: `1` waits for a second digit, `4`..`9` commit at once, `12`
  commits 12, `35` is rejected, Enter/flush commits a pending digit), `Enter` accepts the suggestion,
  `X` no-fire, skip, clear, fill range, undo (jumps back to the undone frame);
- advance after labelling (settings): `advance_frames` (0 = stay) or jump to the next unlabelled frame;
- **suggestion** (E7): from the nearest labelled fire frame, `x = tick_rate * dt` ticks have passed; the sprite
  advanced `floor(x)` or `floor(x) + 1` (the one more with probability `frac(x)`): suggest the likelier row and
  show the other as the alternative; sheet and mirror carry over (same fire block). No suggestion further than
  `suggest_max_seconds` from a label (the rate error accumulates) or when nothing is labelled;
- every change is queued as log lines for the autosave (undo included, with the restored labels).

## 3. Autosave (`autosave.rs`)

Append-only `labels.jsonl` (format already in `label.rs`). Opening replays it; **a torn last line is truncated
away before the first append** (otherwise the next line would glue onto the torn one); an unparsable middle
line, an invalid label or a frame beyond the video is an error that names the problem (wrong project / video).
Append failure keeps the lines queued for retry (nothing lost). Compaction after `compact_after_lines` lines:
rewrite from the store to a temp file and rename (Windows: the append handle is closed first). `fsync` per
append is a setting.

## 4. Timeline (`lane.rs` Rust, `timeline.ts` TypeScript)

- Rust `buckets(store, flags, start, end, n)`: per pixel-bucket counts of unlabelled / fire / no-fire / skip
  frames and the worst flag severity overlapping the bucket (an excursion colours its whole extent).
  O(labelled frames in range), fine for 650k frames.
- TS geometry: frame <-> x, visible range, cursor-anchored zoom (the frame under the mouse stays put) within
  `[fit-all, max_px_per_frame]`, pan, follow-the-playhead, a ruler with nice time steps, thumbnail frame picks.

## 5. Hotkeys (`keymap.ts`)

Pure `actionFor(event, bindings)`: arrows (+Shift big step), `Home/End`, `Space`, `J/K/L`, `S`/`M` (sheet,
mirror), digits, `Enter`, `Backspace`, `X`, `N`/`Shift+N` (unlabelled), `F`/`Shift+F` (flag), `Ctrl+Z`.
Ignored while a text field has focus; only step actions auto-repeat (a held digit or `X` must not flood).

## 6. Settings (all documented in `config.rs`)

`label.advance_frames`, `label.big_step_frames`, `label.advance_to_unlabelled`, `label.row_type_timeout_ms`,
`label.suggest_max_seconds`, `decode.window_back`, `decode.window_ahead`, `decode.prefetch_fraction`,
`decode.cache_mb`, `decode.max_width`, `decode.max_gop_frames`, `autosave.compact_after_lines`,
`autosave.fsync`, `timeline.zoom_factor`, `timeline.max_px_per_frame`, `timeline.thumb_width_px`.

## 7. Ways this can break

- Seek lands on the wrong frame (B-frames / open GOP): decode count cross-check, frame ids from the index.
- No keyframe before the wanted frame (first frame not key): decode from 0, flagged slow.
- Frames deleted/duplicated in the container (packet count != decoded count): reported at the first mismatch.
- Huge GOP: slow flag + spinner; cache thrash: bounded by bytes; a 4K frame bigger than the cache: kept alone.
- Labelling at the first/last frame, empty video, one-frame video, labels file from a different video.
- Rapid keys: repeat handling, digit buffer timeouts, typing into a text field, undo of a range fill.
- Autosave: crash mid-append (torn line), disk full (retry), two instances (documented: not supported),
  compaction crash (temp + rename), Windows rename-over-open-file.
- Timeline: zoom at the extremes, anchor drift, a window narrower than the data, more pixels than frames.

## 8. Tests first

Red first for every module, then implementation; Rust `cargo test`, TS `vitest`. Real ffmpeg frame decoding
is M2b with its own integration tests (skipped without ffmpeg).
