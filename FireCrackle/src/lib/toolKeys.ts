// Keys for the four video tools. Pure state machine (no DOM): the pane feeds it key events and runs the action.
//   Q quad mask · H first-person fire (HUD) · M sprite matcher · U ruler
//   Hold M and press 1 / 2 / 3: preview the 1st / 2nd / 3rd match. The digits only count while M is physically held
//   down, so they can never be mistaken for sprite-row digits.

export type ToolAction =
  | { type: "quad" }
  | { type: "firstPerson" }
  | { type: "matcher" }
  | { type: "ruler" }
  | { type: "candidate"; index: 0 | 1 | 2 };

export interface ToolKeyEvent {
  key: string;
  type: "down" | "up";
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  /** The event target is a text field or select: typing must not trigger tools. */
  targetEditable: boolean;
}

export interface ChordState {
  /** M is physically down (set on its key-down, cleared on its key-up or when the window loses focus). */
  mHeld: boolean;
}

export interface ToolKeyResult {
  action: ToolAction | null;
  /** The key was used (or deliberately swallowed): the caller prevents its default and stops it going further. */
  consumed: boolean;
  state: ChordState;
}

/** The documented keys, for the help screen and tooltips. Must not collide with the Label keymap (tested). */
export const TOOL_KEYS: ReadonlyArray<{ key: string; description: string }> = [
  { key: "q", description: "Quad mask: show or hide the manual fire quad" },
  { key: "h", description: "First-person fire: show or hide the HUD fire overlay" },
  { key: "m", description: "Sprite matcher: open and find the best match, or close if already open; hold M while opening and press 1, 2 or 3 to preview a match" },
  { key: "u", description: "Ruler: show or hide the calibrated ruler" },
];

const IDLE: ChordState = { mHeld: false };
const ACTIONS: Record<string, ToolAction> = {
  q: { type: "quad" },
  h: { type: "firstPerson" },
  m: { type: "matcher" },
  u: { type: "ruler" },
};

/**
 * Interpret one key event. Anything that is not a tool key passes through (`consumed` false); a digit is only a match
 * pick while M is held.
 */
export function handleToolKey(e: ToolKeyEvent, state: ChordState): ToolKeyResult {
  const pass = (): ToolKeyResult => ({ action: null, consumed: false, state });
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  if (e.type === "up") {
    // only M's release is ours; the other releases must not end the hold
    return key === "m" && state.mHeld ? { action: null, consumed: true, state: IDLE } : pass();
  }
  if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.targetEditable) return pass();

  const tool = ACTIONS[key];
  if (tool) {
    if (e.repeat) return { action: null, consumed: true, state }; // a held key fires once
    return { action: tool, consumed: true, state: key === "m" ? { mHeld: true } : state };
  }
  if ((key === "1" || key === "2" || key === "3") && state.mHeld) {
    if (e.repeat) return { action: null, consumed: true, state };
    return { action: { type: "candidate", index: (Number(key) - 1) as 0 | 1 | 2 }, consumed: true, state };
  }
  return pass();
}

// One hold for the whole window: the pane that is showing runs `dispatchToolKey`; the main hotkeys ask
// `wouldConsumeToolKey` first and step aside (they register earlier, so they would otherwise read the 1 as a row digit).
let shared: ChordState = IDLE;

export function dispatchToolKey(e: ToolKeyEvent): ToolKeyResult {
  const result = handleToolKey(e, shared);
  shared = result.state;
  return result;
}

/** Whether a tool would use this key right now, without changing anything. */
export function wouldConsumeToolKey(e: ToolKeyEvent): boolean {
  return handleToolKey(e, shared).consumed;
}

/** Forget a held M (the window lost focus, so its key-up may never arrive). */
export function resetToolKeys(): void {
  shared = IDLE;
}
