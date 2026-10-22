# M3: the Phase tab (plan)

**Status: built.** 370 Rust tests (13 `chart`, 10 `phase_chart`, written red first and unchanged), 128 TypeScript
tests (23 in `chart.test.ts`), `tsc` and the Vite build clean. In the browser against the mock: tab switch, charts,
hover read-out, clicking a flag jumps to the frame in Label. Not verified: a real labelled video in the Tauri window;
flag spans use `frame / fps` for x (exact for constant frame rate, approximate for VFR).

Goal: a chart of the fire phase against video time that makes a cut, a reload or a lag stall visible at a glance,
with every flag listed and clickable (jump to the frame in the Label tab). No new phase rules: this tab only
*draws* the existing `phase::analyze` result (rules and evidence: `PHASE-EVIDENCE.md`, `PLAN-M1.md`).

## What is drawn

1. **Phase vs time**: `phi = (tick_rate*pts - step) mod 32`, drawn relative to the first run's centre in
   (-16, 16] ticks so a steady stretch is a flat line and a cut is a visible step. Run arcs are shaded bands;
   flags are coloured spans (hard red, soft amber) with the delta.
2. **Row vs time**: the displayed step per labelled frame (the sawtooth), for eyeballing against the footage.
3. **Flag list** (sorted by frame): kind, severity, delta in ticks, time; click = jump to the frame in Label.

## Backend

- `chart::decimate(points, max_points)`: a one-hour video has ~200k points, the canvas has ~2k pixels. Buckets keep
  the first, last, and the two phase extremes (relative to the bucket's first point, circular) so an outlier or a
  stall is never averaged away. Output is in frame order, never longer than `max_points`, always keeps the very
  first and last point.
- `Workspace::phase_chart(max_points)` -> `PhaseChart { points, runs, flags, tick_rate, window_ticks }` (serde).
  Cached analysis, so it is free after the first call.
- Tauri command `phase_chart`; mock backend produces the same shape.

## Ways this can break (tests cover each)

- No fire labels / one fire label / all labels non-fire: empty or single-point chart, no panic, no division by 0.
- More points than the cap: output within the cap, extremes (an isolated outlier) survive, order kept, ends kept.
- `max_points` 0, 1, 2 (smaller than the 3 samples per bucket): still valid (0 -> empty; ends kept when possible).
- Phase near the 0/32 seam: bucket extremes must be circular, not numeric (a run at phase 31.9 and 0.1 is flat).
- Labels edited or settings changed after a chart call: cache must not serve a stale chart.
- TS: relative phase wrap at +-16, x scale for zero duration / single point, hit-testing a flag span and the
  nearest point, flag spans narrower than a pixel must still be hittable (minimum hit width).
- Hotkeys must not fire on the Phase tab's inputs; leaving the Label tab must not stop autosave.

## Tests first

Rust: `tests/chart.rs` (decimate), `tests/workspace.rs` (phase_chart). TS: `src/lib/chart.test.ts`.
Red run first, then implement; test files unchanged between red and green.
