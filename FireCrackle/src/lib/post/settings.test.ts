import { describe, expect, it } from "vitest";
import {
  DEFAULT_POST, DEFAULT_TONE, POST_KEY, clampTone, needsProcessing, onlyToneParamsChanged, pictureSettings, readPostSettings, repairPostSettings, toggleEnabled, writePostSettings,
  type PostSettings,
} from "./settings";

function memory(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { values, getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } };
}
const withTone = (tone: Partial<PostSettings["stages"]["tone"]["params"]>, on = true): PostSettings => ({
  ...DEFAULT_POST, stages: { tone: { on, params: { ...DEFAULT_TONE, ...tone } } },
});

describe("post-processing defaults", () => {
  it("start enabled but with every effect off, so nothing changes until the user turns something on", () => {
    expect(DEFAULT_POST.enabled).toBe(true);
    expect(DEFAULT_POST.veil).toBe("off");
    expect(DEFAULT_POST.portal).toBe("off");
    expect(DEFAULT_POST.stages.tone.on).toBe(false);
    expect(DEFAULT_POST.order).toEqual(["tone"]);
    expect(needsProcessing(DEFAULT_POST)).toBe(false);
  });
});

describe("reading and writing settings", () => {
  it("gives the defaults when nothing is saved", () => {
    expect(readPostSettings(memory())).toEqual(DEFAULT_POST);
  });

  it("round-trips what was written", () => {
    const store = memory();
    const settings: PostSettings = { ...withTone({ gamma: 1.8, contrast: 20 }), veil: "auto", portal: "auto", enabled: false };
    writePostSettings(settings, store);
    expect(store.values.has(POST_KEY)).toBe(true);
    expect(readPostSettings(store)).toEqual(settings);
  });

  it("survives blocked or full storage in both directions", () => {
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
    expect(readPostSettings(blocked)).toEqual(DEFAULT_POST);
    expect(() => writePostSettings(DEFAULT_POST, blocked)).not.toThrow();
  });

  it("gives the defaults for text that is not JSON or not an object", () => {
    for (const bad of ["{oops", "null", "[]", "7", '"x"']) expect(readPostSettings(memory({ [POST_KEY]: bad }))).toEqual(DEFAULT_POST);
  });
});

describe("repairing saved settings (an older or newer build, or a hand-edited file)", () => {
  it("replaces each bad field on its own and keeps the good ones", () => {
    const fixed = repairPostSettings({ enabled: "yes", veil: "sideways", portal: 3, stages: { tone: { on: true, params: { gamma: "x", contrast: 30 } } } });
    expect(fixed.enabled).toBe(true);
    expect(fixed.veil).toBe("off");
    expect(fixed.portal).toBe("off");
    expect(fixed.stages.tone.on).toBe(true);
    expect(fixed.stages.tone.params.gamma).toBe(1);
    expect(fixed.stages.tone.params.contrast).toBe(30);
  });

  it("clamps numbers into their limits and rejects NaN and Infinity", () => {
    const p = repairPostSettings({ stages: { tone: { on: true, params: { gamma: 99, contrast: -500, shadows: 1000, black: 10, white: 250 } } } }).stages.tone.params;
    expect(p.gamma).toBe(3);
    expect(p.contrast).toBe(-100);
    expect(p.shadows).toBe(100);
    const nan = repairPostSettings({ stages: { tone: { on: true, params: { gamma: NaN, contrast: Infinity } } } }).stages.tone.params;
    expect(nan.gamma).toBe(1);
    expect(nan.contrast).toBe(0);
  });

  it("never leaves black at or above white (that would divide by zero): both go back to the defaults", () => {
    const p = repairPostSettings({ stages: { tone: { on: true, params: { black: 200, white: 100 } } } }).stages.tone.params;
    expect(p.black).toBe(0);
    expect(p.white).toBe(255);
  });

  it("drops unknown stage ids from the order, removes duplicates and appends missing ones", () => {
    expect(repairPostSettings({ order: ["blur", "tone", "tone", 4] }).order).toEqual(["tone"]);
    expect(repairPostSettings({ order: [] }).order).toEqual(["tone"]);
    expect(repairPostSettings({ order: "tone" }).order).toEqual(["tone"]);
  });

  it("accepts only the veil and portal modes that exist", () => {
    expect(repairPostSettings({ veil: "on", portal: "auto" })).toMatchObject({ veil: "on", portal: "auto" });
    expect(repairPostSettings({ portal: "manual" }).portal).toBe("off");
  });
});

describe("carrying over the old Veil and Portal settings", () => {
  it("seeds veil and portal from the old preferences when no post-processing settings were ever saved", () => {
    const s = readPostSettings(memory(), { veilMode: "auto", portalMode: "auto" });
    expect(s.veil).toBe("auto");
    expect(s.portal).toBe("auto");
  });

  it("ignores the old preferences once settings exist", () => {
    const store = memory({ [POST_KEY]: JSON.stringify({ ...DEFAULT_POST, veil: "on" }) });
    expect(readPostSettings(store, { veilMode: "auto", portalMode: "auto" })).toMatchObject({ veil: "on", portal: "off" });
  });

  it("ignores old values that are not valid modes", () => {
    const s = readPostSettings(memory(), { veilMode: "weird" as never, portalMode: "x" as never });
    expect(s.veil).toBe("off");
    expect(s.portal).toBe("off");
  });
});

describe("when the picture needs processing", () => {
  it("is false for the defaults, for tone with nothing changed, and when the master switch is off", () => {
    expect(needsProcessing(DEFAULT_POST)).toBe(false);
    expect(needsProcessing(withTone({}))).toBe(false); // on, but every control at its neutral value
    expect(needsProcessing({ ...withTone({ gamma: 2 }), enabled: false })).toBe(false);
    expect(needsProcessing({ ...DEFAULT_POST, veil: "auto", enabled: false })).toBe(false);
  });

  it("is true when veil, portal or a changed effect is on", () => {
    expect(needsProcessing({ ...DEFAULT_POST, veil: "auto" })).toBe(true);
    expect(needsProcessing({ ...DEFAULT_POST, veil: "on" })).toBe(true);
    expect(needsProcessing({ ...DEFAULT_POST, portal: "auto" })).toBe(true);
    expect(needsProcessing(withTone({ gamma: 2 }))).toBe(true);
  });

  it("is false for an effect that is switched off even when its controls were changed", () => {
    expect(needsProcessing(withTone({ gamma: 2 }, false))).toBe(false);
  });
});

describe("the settings the picture is drawn with", () => {
  it("are the saved settings when the master switch is on", () => {
    const s = { ...withTone({ gamma: 2 }), veil: "auto" as const };
    expect(pictureSettings(s)).toBe(s);
  });

  it("show the untouched picture when the master switch is off, without losing the saved settings", () => {
    const s: PostSettings = { ...withTone({ gamma: 2 }), veil: "auto", portal: "auto", enabled: false };
    const shown = pictureSettings(s);
    expect(shown.veil).toBe("off");
    expect(shown.portal).toBe("off");
    expect(needsProcessing(shown)).toBe(false);
    expect(s.veil).toBe("auto"); // the input is not changed
    expect(s.stages.tone.on).toBe(true);
  });

  it("toggleEnabled flips only the master switch and does not change its input", () => {
    const s = withTone({ gamma: 2 });
    const off = toggleEnabled(s);
    expect(off.enabled).toBe(false);
    expect(off.stages).toEqual(s.stages);
    expect(s.enabled).toBe(true);
    expect(toggleEnabled(off).enabled).toBe(true);
  });
});

describe("telling a slider drag from a switch (the picture is only delayed for the slider)", () => {
  it("is true only when nothing but the tone controls changed", () => {
    const base = withTone({ gamma: 1.2 });
    expect(onlyToneParamsChanged(base, withTone({ gamma: 1.4 }))).toBe(true);
    expect(onlyToneParamsChanged(base, withTone({ gamma: 1.2, contrast: 5 }))).toBe(true);
  });

  it("is false for the master switch, an effect switch, veil, portal, the order, or no change at all", () => {
    const base = withTone({ gamma: 1.2 });
    expect(onlyToneParamsChanged(base, { ...base, enabled: false })).toBe(false);
    expect(onlyToneParamsChanged(base, withTone({ gamma: 1.2 }, false))).toBe(false);
    expect(onlyToneParamsChanged(base, { ...base, veil: "auto" })).toBe(false);
    expect(onlyToneParamsChanged(base, { ...base, portal: "auto" })).toBe(false);
    expect(onlyToneParamsChanged(base, { ...base, order: [...base.order].reverse() })).toBe(false);
    expect(onlyToneParamsChanged(base, withTone({ gamma: 1.2 }))).toBe(false);
  });
});

describe("keeping a tone control inside its limits", () => {
  it("clamps to the limits", () => {
    expect(clampTone("gamma", 99, DEFAULT_TONE).gamma).toBe(3);
    expect(clampTone("gamma", 0, DEFAULT_TONE).gamma).toBe(0.3);
    expect(clampTone("contrast", -999, DEFAULT_TONE).contrast).toBe(-100);
  });

  it("keeps black below white from either side and changes nothing else", () => {
    const p = { ...DEFAULT_TONE, black: 20, white: 100, gamma: 1.5 };
    expect(clampTone("black", 200, p)).toEqual({ ...p, black: 99 });
    expect(clampTone("white", 5, p)).toEqual({ ...p, white: 21 });
    expect(clampTone("contrast", 10, p)).toEqual({ ...p, contrast: 10 });
  });
});
