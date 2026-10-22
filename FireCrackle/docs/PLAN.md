# Historical implementation plan

This document records the original milestone sequence and observations from those milestones.
Its test counts, proposed APIs and TODOs are historical, not the current acceptance checklist.
For current behavior and checks, use `README.md`, the root `CONTRIBUTING.md` and the tests.

# FireCrackle: plan

Desktop tool (Tauri 2: React + TypeScript UI, Rust backend, Windows + Linux) for the manual part of the
fire-cracking work: import a video, hand-label which fire sprite is on screen per frame, then check the
labels against the phase model.

**Standing assumption (user, 2026-10-15): the footage FireCrackle processes has NO sync strip.** No tick, no
frame id, nothing stamped in the picture (think YouTube / other people's videos). Nothing in FireCrackle reads,
needs or mentions a strip. `fire-detection/data/video/*` are training recordings made with the mod; they are a
different tool's business. The tick is *estimated* from the video timestamp (20 tps).

Facts this relies on (full derivations with Yarn 1.16.5 source citations: `PHASE-EVIDENCE.md`):

- Fire sprites: sheets 0 and 1, 32 rows each, normal or mirrored -> **128 possible labels**
  (assets: `fire-detection/data/assets/fire_{0,1}.png`).
- The sprite advances once per client tick (20 Hz): a 60 fps video shows the same row for ~3 frames.
- Sheet 1 shows row `s`, sheet 0 shows row `(s + 16) mod 32` (E2).
- `phi = (20 * t - s) mod 32` fits in an arc of ~1 tick (+ timestamp jitter) within a continuous span (E7).

## 1. Architecture

```
FireCrackle/
  src/                React UI (tabs: Import, Label, Phase)
  src-tauri/          Rust commands over studio_core
  crates/studio_core/ pure Rust, unit tested: settings, label store, frame index, project file, phase analysis
```

- **Frames are not dumped to disk** (one hour at 60 fps is ~216k files). Import builds a frame **index** from
  `ffprobe` packets (pts, keyframes, VFR check); frames are decoded on demand by ffmpeg from the nearest
  keyframe with a read-ahead window, plus a cached thumbnail strip for the timeline (M2).
- ffmpeg/ffprobe: found on PATH in dev, bundled as Tauri sidecars in releases (`Tools` in `import.rs`).
- Project file: `<video>.firecrackle/` with the project JSON and an append-only `labels.jsonl` (autosave on every
  label; last write wins; a torn last line is dropped).
- **Every threshold is a setting** with a default, a range and an explanation (`config.rs`,
  `Settings::describe()`), so the settings screen is generated, not hand-written.

## 2. Label model

Per frame: `Unset` | `NoFire` | `Skip` | `Fire {sheet 0|1, row 0..31, mirrored}`.
One label per frame for now (multi-fire frames are a later extension).

## 3. Tabs

**Import**: pick a video -> probe -> index -> summary (frames, fps, VFR?, timing warnings) -> open in Label.

**Label** (center video, timeline below, sprite picker right):
- Picker: the 4 x 32 grid (Normal/Mirrored x sheet 0/1), click = set label then advance.
- Advance mode (setting): next frame, or jump N frames; "fill range" labels a stretch in one undo step.
- Suggestion: the predicted next row (`+1` per 1/20 s of video time) is highlighted; `Enter` accepts it.
- Keys: `<-`/`->` frame, `Shift+arrows` +-10, `Space` play, `J/K/L` shuttle, `S` sheet, `M` mirror,
  `0-9` type a row, `Enter` accept suggestion, `Backspace` clear, `X` no-fire, `N`/`Shift+N` next/previous
  unlabelled, `Ctrl+Z` undo, `Home/End`.
- Timeline: editor-style, zoom/pan, thumbnails, playhead, lanes colored unlabelled / labelled / flagged.

**Phase**: chart of row vs time (sawtooth) and `phi` vs time (a flat band per run). Flags are listed and
clickable (jump to the frame in Label). Rules and severities: `PLAN-M1.md`. Policy (user decision): **flag
everything suspicious, excuse nothing**; a reload or lag drop shows as a soft shift with its delta and the user
confirms against the footage.

## 4. Ways this can break

See `PLAN-M1.md` (import and phase analysis). UI-level: hotkeys while a text field is focused, key repeat flooding
the decoder, Windows vs Linux paths, huge videos (never hold all frames), autosave corruption on crash.

## 5. Tests first

Pure logic gets unit tests before implementation (`cargo test` in `crates/studio_core`, vitest for UI logic);
ffmpeg integration tests build real videos and skip when ffmpeg is absent. Red run first, then implement,
test files unchanged between red and green.

## 6. Milestones

0. Label store + phase analysis (done, then reworked to no-strip).
1. Import: ffprobe index + project file + settings (done, no-strip).
2. Label tab. **M2a done**: the logic (session, decode window planner + cache, lane buckets, autosave, row typer,
   suggestions; TS timeline geometry, hotkeys, picker grid), see `PLAN-M2.md`. **M2b done**: ffmpeg frame decoding
   (timestamp-verified), `Workspace` + Tauri commands, the React Label tab with the generated settings panel,
   see `PLAN-M2B.md` (thumbnails and the Phase tab are the open items).
3. Phase tab (chart + flags + jump to frame): **done**, see `PLAN-M3.md` (phase and row charts, hover read-out,
   click a flag or point to open it in Label). Checked against the mock in the browser and compiled into the Tauri shim;
   not yet checked on a real labelled video.
3b. Timeline thumbnails: **done**, see `PLAN-M4.md` (one keyframe-only ffmpeg pass, disk cache, background job,
   picture row in the timeline; 3 new documented settings).
TODO (later): multi-fire labels. If a frame shows several fires, every one must show the same sprite, so one label
   is enough for now; two fires showing different rows in one frame would itself be suspicious and could become a flag.
TODO (found 2026-10-15 on real data, `validate_phase` on clip2): a client **freeze** (video frames identical for 2.4 s,
   game tick stuck for 142 frames, then +47 ticks in one frame) is flagged Hard as "not explainable by lag", which
   is the wrong wording, and the +47 catch-up contradicts the E4 claim that catch-up is capped at 10 per frame
   (`PHASE-EVIDENCE.md`). Re-check against the Yarn source before changing severities; consider a "frozen" explanation.
4. Linux pass (sidecars, webkit2gtk), packaging, then multi-fire labels.
