import { describe, expect, it } from "vitest";
import { POST_TOGGLE_KEY, isTypingTarget, postKeyAction, type PostKeyEvent } from "./keys";
import { DEFAULT_BINDINGS } from "../keymap";
import { TOOL_KEYS } from "../toolKeys";

const ev = (over: Partial<PostKeyEvent> = {}): PostKeyEvent => ({ key: "v", ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, repeat: false, targetEditable: false, ...over });

describe("post-processing toggle key", () => {
  it("toggles on a plain press, in either letter case", () => {
    expect(postKeyAction(ev())).toBe("toggle");
    expect(postKeyAction(ev({ key: "V" }))).toBe("toggle");
  });

  it("ignores other keys, any modifier, key repeat and typing in a text field", () => {
    expect(postKeyAction(ev({ key: "b" }))).toBeNull();
    for (const m of ["ctrlKey", "altKey", "metaKey", "shiftKey"] as const) expect(postKeyAction(ev({ [m]: true }))).toBeNull();
    expect(postKeyAction(ev({ repeat: true }))).toBeNull();
    expect(postKeyAction(ev({ targetEditable: true }))).toBeNull();
  });

  it("uses a key nothing else uses", () => {
    expect(POST_TOGGLE_KEY).toBe("v");
    expect(Object.keys(DEFAULT_BINDINGS).map(k => k.toLowerCase())).not.toContain(POST_TOGGLE_KEY);
    expect(TOOL_KEYS.map(k => k.key)).not.toContain(POST_TOGGLE_KEY);
    expect(["p", "e"]).not.toContain(POST_TOGGLE_KEY); // the mask keys in VideoPane
  });
});

describe("what counts as typing", () => {
  it("is a text field, text area, select or editable element", () => {
    expect(isTypingTarget({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(isTypingTarget({ tagName: "INPUT", type: "number" })).toBe(true);
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTypingTarget({ tagName: "SELECT" })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("is not a slider, a checkbox, a button or the page itself, so the key still works after a slider was dragged", () => {
    expect(isTypingTarget({ tagName: "INPUT", type: "range" })).toBe(false);
    expect(isTypingTarget({ tagName: "INPUT", type: "checkbox" })).toBe(false);
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTarget({ tagName: "BODY" })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
