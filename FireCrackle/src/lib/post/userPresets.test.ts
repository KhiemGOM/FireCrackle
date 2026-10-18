import { describe, expect, it } from "vitest";
import { MAX_PRESET_NAME, MAX_USER_PRESETS, USER_PRESETS_KEY, addUserPreset, readUserPresets, removeUserPreset, repairUserPresets, writeUserPresets } from "./userPresets";
import { PRESETS, applyPreset, presetOf } from "./presets";
import { DEFAULT_POST, STAGE_IDS, type PostSettings } from "./settings";

function memory(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { values, getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } };
}
const tuned = (): PostSettings => ({
  ...DEFAULT_POST,
  stages: { ...DEFAULT_POST.stages, tone: { on: true, params: { ...DEFAULT_POST.stages.tone.params, gamma: 1.4 } }, sharpen: { on: true, params: { ...DEFAULT_POST.stages.sharpen.params, amount: 70 } } },
});

describe("saving your own presets", () => {
  it("turns the effects that are on into a named preset, keeping their values and leaving the others out", () => {
    const list = addUserPreset([], "  My night  ", tuned());
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("My night");
    expect(list[0].id.startsWith("user-")).toBe(true);
    expect(Object.keys(list[0].stages).sort()).toEqual(["sharpen", "tone"]);
    expect(list[0].stages.tone?.gamma).toBe(1.4);
    expect(list[0].stages.sharpen?.amount).toBe(70);
  });

  it("can be applied again and is then recognised as the current preset", () => {
    const list = addUserPreset([], "My night", tuned());
    const applied = applyPreset(DEFAULT_POST, list[0].id, list);
    expect(applied.stages.tone).toEqual(tuned().stages.tone);
    expect(applied.stages.denoise.on).toBe(false);
    expect(presetOf(applied, list)).toBe(list[0].id);
    expect(presetOf(applied)).toBe("custom"); // without the list it is just a custom set
  });

  it("refuses an empty or blank name, and a set with no effect switched on (the list is returned as it was)", () => {
    const base = addUserPreset([], "One", tuned());
    expect(addUserPreset(base, "", tuned())).toBe(base);
    expect(addUserPreset(base, "   ", tuned())).toBe(base);
    expect(addUserPreset(base, "Nothing", DEFAULT_POST)).toBe(base);
  });

  it("shortens a very long name", () => {
    const list = addUserPreset([], "x".repeat(80), tuned());
    expect(list[0].name).toHaveLength(MAX_PRESET_NAME);
  });

  it("replaces a preset of the same name (any letter case) in place, keeping its id", () => {
    const first = addUserPreset(addUserPreset([], "Night", tuned()), "Other", tuned());
    const changed = { ...tuned(), stages: { ...tuned().stages, tone: { on: true, params: { ...tuned().stages.tone.params, gamma: 2.2 } } } };
    const again = addUserPreset(first, "night", changed);
    expect(again).toHaveLength(2);
    expect(again[0].id).toBe(first[0].id);
    expect(again[0].stages.tone?.gamma).toBe(2.2);
  });

  it("gives each new preset an id that no other preset uses, built-in or saved", () => {
    let list = addUserPreset([], "A", tuned());
    list = addUserPreset(list, "B", tuned());
    list = addUserPreset(list, "C", tuned());
    const ids = [...list.map(p => p.id), ...PRESETS.map(p => p.id), "none", "custom"];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("stops at a limit instead of growing without end", () => {
    let list: ReturnType<typeof addUserPreset> = [];
    for (let i = 0; i < MAX_USER_PRESETS + 3; i++) list = addUserPreset(list, `P${i}`, tuned());
    expect(list).toHaveLength(MAX_USER_PRESETS);
    expect(list.map(p => p.name)).not.toContain(`P${MAX_USER_PRESETS}`);
  });

  it("does not change the list it was given", () => {
    const base = addUserPreset([], "One", tuned());
    const copy = JSON.parse(JSON.stringify(base));
    addUserPreset(base, "Two", tuned());
    removeUserPreset(base, base[0].id);
    expect(base).toEqual(copy);
  });
});

describe("deleting a saved preset", () => {
  it("removes only that one, and does nothing for an unknown id", () => {
    const list = addUserPreset(addUserPreset([], "A", tuned()), "B", tuned());
    expect(removeUserPreset(list, list[0].id).map(p => p.name)).toEqual(["B"]);
    expect(removeUserPreset(list, "user-nope")).toEqual(list);
  });
});

describe("keeping saved presets between runs", () => {
  it("reads nothing when nothing was saved, when storage is blocked, or when the text is unusable", () => {
    expect(readUserPresets(memory())).toEqual([]);
    expect(readUserPresets({ getItem: () => { throw new Error("blocked"); } })).toEqual([]);
    for (const bad of ["{oops", "null", "7", '"x"', "{}"]) expect(readUserPresets(memory({ [USER_PRESETS_KEY]: bad }))).toEqual([]);
  });

  it("round-trips what was written, and survives blocked or full storage when writing", () => {
    const store = memory();
    const list = addUserPreset([], "Mine", tuned());
    writeUserPresets(list, store);
    expect(readUserPresets(store)).toEqual(list);
    expect(() => writeUserPresets(list, { setItem: () => { throw new Error("full"); } })).not.toThrow();
  });

  it("repairs a hand-edited or older list: drops bad entries, clamps values, trims names, drops clashing ids", () => {
    const fixed = repairUserPresets([
      { id: "user-a", name: "  Fine  ", stages: { tone: { gamma: 99 }, blur: { amount: 3 }, sharpen: { amount: -4 } } },
      { id: "user-a", name: "Duplicate id", stages: { tone: { gamma: 1.2 } } },
      { id: "dark", name: "Clashes with a built-in", stages: { tone: { gamma: 1.2 } } },
      { id: "user-b", name: "", stages: { tone: { gamma: 1.2 } } },
      { id: 7, name: "bad id", stages: {} },
      null,
      "text",
    ]);
    expect(fixed.map(p => p.id)).toEqual(["user-a"]);
    expect(fixed[0].name).toBe("Fine");
    expect(fixed[0].stages.tone?.gamma).toBe(10);
    expect(fixed[0].stages.sharpen?.amount).toBe(0);
    expect(Object.keys(fixed[0].stages).sort()).toEqual(["sharpen", "tone"]);
  });

  it("keeps no more than the limit when repairing", () => {
    const many = Array.from({ length: MAX_USER_PRESETS + 5 }, (_, i) => ({ id: `user-${i}`, name: `P${i}`, stages: { tone: { gamma: 1.5 } } }));
    expect(repairUserPresets(many)).toHaveLength(MAX_USER_PRESETS);
    expect(STAGE_IDS.length).toBeGreaterThan(0);
  });
});
