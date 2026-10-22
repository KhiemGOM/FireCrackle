# M1 (no strip): import and phase analysis

**No sync strip anywhere in FireCrackle** (user decision: the target footage has none). No `fire_core`
dependency, no tick, no frame id. Training recordings with a strip are a different tool's business.

## Import (`import.rs`, `index.rs`, `project.rs`)

`import_video(tools, video, settings)` = `ffprobe` stream info + `ffprobe` packets -> display-order frame index
(pts, keyframes, timing regularity) -> `Project` (frames = pts + key, summary, warnings, video fingerprint).
It does not decode a single frame, so it is fast (9,400 packets in 0.56 s). Frame *display* is M2.

Real-recording facts that shaped it: mkv timebase 1 ms (16/17 ms steps are rounding, not VFR), B-frame
reordering (sort by pts), `dts=N/A` on early packets.

Can break: ffprobe missing / unreadable file / no video stream / garbage ffprobe output; N/A or duplicate or
negative pts; one packet != one displayed frame (rare: hidden frames in some VP9/AV1 files) which M2's decoder
must cross-check; moved or replaced video (fingerprint); corrupt, truncated or newer project file; crash mid-save.

## Phase analysis (`phase.rs`), derivation in `PHASE-EVIDENCE.md` E7

Input: labelled frames `(frame, pts, label)`. `s` = canonical step (E2), `phi = (tick_rate * pts - s) mod 32`.
Within one continuous span all `phi` fit in an arc of `window_ticks` (1 tick floor noise + timestamp jitter).
- runs = greedy arcs; a short run between two compatible runs = **outlier** (one flag per frame);
- a change of level that comes back within `max_excursion_seconds` = one **excursion** (a lag stall:
  `frame..end_frame`, peak delta); a change that stays = **shift** (a cut, a reload, leaving the world);
- changes smaller than `min_shift_ticks` (default 1, the physical floor) are noise and not flagged;
- severity: hard when the deviation is more than `max_lag_ticks` (a lag catch-up never exceeds 10) or an
  outlier/excursion cannot be lag; shifts are always soft; every flag carries its signed delta in ticks.
- validated on real training data: `PHASE-EVIDENCE.md` E8 (22 soft flags / 9 min, 92.5% of random cuts caught).

Can break: wrap of the circle (phase near 0 / 32), sparse labelling, jitter bigger than the window, wrong
`tick_rate` (steady drift), cuts in the video (shifts), 32-tick ambiguity, ~1 row errors hidden in the noise,
non-increasing frames / non-finite or decreasing pts, invalid labels.

## Settings (all documented in `config.rs`)

`phase.min_run`, `phase.tick_rate`, `phase.window_ticks`, `phase.max_lag_ticks`, `phase.min_shift_ticks`,
`phase.max_excursion_seconds`, `index.irregular_deviation`, `index.vfr_fraction`,
`project.fingerprint_window_bytes`.

## Label store

`fill_tick_run` (needed ticks) is replaced by `fill_range(start, end, label)`: label a stretch of frames in
one undo step (the UI's "this fire sits here until I say otherwise").
