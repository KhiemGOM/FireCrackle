import { describe, expect, it } from "vitest";
import {
  DEFAULT_POST, DEFAULT_TONE, PORTAL_FRAMES, POST_KEY, STAGE_IDS, clampTone, needsProcessing, onlyParamsChanged, pictureSettings, readPostSettings, repairPostSettings, toggleEnabled, writePostSettings,
  type PostSettings,
} from "./settings";

function memory(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { values, getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } };
}
const withTone = (tone: Partial<PostSettings["stages"]["tone"]["params"]>, on = true): PostSettings => ({
  ...DEFAULT_POST, stages: { ...DEFAULT_POST.stages, tone: { on, params: { ...DEFAULT_TONE, ...tone } } },
});
const withStage = (id: keyof PostSettings["stages"], params: Record<string, number>, on = true): PostSettings => ({
  ...DEFAULT_POST, stages: { ...DEFAULT_POST.stages, [id]: { on, params: { ...DEFAULT_POST.stages[id].params, ...params } } },
});

describe("post-processing defaults", () => {
  it("start enabled but with every effect off, so nothing changes until the user turns something on", () => {
    expect(DEFAULT_POST.enabled).toBe(true);
    expect(DEFAULT_POST.veil).toBe("off");
    expect(DEFAULT_POST.portal).toBe("off");
    expect(DEFAULT_POST.stages.tone.on).toBe(false);
    expect(DEFAULT_POST.order).toEqual(STAGE_IDS);
    expect(STAGE_IDS).toEqual(["tone", "denoise", "deblur", "sharpen", "fire", "channels"]);
    for (const id of STAGE_IDS) expect(DEFAULT_POST.stages[id].on).toBe(false);
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
    expect(repairPostSettings({ order: ["blur", "tone", "tone", 4] }).order).toEqual(["tone", "denoise", "deblur", "sharpen", "fire", "channels"]);
    expect(repairPostSettings({ order: [] }).order).toEqual(STAGE_IDS);
    expect(repairPostSettings({ order: "tone" }).order).toEqual(STAGE_IDS);
  });

  it("keeps the order the user chose and appends the effects that are missing", () => {
    expect(repairPostSettings({ order: ["channels", "tone"] }).order).toEqual(["channels", "tone", "denoise", "deblur", "sharpen", "fire"]);
    expect(repairPostSettings({ order: [...STAGE_IDS].reverse() }).order).toEqual([...STAGE_IDS].reverse());
  });

  it("gives every effect its state, even when the saved file only knew about some", () => {
    const fixed = repairPostSettings({ stages: { tone: { on: true, params: { gamma: 2 } } } });
    expect(Object.keys(fixed.stages).sort()).toEqual([...STAGE_IDS].sort());
    expect(fixed.stages.sharpen).toEqual(DEFAULT_POST.stages.sharpen);
  });

  it("repairs the controls of the other effects too", () => {
    const fixed = repairPostSettings({ stages: {
      sharpen: { on: true, params: { amount: 999, radius: -3, threshold: "x" } },
      fire: { on: true, params: { strength: -5 } },
      channels: { on: true, params: { mode: 2.5 } },
      denoise: { on: true, params: { strength: 500, radius: 9 } },
      deblur: { on: true, params: { iterations: 99, radius: 0 } },
    } });
    expect(fixed.stages.denoise.params).toEqual({ strength: 100, radius: 3 });
    expect(fixed.stages.deblur.params).toEqual({ iterations: 10, radius: 0.5 });
    expect(fixed.stages.sharpen.params.amount).toBe(300);
    expect(fixed.stages.sharpen.params.radius).toBe(0.5);
    expect(fixed.stages.sharpen.params.threshold).toBe(0);
    expect(fixed.stages.fire.params.strength).toBe(0);
    expect(fixed.stages.channels.params.mode).toBe(0); // not one of the listed choices
    expect(fixed.stages.sharpen.on).toBe(true);
  });

  it("keeps a valid choice", () => {
    expect(repairPostSettings({ stages: { channels: { on: true, params: { mode: 3 } } } }).stages.channels.params.mode).toBe(3);
  });

  it("accepts only the veil and portal modes that exist", () => {
    expect(repairPostSettings({ veil: "on", portal: "auto" })).toMatchObject({ veil: "on", portal: "auto" });
    expect(repairPostSettings({ portal: "sideways" }).portal).toBe("off"); // (Manual used to be invalid; it is a mode now)
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

  it("counts the other effects too: on and changed means work to do, on but neutral does not", () => {
    expect(needsProcessing(withStage("sharpen", { amount: 80 }))).toBe(true);
    expect(needsProcessing(withStage("sharpen", { amount: 0 }))).toBe(false);
    expect(needsProcessing(withStage("fire", { strength: 40 }))).toBe(true);
    expect(needsProcessing(withStage("channels", { mode: 2 }))).toBe(true);
    expect(needsProcessing(withStage("channels", { mode: 0 }))).toBe(false);
    expect(needsProcessing(withStage("fire", { strength: 40 }, false))).toBe(false);
    expect(needsProcessing(withStage("denoise", { strength: 30 }))).toBe(true);
    expect(needsProcessing(withStage("denoise", { strength: 0 }))).toBe(false);
    expect(needsProcessing(withStage("deblur", { iterations: 4 }))).toBe(true);
    expect(needsProcessing(withStage("deblur", { iterations: 0 }))).toBe(false);
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
  it("is true only when nothing but effect controls changed", () => {
    const base = withTone({ gamma: 1.2 });
    expect(onlyParamsChanged(base, withTone({ gamma: 1.4 }))).toBe(true);
    expect(onlyParamsChanged(base, withTone({ gamma: 1.2, contrast: 5 }))).toBe(true);
    expect(onlyParamsChanged(withStage("sharpen", { amount: 50 }), withStage("sharpen", { amount: 80 }))).toBe(true);
  });

  it("is false for the master switch, an effect switch, veil, portal, the order, or no change at all", () => {
    const base = withTone({ gamma: 1.2 });
    expect(onlyParamsChanged(base, { ...base, enabled: false })).toBe(false);
    expect(onlyParamsChanged(base, withTone({ gamma: 1.2 }, false))).toBe(false);
    expect(onlyParamsChanged(base, { ...base, veil: "auto" })).toBe(false);
    expect(onlyParamsChanged(base, { ...base, portal: "auto" })).toBe(false);
    expect(onlyParamsChanged(base, { ...base, order: [...base.order].reverse() })).toBe(false);
    expect(onlyParamsChanged(base, withTone({ gamma: 1.2 }))).toBe(false);
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

describe("manual portal settings", () => {
  it("default to a neutral phase and a middling opacity, with off still the portal mode", () => {
    expect(DEFAULT_POST.portal).toBe("off");
    expect(DEFAULT_POST.portalManual).toEqual({ phase: 0, opacity: 0.5 });
    expect(PORTAL_FRAMES).toBe(32);
  });

  it("accepts Manual as a portal mode and rejects anything else", () => {
    expect(repairPostSettings({ portal: "manual" }).portal).toBe("manual");
    expect(repairPostSettings({ portal: "Manual" }).portal).toBe("off");
    expect(repairPostSettings({ portal: 1 }).portal).toBe("off");
  });

  it("keeps the phase a whole number inside the animation and the opacity inside 0 to 1", () => {
    expect(repairPostSettings({ portalManual: { phase: 7.6, opacity: 0.25 } }).portalManual).toEqual({ phase: 8, opacity: 0.25 });
    expect(repairPostSettings({ portalManual: { phase: 99, opacity: 3 } }).portalManual).toEqual({ phase: 31, opacity: 1 });
    expect(repairPostSettings({ portalManual: { phase: -4, opacity: -1 } }).portalManual).toEqual({ phase: 0, opacity: 0 });
  });

  it("replaces a missing or bad manual value on its own and keeps the other", () => {
    expect(repairPostSettings({ portalManual: { phase: "x", opacity: 0.9 } }).portalManual).toEqual({ phase: 0, opacity: 0.9 });
    expect(repairPostSettings({ portalManual: { phase: 5 } }).portalManual).toEqual({ phase: 5, opacity: 0.5 });
    expect(repairPostSettings({ portalManual: null }).portalManual).toEqual({ phase: 0, opacity: 0.5 });
    expect(repairPostSettings({ portalManual: { phase: NaN, opacity: Infinity } }).portalManual).toEqual({ phase: 0, opacity: 0.5 });
  });

  it("round-trips through storage", () => {
    const store = memory();
    const s: PostSettings = { ...DEFAULT_POST, portal: "manual", portalManual: { phase: 12, opacity: 0.62 } };
    writePostSettings(s, store);
    expect(readPostSettings(store)).toEqual(s);
  });

  it("counts a manual portal as work to do, and the master switch still turns it off", () => {
    expect(needsProcessing({ ...DEFAULT_POST, portal: "manual" })).toBe(true);
    expect(pictureSettings({ ...DEFAULT_POST, portal: "manual", enabled: false }).portal).toBe("off");
  });
});
