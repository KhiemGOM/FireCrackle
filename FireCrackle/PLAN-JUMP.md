# Jump to a typed timecode or frame

User request (2026-10-17): "add so u can manually type and input the 00:00:00|00 or the frame count to jump to that".

## Behaviour

- In the video status bar, the frame number (`frame 1234 / 99999`) and the timecode (`00:00:20|34`) become clickable.
  Clicking either opens one small text box, prefilled with what was clicked and all selected.
- **Enter** jumps; **Escape** or clicking away closes it without jumping. Keys typed in the box never reach the app's
  shortcuts (arrows, M chord, Space…).
- What can be typed:
  - a whole number: a **frame** (`1234`), the same numbers the status bar shows (0 … frame count − 1);
  - a **timecode**, the status bar's own format `HH:MM:SS|FF`, where FF is the frame inside the second at the
    video's nominal rate (`round(fps)`, as `formatTimecode` writes it). Shorter forms count from the right:
    `MM:SS|FF`, `SS|FF`, `HH:MM:SS`, `MM:SS`. Hours may run past 99.
- **Resolving a time.** Real recordings are not perfectly constant-rate, so the time goes to the backend's
  `jolt_frame`: the frame whose timestamp is nearest, the same time base the status bar shows. With no backend
  (browser mock), it uses `current + round((t − pts_now) · fps)`, clamped.
- Jumping stops playback, like stepping does, and goes through the existing `goTo` action.

## Failure cases (tests first)

- Empty, letters, a bare decimal (`12.5`: frame or seconds?), a negative number, `1:2:3:4`, a dangling `|`, `|` with
  no time → refused with a message saying what to type; the box stays open with the text.
- FF ≥ the nominal rate (`|60` at 60 fps), seconds ≥ 60 or minutes ≥ 60 when a larger unit is given → refused, not
  wrapped.
- A frame past the last one → refused with the valid range (not silently clamped). A time past the end resolves to the
  last frame (nearest), which is what "nearest" means.
- fps 0 / NaN / negative → the nominal rate is 1, as in `formatTimecode`.
- Round trip: for any frame time, typing back `formatTimecode(t)` lands on that frame (CFR fallback) — the parse is the
  exact inverse of the display.
- The backend lookup fails → the error is shown, nothing jumps.
- A still photo (Images tab) has no timecode: the box is not offered there.
- Typing in the box must not trigger app shortcuts; leaving the frame while typing (playback) must not lose the text.

## Status (2026-10-17): built, not committed

**Files**
- `src/lib/jump.ts`: `parseJump`, `resolveJump`.
- `src/components/JumpBox.tsx` + `.css`.
- Hook-ups through the patch queue:
  - `VideoPane.tsx` (batch 82): the `onGoTo` prop, and `locate` via `backend.joltFrame(videoKey, t)`;
  - `App.tsx` (batch 83): passes `onGoTo` (stops playback, `goTo`);
  - `App.tsx` (batch 84): the keys fix below.
- The queue lowercased both file names on publish again; they were renamed back with identical hashes.

**Tests**
- `jump.test.ts` and `JumpBox.interaction.test.ts`: 36 tests, red first (module missing).
- The interaction test later got a type-only fix (typed `vi.fn` signatures) after `tsc` flagged it; no expectation
  changed.

**Found in the browser: the global keys.** In the browser, real Enter / ← / → never reached the box: `App.tsx`
reserves those as global Label keys in the capture phase, even inside text fields (Enter = confirm candidate). Fix,
tests first (red: `reservedGlobally` missing, `keyInfo` without the flag, the box without the mark):
- `keymap.ts`: `KeyInfo.targetOwnsKeys`, and `reservedGlobally()`, which is `isGlobalKey` except in such a field.
  `actionFor` returns null there.
- `actions.ts`: `keyInfo` sets the flag from `data-owns-keys="true"`.
- The jump input carries `data-owns-keys`, and `App.tsx` uses `reservedGlobally`.
- Other text fields keep the old behaviour; pinned by tests.

**Verified in the browser (mock backend, 30 fps, no `joltFrame`, so the fallback path)**
- `00:00:10|15` + Enter → frame 315 (`00:00:10|15`); ← inside the box moved the caret, not the frame.
- `1500` → frame 1500 (`00:00:50|00`).
- `00:00:12|30` is refused ("must be 00–29"); the box stays open with the text and the frame is unchanged.
- Escape closes it.
- No console errors from it. The duplicate-key warning (`VideoPane`/`Timeline` sharing `key={ws.videoPath}`)
  predates this change.
- `tsc` clean, 729 frontend tests green.

**Not verified:** the real Tauri window with `jolt_frame` on a real recording. It is the same call the Phase tab already
uses for "open video at this time".
