# Warn before replacing a saved label

User request (2026-10-18): when a frame is already labelled and the candidate is different, so Confirm / Enter is
going to replace the saved label, make the Confirm button red so nobody relabels by habit. The user then narrowed it:
only the button, no red panel ("the replace button red is enough").

## Behaviour

- `replacedLabel(view, candidate)` (`src/lib/labelCandidate.ts`) returns the saved label that Confirm would overwrite,
  or null.
- The Confirm button then turns red and reads **Replace ↵**; its tooltip names the saved label being replaced and
  says Undo restores it. Enter does the same thing as the button, and it is the same save as before.
- Nothing else changes: not the panel, not the heading, no extra line.

## Cases (tested first; `labelCandidate.test.ts`)

- Warns: a saved fire label with a different row, sheet or mirror; fire → no fire or skip; no fire or skip → fire or
  each other. Checked for every pair of six labels: it warns exactly when the two differ.
- Does not warn:
  - an unlabelled frame (a time guess is not a label);
  - the candidate is the saved label itself (no draft, or the same label picked again);
  - nothing to confirm (no candidate, or an invalid typed row);
  - a draft made on another frame.

## Status (2026-10-18): built, not committed

- `labelCandidate.ts` + test (7 new tests, red first: function missing).
- `App.tsx` and `App.css` through the patch queue (batches 105/106, then 107/108 after the user dropped the red
  panel). The queue lowercased both file names again; renamed back, hashes identical.
- `tsc` clean, 879 frontend tests green.
- Browser (mock backend): saved row 7, picked row 9 → red "Replace ↵" (rgb 255,77,79), panel and heading unchanged,
  no warning line; Escape → back to the normal "Confirm ↵"; with the candidate equal to the saved label, "Confirm".
- One type-only fix to my own test after `tsc` flagged an excess property (`{ ...view, suggestion: null }`); no
  expectation changed.
- Not tried in the real Tauri window.
