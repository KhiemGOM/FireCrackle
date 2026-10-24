import { describe, expect, it } from "vitest";
import { DEFAULT_BINDINGS, REPEATABLE, actionFor, bindingId, reservedGlobally, type Action, type KeyInfo } from "./keymap";

function key(k: string, mods: Partial<KeyInfo> = {}): KeyInfo {
  return {
    key: k,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
    targetEditable: false,
    ...mods,
  };
}

describe("binding ids", () => {
  it("names plain keys, modifiers and space canonically", () => {
    expect(bindingId(key("ArrowRight"))).toBe("ArrowRight");
    expect(bindingId(key("ArrowRight", { shiftKey: true }))).toBe("Shift+ArrowRight");
    expect(bindingId(key("z", { ctrlKey: true }))).toBe("Ctrl+z");
    expect(bindingId(key("z", { ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+z");
    expect(bindingId(key("s", { altKey: true }))).toBe("Alt+s");
    expect(bindingId(key("s", { ctrlKey: true, altKey: true, shiftKey: true }))).toBe("Ctrl+Alt+Shift+s");
    expect(bindingId(key(" "))).toBe("Space");
    expect(bindingId(key("5"))).toBe("5");
  });

  it("lower-cases letters, so caps lock and shift do not change which key it is", () => {
    expect(bindingId(key("S"))).toBe("s");
    expect(bindingId(key("N", { shiftKey: true }))).toBe("Shift+n");
  });

  it("treats the meta key as ctrl", () => {
    expect(bindingId(key("z", { metaKey: true }))).toBe("Ctrl+z");
    expect(bindingId(key("z", { metaKey: true, ctrlKey: true }))).toBe("Ctrl+z");
  });
});

describe("default bindings", () => {
  const cases: Array<[KeyInfo, Action]> = [
    [key("ArrowRight"), { type: "step", frames: 1 }],
    [key("ArrowLeft"), { type: "step", frames: -1 }],
    [key("ArrowUp"), { type: "stepPhase", dir: -1 }],
    [key("ArrowDown"), { type: "stepPhase", dir: 1 }],
    [key("ArrowRight", { shiftKey: true }), { type: "bigStep", dir: 1 }],
    [key("ArrowLeft", { shiftKey: true }), { type: "bigStep", dir: -1 }],
    [key("Home"), { type: "home" }],
    [key("End"), { type: "end" }],
    [key(" "), { type: "playPause" }],
    [key("j"), { type: "shuttle", dir: -1 }],
    [key("k"), { type: "shuttle", dir: 0 }],
    [key("l"), { type: "shuttle", dir: 1 }],
    [key("t"), { type: "toggleSheet" }],
    [key("r"), { type: "toggleMirror" }],
    [key("Enter"), { type: "acceptSuggestion" }],
    [key("Backspace"), { type: "clear" }],
    [key("x"), { type: "noFire" }],
    [key("x", { shiftKey: true }), { type: "skip" }],
    [key("n"), { type: "nextUnlabelled", dir: 1 }],
    [key("n", { shiftKey: true }), { type: "nextUnlabelled", dir: -1 }],
    [key("f"), { type: "nextFlag", dir: 1 }],
    [key("f", { shiftKey: true }), { type: "nextFlag", dir: -1 }],
    [key("z", { ctrlKey: true }), { type: "undo" }],
    [key("Escape"), { type: "cancelTyping" }],
  ];
  for (const [event, action] of cases) {
    it(`${bindingId(event)} -> ${action.type}`, () => {
      expect(actionFor(event)).toEqual(action);
    });
  }

  it("maps the digit keys to digits", () => {
    for (let d = 0; d <= 9; d++) {
      expect(actionFor(key(String(d)))).toEqual({ type: "digit", digit: d });
    }
  });

  it("works with caps lock (upper-case letters)", () => {
    expect(actionFor(key("T"))).toEqual({ type: "toggleSheet" });
    expect(actionFor(key("N", { shiftKey: true }))).toEqual({ type: "nextUnlabelled", dir: -1 });
  });

  it("accepts the meta key for undo (macOS)", () => {
    expect(actionFor(key("z", { metaKey: true }))).toEqual({ type: "undo" });
  });

  it("gives every default binding a distinct id", () => {
    const ids = Object.keys(DEFAULT_BINDINGS);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(cases.length + 10);
  });
});

describe("what must not fire", () => {
  it("leaves other typing keys alone in text fields", () => {
    for (const k of ["s", "5", " ", "Backspace", "Escape"]) {
      expect(actionFor(key(k, { targetEditable: true })), k).toBeNull();
    }
  });

  it("keeps confirm and frame navigation global while editing", () => {
    for (const targetEditable of [false, true]) {
      expect(actionFor(key("Enter", {targetEditable}))).toEqual({type:"acceptSuggestion"});
      expect(actionFor(key("Enter", {targetEditable,shiftKey:true}))).toEqual({type:"acceptSuggestion"});
      expect(actionFor(key("ArrowRight", {targetEditable}))).toEqual({type:"step",frames:1});
      expect(actionFor(key("ArrowLeft", {targetEditable,shiftKey:true}))).toEqual({type:"bigStep",dir:-1});
    }
  });

  it("ignores keys that are not bound", () => {
    expect(actionFor(key("m"))).toBeNull();
    expect(actionFor(key("s"))).toBeNull();
    for (const k of ["q", "a", "F5", "Tab", "PageDown", "Shift", "Control", "Dead"]) {
      expect(actionFor(key(k)), k).toBeNull();
    }
  });

  it("ignores unbound modifier combinations", () => {
    expect(actionFor(key("ArrowRight", { ctrlKey: true }))).toBeNull();
    expect(actionFor(key("s", { ctrlKey: true }))).toBeNull(); // the browser's save, not toggle sheet
    expect(actionFor(key("s", { altKey: true }))).toBeNull();
    expect(actionFor(key("z", { ctrlKey: true, shiftKey: true }))).toEqual({ type: "redo" });
    expect(actionFor(key("y", { ctrlKey: true }))).toEqual({ type: "redo" });
    expect(actionFor(key("5", { ctrlKey: true }))).toBeNull();
    expect(actionFor(key("5", { altKey: true }))).toBeNull();
  });

  it("does not treat shifted digits (symbols) as digits", () => {
    for (const k of ["!", "@", "#", "$", "%", "^", "&", "*", "(", ")"]) {
      expect(actionFor(key(k, { shiftKey: true })), k).toBeNull();
    }
  });
});

describe("auto-repeat", () => {
  it("lets stepping repeat while the key is held", () => {
    expect(actionFor(key("ArrowRight", { repeat: true }))).toEqual({ type: "step", frames: 1 });
    expect(actionFor(key("ArrowLeft", { repeat: true }))).toEqual({ type: "step", frames: -1 });
    expect(actionFor(key("ArrowRight", { repeat: true, shiftKey: true }))).toEqual({ type: "bigStep", dir: 1 });
  });

  it("does not let labelling and toggling flood", () => {
    for (const k of ["5", "s", "m", "x", "Enter", "Backspace", " ", "n", "f", "j", "l"]) {
      expect(actionFor(key(k, { repeat: true })), k).toBeNull();
    }
    expect(actionFor(key("z", { ctrlKey: true, repeat: true }))).toBeNull();
  });

  it("repeats exactly the step actions", () => {
    expect([...REPEATABLE].sort()).toEqual(["bigStep", "step"]);
  });
});

describe("custom bindings", () => {
  it("override the defaults and are looked up by id", () => {
    const custom = { d: { type: "step", frames: 1 }, a: { type: "step", frames: -1 } } as const;
    expect(actionFor(key("d"), custom)).toEqual({ type: "step", frames: 1 });
    expect(actionFor(key("a"), custom)).toEqual({ type: "step", frames: -1 });
    expect(actionFor(key("ArrowRight"), custom)).toBeNull();
  });

  it("still ignore text fields and respect repeat rules", () => {
    const custom = { d: { type: "step", frames: 1 }, e: { type: "noFire" } } as const;
    expect(actionFor(key("d", { targetEditable: true }), custom)).toBeNull();
    expect(actionFor(key("d", { repeat: true }), custom)).toEqual({ type: "step", frames: 1 });
    expect(actionFor(key("e", { repeat: true }), custom)).toBeNull();
  });
});

describe("fields that own their keys", () => {
  it("get Enter and the arrows: no global action fires and nothing is reserved", () => {
    for (const k of ["Enter", "ArrowLeft", "ArrowRight", "Escape", "5", " "]) {
      const e = key(k, { targetEditable: true, targetOwnsKeys: true });
      expect(actionFor(e)).toBeNull();
      expect(reservedGlobally(e)).toBe(false);
    }
  });

  it("other text fields still let Enter and the arrows through as global keys", () => {
    const e = key("Enter", { targetEditable: true });
    expect(actionFor(e)).toEqual({ type: "acceptSuggestion" });
    expect(reservedGlobally(e)).toBe(true);
    expect(reservedGlobally(key("ArrowRight", { targetEditable: true }))).toBe(true);
    expect(reservedGlobally(key("a", { targetEditable: true }))).toBe(false);
  });

  it("outside any field nothing changes", () => {
    expect(actionFor(key("Enter"))).toEqual({ type: "acceptSuggestion" });
    expect(reservedGlobally(key("ArrowLeft"))).toBe(true);
    expect(reservedGlobally(key("Enter", { ctrlKey: true }))).toBe(false);
  });
});
