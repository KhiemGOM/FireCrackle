import { describe, expect, it } from "vitest";
import { DEFAULT_BINDINGS } from "./keymap";
import { TOOL_KEYS, dispatchToolKey, handleToolKey, resetToolKeys, wouldConsumeToolKey, type ChordState, type ToolKeyEvent } from "./toolKeys";

const ev = (key: string, over: Partial<ToolKeyEvent> = {}): ToolKeyEvent => ({
  key, type: "down", ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, repeat: false, targetEditable: false, ...over,
});
const up = (key: string, over: Partial<ToolKeyEvent> = {}) => ev(key, { type: "up", ...over });
const IDLE: ChordState = { mHeld: false };
const HELD: ChordState = { mHeld: true };

describe("the four tool keys", () => {
  it("Q toggles the quad mask, H first-person fire, M the matcher, U the ruler", () => {
    expect(handleToolKey(ev("q"), IDLE)).toMatchObject({ action: { type: "quad" }, consumed: true });
    expect(handleToolKey(ev("h"), IDLE)).toMatchObject({ action: { type: "firstPerson" }, consumed: true });
    expect(handleToolKey(ev("m"), IDLE)).toMatchObject({ action: { type: "matcher" }, consumed: true });
    expect(handleToolKey(ev("u"), IDLE)).toMatchObject({ action: { type: "ruler" }, consumed: true });
    expect(handleToolKey(ev("g"), IDLE)).toMatchObject({ action: { type: "refine" }, consumed: true });
  });

  it("works with Caps Lock (an upper-case key without Shift)", () => {
    expect(handleToolKey(ev("Q"), IDLE).action).toEqual({ type: "quad" });
    expect(handleToolKey(ev("M"), IDLE).action).toEqual({ type: "matcher" });
  });

  it("is documented in one list the help screen can show", () => {
    expect(TOOL_KEYS.map((k) => k.key)).toEqual(["q", "h", "m", "u", "g"]);
    for (const k of TOOL_KEYS) expect(k.description.length).toBeGreaterThan(10);
  });

  it("does not clash with a Label-tab hotkey or the mask's own P and E keys", () => {
    for (const k of TOOL_KEYS) {
      expect(DEFAULT_BINDINGS[k.key], k.key).toBeUndefined();
      expect(["p", "e"]).not.toContain(k.key);
    }
  });
});

describe("keys that must pass through", () => {
  it("ignores Ctrl, Alt, Meta and Shift combinations", () => {
    for (const mod of ["ctrlKey", "altKey", "metaKey", "shiftKey"] as const) {
      expect(handleToolKey(ev("m", { [mod]: true }), IDLE), mod).toMatchObject({ action: null, consumed: false });
    }
  });

  it("ignores typing in an input, textarea or select", () => {
    expect(handleToolKey(ev("q", { targetEditable: true }), IDLE)).toMatchObject({ action: null, consumed: false });
  });

  it("M typed in a field does not start the hold", () => {
    const typing = handleToolKey(ev("m", { targetEditable: true }), IDLE);
    expect(typing.state.mHeld).toBe(false);
    expect(handleToolKey(ev("1"), typing.state)).toMatchObject({ action: null, consumed: false });
  });

  it("leaves other keys alone", () => {
    for (const k of ["a", "j", "5", "Enter", "ArrowLeft", " "]) expect(handleToolKey(ev(k), IDLE), k).toMatchObject({ action: null, consumed: false });
  });

  it("a held tool key fires once: the repeats are swallowed without an action", () => {
    const first = handleToolKey(ev("q"), IDLE);
    expect(handleToolKey(ev("q", { repeat: true }), first.state)).toMatchObject({ action: null, consumed: true });
  });

  it("a held unrelated key is not swallowed", () => {
    expect(handleToolKey(ev("j", { repeat: true }), IDLE)).toMatchObject({ action: null, consumed: false });
  });
});

describe("M held down + 1, 2 or 3 picks a match (and only then)", () => {
  it("pressing M starts the hold and runs the matcher", () => {
    expect(handleToolKey(ev("m"), IDLE)).toMatchObject({ action: { type: "matcher" }, consumed: true, state: { mHeld: true } });
  });

  it("while M is held, 1, 2 and 3 pick the first, second and third match", () => {
    for (const [digit, index] of [["1", 0], ["2", 1], ["3", 2]] as const) {
      expect(handleToolKey(ev(digit), HELD), digit).toMatchObject({ action: { type: "candidate", index }, consumed: true, state: { mHeld: true } });
    }
  });

  it("the hold stays open across several picks: M + 1, 2, 3, 1", () => {
    let s = handleToolKey(ev("m"), IDLE).state;
    const picks: number[] = [];
    for (const d of ["1", "2", "3", "1"]) {
      const r = handleToolKey(ev(d), s);
      if (r.action?.type === "candidate") picks.push(r.action.index);
      s = r.state;
    }
    expect(picks).toEqual([0, 1, 2, 0]);
  });

  it("a digit without M held is always a row digit, even right after M was tapped", () => {
    for (const d of ["1", "2", "3"]) expect(handleToolKey(ev(d), IDLE), d).toMatchObject({ action: null, consumed: false });
    const tapped = handleToolKey(up("m"), handleToolKey(ev("m"), IDLE).state);
    for (const d of ["1", "2", "3"]) expect(handleToolKey(ev(d), tapped.state), `${d} after releasing M`).toMatchObject({ action: null, consumed: false });
  });

  it("releasing M ends the hold, and the release is swallowed", () => {
    expect(handleToolKey(up("m"), HELD)).toMatchObject({ action: null, consumed: true, state: { mHeld: false } });
  });

  it("releasing M when it was not held is not ours", () => {
    expect(handleToolKey(up("m"), IDLE)).toMatchObject({ action: null, consumed: false, state: { mHeld: false } });
  });

  it("releasing other keys does not end the hold", () => {
    for (const k of ["1", "q", "a", "Shift"]) expect(handleToolKey(up(k), HELD).state.mHeld, k).toBe(true);
  });

  it("the key repeats of a held M do not run the matcher again", () => {
    expect(handleToolKey(ev("m", { repeat: true }), HELD)).toMatchObject({ action: null, consumed: true, state: { mHeld: true } });
  });

  it("a held digit does not pick again on its repeats", () => {
    expect(handleToolKey(ev("1", { repeat: true }), HELD)).toMatchObject({ action: null, consumed: true });
  });

  it("0 and 4-9 are never picks: they pass through and the hold stays", () => {
    for (const d of ["0", "4", "9"]) expect(handleToolKey(ev(d), HELD), d).toMatchObject({ action: null, consumed: false, state: { mHeld: true } });
  });

  it("other keys pass through while M is held, and the hold stays", () => {
    for (const k of ["a", "Escape", "ArrowRight"]) expect(handleToolKey(ev(k), HELD), k).toMatchObject({ action: null, consumed: false, state: { mHeld: true } });
  });

  it("another tool key works while M is held", () => {
    expect(handleToolKey(ev("q"), HELD)).toMatchObject({ action: { type: "quad" }, state: { mHeld: true } });
  });

  it("a modifier with a digit is not a pick", () => {
    expect(handleToolKey(ev("1", { ctrlKey: true }), HELD)).toMatchObject({ action: null, consumed: false });
    expect(handleToolKey(ev("1", { shiftKey: true }), HELD)).toMatchObject({ action: null, consumed: false });
  });

  it("typing in a field is not a pick", () => {
    expect(handleToolKey(ev("1", { targetEditable: true }), HELD)).toMatchObject({ action: null, consumed: false });
  });

  it("pressing M again (a lost key-up) simply runs the matcher again", () => {
    expect(handleToolKey(ev("m"), HELD)).toMatchObject({ action: { type: "matcher" }, state: { mHeld: true } });
  });
});

describe("shared hold state (the pane acts, the main hotkeys step aside)", () => {
  it("a digit is claimed only while M is physically held", () => {
    resetToolKeys();
    expect(wouldConsumeToolKey(ev("1"))).toBe(false);
    expect(dispatchToolKey(ev("m")).action).toEqual({ type: "matcher" });
    expect(wouldConsumeToolKey(ev("1"))).toBe(true);
    dispatchToolKey(up("m"));
    expect(wouldConsumeToolKey(ev("1"))).toBe(false);
  });

  it("asking whether a key would be claimed does not change anything", () => {
    resetToolKeys();
    dispatchToolKey(ev("m"));
    for (let i = 0; i < 5; i++) expect(wouldConsumeToolKey(ev("1"))).toBe(true);
    expect(dispatchToolKey(ev("1")).action).toEqual({ type: "candidate", index: 0 });
  });

  it("losing focus (the window blurs while M is down) releases the hold", () => {
    resetToolKeys();
    dispatchToolKey(ev("m"));
    resetToolKeys();
    expect(wouldConsumeToolKey(ev("1"))).toBe(false);
  });

  it("the tool keys themselves are claimed so the main hotkeys leave them alone", () => {
    resetToolKeys();
    for (const k of ["q", "h", "m", "u"]) expect(wouldConsumeToolKey(ev(k)), k).toBe(true);
    expect(wouldConsumeToolKey(ev("q", { ctrlKey: true }))).toBe(false);
  });
});
