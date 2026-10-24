// Hotkeys for the Label tab: a pure mapping from a key event to an action. No DOM access here, so it is
// unit-testable; the React layer feeds it the event and executes the action.

export type Action =
  | { type: "step"; frames: number }
  | { type: "bigStep"; dir: 1 | -1 }
  | { type: "home" }
  | { type: "end" }
  | { type: "playPause" }
  | { type: "shuttle"; dir: -1 | 0 | 1 }
  | { type: "toggleSheet" }
  | { type: "toggleMirror" }
  | { type: "stepPhase"; dir: 1 | -1 }
  | { type: "digit"; digit: number }
  | { type: "acceptSuggestion" }
  | { type: "clear" }
  | { type: "noFire" }
  | { type: "skip" }
  | { type: "nextUnlabelled"; dir: 1 | -1 }
  | { type: "nextFlag"; dir: 1 | -1 }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "cancelTyping" };

/** What the handler needs to know about a keyboard event. */
export interface KeyInfo {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  repeat: boolean;
  /** The event target is editable; only global navigation/confirm keys may fire. */
  targetEditable: boolean;
  /** The target is a field that uses Enter and the arrows itself (marked `data-owns-keys`, e.g. the jump box): no key
   * is global there. */
  targetOwnsKeys?: boolean;
}

/** Canonical binding ids: `Ctrl+Alt+Shift+<key>`, letters lower case, space as `Space`. */
export type Bindings = Readonly<Record<string, Action>>;

function buildDefaults(): Bindings {
  const b: Record<string, Action> = {
    ArrowRight: { type: "step", frames: 1 },
    ArrowLeft: { type: "step", frames: -1 },
    ArrowUp: { type: "stepPhase", dir: -1 },
    ArrowDown: { type: "stepPhase", dir: 1 },
    "Shift+ArrowRight": { type: "bigStep", dir: 1 },
    "Shift+ArrowLeft": { type: "bigStep", dir: -1 },
    Home: { type: "home" },
    End: { type: "end" },
    Space: { type: "playPause" },
    j: { type: "shuttle", dir: -1 },
    k: { type: "shuttle", dir: 0 },
    l: { type: "shuttle", dir: 1 },
    t: { type: "toggleSheet" },
    r: { type: "toggleMirror" },
    Enter: { type: "acceptSuggestion" },
    "Shift+Enter": { type: "acceptSuggestion" },
    Backspace: { type: "clear" },
    x: { type: "noFire" },
    "Shift+x": { type: "skip" },
    n: { type: "nextUnlabelled", dir: 1 },
    "Shift+n": { type: "nextUnlabelled", dir: -1 },
    f: { type: "nextFlag", dir: 1 },
    "Shift+f": { type: "nextFlag", dir: -1 },
    "Ctrl+z": { type: "undo" },
    "Ctrl+y": { type: "redo" },
    "Ctrl+Shift+z": { type: "redo" },
    Escape: { type: "cancelTyping" },
  };
  for (let d = 0; d <= 9; d++) b[String(d)] = { type: "digit", digit: d };
  return b;
}

export const DEFAULT_BINDINGS: Bindings = buildDefaults();

/** Actions that may fire again while the key is held (everything else must not flood). */
export const REPEATABLE: ReadonlySet<Action["type"]> = new Set<Action["type"]>(["step", "bigStep"]);

/** The canonical id of a key event, e.g. `Shift+ArrowRight`, `Ctrl+z`, `Space`. Meta counts as Ctrl. */
export function bindingId(e: KeyInfo): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(e.key === " " ? "Space" : e.key.length === 1 ? e.key.toLowerCase() : e.key);
  return parts.join("+");
}

/** Reserved across focused controls in the Label workspace. */
export function isGlobalKey(e: Pick<KeyInfo, "key" | "ctrlKey" | "altKey" | "metaKey">): boolean {
  return !e.ctrlKey && !e.altKey && !e.metaKey && ["ArrowLeft", "ArrowRight", "Enter"].includes(e.key);
}

/** A global key the Label workspace takes before the focused control sees it (never inside a field that owns its keys). */
export function reservedGlobally(e: Pick<KeyInfo, "key" | "ctrlKey" | "altKey" | "metaKey" | "targetOwnsKeys">): boolean {
  return !e.targetOwnsKeys && isGlobalKey(e);
}

/** The action for a key event, or null (not bound, scoped typing, or unwanted auto-repeat). */
export function actionFor(e: KeyInfo, bindings: Bindings = DEFAULT_BINDINGS): Action | null {
  if (e.targetOwnsKeys) return null;
  if (e.targetEditable && !isGlobalKey(e)) return null;
  const id = bindingId(e);
  if (!Object.prototype.hasOwnProperty.call(bindings, id)) return null;
  const action = bindings[id];
  if (e.repeat && !REPEATABLE.has(action.type)) return null;
  return action;
}
