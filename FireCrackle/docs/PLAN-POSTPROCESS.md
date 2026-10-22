# Plan: post-processing ("Enhance") for the picture being labelled

Status: Phase 0 is built (uncommitted at the time of writing). Agreed in chat: one in-app panel (no OS window) that takes
the place of the right side's content; a vertical list of effects where each row is its own tab with its on/off switch
INSIDE the row (selecting a row and switching it are separate); switched-on effects come first and show the order they are
applied in, switched-off ones sit after them (the stored order is kept, so switching back restores the place); Veil and
Portal are pinned first. A master on/off (key V, a button in the right side's header and one in the panel) turns all
post-processing off without losing any setting.

## Goal and rules

- Help a person see the frame better (dark scenes, compression, GUI darkening, portal overlay). Viewing only.
- The detector, GUI mask, match, phase and exports keep receiving the ORIGINAL frames. A test must prove it.
- Veil and portal stay the single Rust/WASM implementations (`veil.rs`, `portal.rs`); this panel only calls them.
  New generic image operations (tone, sharpen...) are new code and live in one small tested TypeScript module.
- Off means off: with every stage off the original blob is shown untouched (no re-encode), as today.

## What exists today

- `VideoPane` has two selects (Veil Off/Auto/Always, Portal Off/Auto) and a `useEffect` that calls `processFrame`
  (`lib/veilFrame.ts`): decode once, unveil, portal (in a worker), encode once as JPEG 0.95, with a cancel token per frame.
- Preferences `veilMode` / `portalMode` live in `lib/preferences.ts`.
- The right `<aside>` is the label side (candidate, picker). It must stay available while labelling, so Enhance is a
  toggle at the top of that aside (Label | Enhance) that swaps the content, not a replacement.

## Design

### Settings model (one object, versioned, persisted)

`{ veil: Off|Auto|On, portal: {mode: Off|Auto|Manual, phase, opacity}, order: StageId[], stages: {id: {on, params}} }`
saved under `firecrackle.post.v1`. Old `veilMode`/`portalMode` values seed it once, so nobody loses their setting.
Recommendation: global (not per video) plus presets ("Dark scene", "Compressed"); per-video can come later.

### Pipeline order

1. Veil, 2. Portal (exact inverses, always first, on raw pixels, not draggable).
3. User-ordered enhancement stages. Consecutive point operations (gamma, levels, contrast, shadow lift) are merged into
   ONE lookup table, so they cost one pass and do not round twice.
4. Encode once.

### Stages by phase

- Phase 0 (foundation): panel shell, settings + persistence, pure pipeline + worker, Veil and Portal moved in, one stage
  (tone: gamma, levels, contrast, shadow lift), compare-hold, Reset.
- Phase 1: sharpen (unsharp mask), fire-hue / channel view, presets.
- Phase 2: portal Manual (phase 0..N and opacity sliders seeded from the current fit, using the existing `portal_inverse`
  ABI) and Auto fallback "reuse last good fit". The fallback needs a core change (fit the phase with opacity fixed) and
  first a measurement: is the fitted opacity constant across a clip? Do not build it before that is known.
- Phase 3: deblur (capped Wiener/RL), denoise/deblock, nearest-neighbour zoom with texture grid, difference to previous
  frame.

### UI

Vertical list. Row = order badge (on rows only, counted among the rows that are on), name, earlier/later buttons, on/off switch.
Selecting a row expands its controls inline. Reordering is by the earlier/later buttons (keyboard friendly); dragging
comes with Phase 1, when there is more than one effect to reorder. Pinned rows have no move buttons. Switching an effect
on or off regroups the list (on first), as the user asked, without changing the stored order.

## How it can break (and what stops it)

| Risk | Guard |
|---|---|
| Non-linear stage before an inverse corrupts it | Veil/Portal pinned first; test that order cannot be changed |
| Forced portal paints a texture into a frame with no portal | Portal Manual shows a "manual" tag and valid-pixel coverage; Auto never forces |
| 8-bit rounding and clipping pile up across stages | merge point ops into one LUT; each stage clamps; test identity at default strength |
| 4K frames stall the UI | run in a worker; slider drags use a downscaled preview (max 960 wide), full size on release |
| Slider drag floods work, old result shows after new | debounce + abort token, last request wins; test with out-of-order completion |
| Everything off re-encodes the JPEG (quality loss, wasted time) | all-off returns the original blob; regression test |
| Sharpen amplifies JPEG blocks; deblur rings | strength caps, preview vs original compare, tag "Enhanced" |
| Alpha (PNG stills) altered | stages leave alpha untouched; test |
| Tiny image (blur radius > image, <32 px portal) | stages clamp radius; portal reports "too small", no throw |
| Saved settings corrupt, from an older/newer build | unknown stage ids dropped, missing ones appended, bad values reset to defaults |
| Detector fed processed pixels by accident | test: GUI mask / match / phase / export receive original bytes |
| Compare key clashes with an existing shortcut | check `useKeys`/JumpBox bindings before choosing; test no clash |
| Fire-hue view mistaken for detection | label it "view aid"; never reuse in detection (known GUI colours are not fire evidence) |
| Object URL leaks on rapid changes | keep the existing revoke pattern; test revoke count |
| Moving the selects out of VideoPane breaks its tests and stored prefs | move behind props, migrate prefs, update `VideoPane.interaction.test.ts` |
| Portal needs local game textures that may be missing | row disabled with a clear message, not an error |

## Tests (written first, red, then green)

Pure: each stage at strength 0 is identity; known pixel results for gamma/levels/contrast/unsharp; LUT merge equals
sequential application within 1 level; alpha preserved; tiny images; order engine (pinned rows, move, enabled-only
numbering, toggle does not move); settings parse/migrate/repair; abort ordering. Component: row list, badges, dimming,
drag and button reorder, compare hold. App: Label|Enhance toggle, original frames to consumers, VideoPane uses the settings.

## What Phase 0 changed from this plan

- Compare-hold was dropped: the master switch (key V, buttons) shows original vs processed and is simpler.
- Tone runs on the main thread: a 256-entry table pass is cheap. The worker comes with sharpen (Phase 1). Slider drags are
  delayed 80 ms (`usePostSettings`), switches apply at once.
- Corrections run only while paused (another agent's `correctionGate`): playing shows plain frames, so Enhance, veil and
  portal all wait for a pause.
- The Veil/Portal selects moved out of the video toolbar into the panel; without the `post` prop `VideoPane` still shows them.
- Old `veilMode`/`portalMode` preferences seed the new settings once.
- Files: `src/lib/post/` (settings, order, tone, pipeline, keys), `components/EnhancePanel.tsx/.css`,
  `hooks/usePostSettings.ts`, `processFrame`'s new enhancement stage, `VideoPane` `post`/`onPortalStatus` props, App's
  Label | Enhance switch.

## Phases 1 to 3: what was built, what was not

Built (tests first, all green):
- Effects are now a table (`lib/post/stages.ts`): name, neutral values, controls, identity test, apply. Settings, pipeline,
  presets and the panel all read it, so a new effect is one entry. Effect rows: Tone, Denoise, Deblur, Sharpen, Fire view,
  Channels (default order in that sequence; the user can reorder the ones that are on).
- Sharpen: unsharp mask on brightness only (no colour fringes). Deblur: Richardson-Lucy on brightness, capped at ten
  iterations, clamped to 0..255. Denoise: bilateral filter (strength, radius 1 to 3). Fire view: keeps orange, dims the rest;
  labelled a view aid and never used by detection. Channels: R, G, B or brightness as grey.
- Presets (Dark scene, Compressed footage, Fire focus) in the panel header; they set the effects only.
- Portal Manual: Off / Auto / Manual. Manual applies the chosen phase (0 to 31) and opacity with the existing
  `portal_inverse` ABI (`undoPortalManual`), through the same GUI-protecting world mask, and "Use last fit" copies what the
  last automatic fit found (reported by VideoPane through `onPortalFit`).

Measured cost on the main thread (this machine): 1080p, tone 5 ms, fire view 25 ms, sharpen 64 ms, all three 137 ms;
4K, sharpen 317 ms, all three 498 ms. Fine for a paused picture; a worker is the next step if 4K feels slow.

Not built, and why:
- **Auto fallback "reuse the last good fit"**: `bench/no_fire/PORTAL-RESULTS.md` shows the overlay opacity follows
  0.2 + 0.8 * t^4 and moved from 0.39 to 0.48 to 0.99 within about 20 seconds of one video. Opacity is not constant across
  a clip, so carrying a fit to a distant frame would be wrong. Only adjacent frames could share an opacity, and that needs
  a core change (fit the phase with opacity fixed) validated on real portal footage. Manual covers the case where Auto
  fails; revisit with footage.
- **Zoom with texture grid**: VideoPane already has zoom and a pixel grid.
- **Difference to the previous frame**: needs the neighbouring frame decoded next to the current one, which depends on the
  frame-buffer work that is still being finished (job 171).
- **Worker for the heavy effects**, and dragging to reorder (the earlier/later buttons exist).

## UX pass (after trying Phase 0 to 3)

Asked for and built: moving any control of an effect switches it on; a dot marks an effect whose controls are away from
neutral; a slider resets on double-click, can be typed into (a number box) and moves a fine step with Shift + arrow; the
slider line is filled up to the value, has a tick at the neutral value, and a thin thumb so it sits at the very end of the
line at the minimum and maximum; presets are buttons (pressing the active one clears the effects), you can save the
effects that are on under a name and delete your own presets (kept in `firecrackle.post.presets.v1`). The built-in presets
were retuned by eye on real recordings: Dark scene, Compressed footage, Fire focus, Texture edges, Soft footage.
Declined: hold-to-peek (V is enough) and grouping the rows.

## Decisions for the user

1. Global settings plus presets (recommended) or per video.
2. Enhance as a toggle inside the right aside (recommended) or a floating in-app window over the video.
3. Compare-hold key (to be chosen after checking existing shortcuts).
4. Phase 2 portal fallback only after the opacity measurement.
