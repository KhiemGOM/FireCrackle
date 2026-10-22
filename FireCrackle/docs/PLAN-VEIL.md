# Undo the GUI veil (plan)

**Status: built (2026-10-17).** 610 TypeScript tests (27 `veil`, 15 `veilFrame`/preferences/settings glue), 478 Rust
tests (3 new settings, 49 in all), `tsc` and the Vite build clean. Checked in the browser on real frames of the
18-18-16 recording, decoded the way the app does (1280x720 JPEG): on 8 frames with no veil the detector flagged none,
on 6 truly veiled frames it flagged all 6, and the one frame whose recorder label said veil >= 0.6 but which shows
plain gameplay was correctly not flagged; a pause-menu frame comes back with the fire world visible (menu buttons
go bright, as they were never veiled). Detect + undo + re-encode takes about 80-150 ms per 720p frame (JPEG q0.95;
a lossless PNG needed about a second, so it was not used). Deviations, stated openly: the tool is a per-pane
Off / Auto-undo / Always undo select in the video tools (remembered), not an entry in "Optional automation", since it
changes how every picture is shown; photos in the Images tab use the default thresholds, because that tab is not given
the settings; the re-encode is JPEG, so an undone frame carries one extra lossy pass. Not verified: the real Tauri
window.

Goal: a video tool that removes the darkening Minecraft draws behind an open screen (pause menu, inventory, ...),
so the fire under it can be read and matched by eye or by the quad match. The maths is the detector's, already
validated in `fire-detection/core/src/veil.rs` (detect) and `features.rs::unveil_rows` (reverse); this ports it to the
app. Constants are the game's, not thresholds: `Screen.renderBackground` fills the screen with
`fillGradient(0xC0101010 -> 0xD0101010)`, i.e. colour (16,16,16) with alpha 192/255 at the top row and 208/255 at the
bottom, so `out = 16a + p(1-a)` and `p = (out - 16a) / (1 - a)` per row (see `fire-detection/core/DETECT_PLAN.md`,
results 8 and 13). The three judgement thresholds are documented Settings.

## Behaviour

- Video tools get a **Veil** control with three modes: *Off* (default, the picture is untouched), *Auto* (undo only
  when the frame looks veiled), *On* (undo every frame, for when detection is wrong). Mode is a remembered UI
  preference.
- The undone picture replaces the displayed frame (blob URL in `VideoPane`), so the quad mask, the sprite matcher and
  the comparison proof all see it. A small tag says "veil undone" while it is applied.
- Detection (from the Rust detector): only the outer 20% of the width each side is judged (inventory panels and
  buttons sit in the middle); a frame is veiled when at least 90% of those pixels lie inside the legal veiled
  range `[16*a_top - slack, 16*a + 255*(1-a) + slack]` on every channel.
- Settings: `label.veil_min_share` (0.9), `label.veil_margin` (0.20), `label.veil_slack` (2).

## Ways this can break (tests first)

- A real dark scene has true blacks (below the veil floor): must NOT be detected. A plain black frame: not veiled; a
  veiled black frame: veiled.
- Bright widgets over the veil (about 6% of the frame), or a big inventory panel in the middle: still veiled.
  A veil-looking middle inside an unveiled scene: not veiled.
- Reversal: round trip within the 8-bit rounding (about 1/(1-a), so up to 3 levels), clamped to 0..255, alpha
  channel untouched, the input never mutated, row alpha grows top to bottom, a pixel below the veil floor clamps to 0.
- Bad input: pixel buffer not `w*h*4`, zero size, thresholds out of range (share not in (0,1], margin not in (0,0.5],
  negative slack) are errors, never NaN pictures.
- Decode/encode failure of the picture must fall back to the original frame (never a blank picture) and say so.
- Both video frames and still photos go through the same path; a changed mode or threshold re-processes the frame
  shown.

## Tests first

TS: `src/lib/veil.test.ts` (port of `fire-detection/core/tests/veil.rs` and the `unveil_rows` tests, including the
random exhaustive-reference parity check). Rust: `tests/config.rs` and `tests/workspace.rs` count the 3 new
settings (49). Red first, then implement.
