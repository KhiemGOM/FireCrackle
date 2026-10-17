// The key that turns post-processing on and off. A pure mapping (no DOM); the hook feeds it the key event.
export const POST_TOGGLE_KEY = "v";

export interface PostKeyEvent {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  /** The event target is a text field: typing a letter there must not toggle anything. */
  targetEditable: boolean;
}

export function postKeyAction(e: PostKeyEvent): "toggle" | null {
  if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.repeat || e.targetEditable) return null;
  return e.key.toLowerCase() === POST_TOGGLE_KEY ? "toggle" : null;
}

export interface TypingTarget { tagName?: string; type?: string; isContentEditable?: boolean }

/** A place where letters are typed, so a letter key must not act as a shortcut. Sliders and checkboxes are not. */
export function isTypingTarget(t: TypingTarget | null | undefined): boolean {
  if (!t) return false;
  if (t.isContentEditable) return true;
  const tag = (t.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  return tag === "INPUT" && !["range", "checkbox", "radio", "button", "submit", "reset", "color", "file"].includes((t.type ?? "").toLowerCase());
}
