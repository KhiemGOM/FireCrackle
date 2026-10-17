import { describe, expect, it } from "vitest";
import { PRESETS, applyPreset, presetOf } from "./presets";
import { DEFAULT_POST, STAGE_IDS, repairPostSettings, type PostSettings } from "./settings";

const busy: PostSettings = { ...DEFAULT_POST, enabled: false, veil: "auto", portal: "auto", order: [...DEFAULT_POST.order].reverse() };

describe("presets", () => {
  it("has a readable list with unique ids", () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(3);
    expect(new Set(PRESETS.map(p => p.id)).size).toBe(PRESETS.length);
    for (const p of PRESETS) expect(p.name.length).toBeGreaterThan(2);
  });

  it("turns on the effects a preset names with its values, and switches every other effect off", () => {
    const dark = applyPreset({ ...DEFAULT_POST, stages: { ...DEFAULT_POST.stages, sharpen: { on: true, params: { ...DEFAULT_POST.stages.sharpen.params, amount: 90 } } } }, "dark");
    expect(dark.stages.tone.on).toBe(true);
    expect(dark.stages.tone.params.gamma).toBeGreaterThan(1);
    expect(dark.stages.tone.params.shadows).toBeGreaterThan(0);
    expect(dark.stages.sharpen.on).toBe(false);
  });

  it("does not touch the master switch, veil, portal or the effect order", () => {
    const out = applyPreset(busy, "dark");
    expect(out.enabled).toBe(false);
    expect(out.veil).toBe("auto");
    expect(out.portal).toBe("auto");
    expect(out.order).toEqual(busy.order);
  });

  it("'none' switches every effect off and resets their controls, keeping the rest", () => {
    const tuned = applyPreset(busy, "dark");
    const none = applyPreset(tuned, "none");
    for (const id of STAGE_IDS) expect(none.stages[id]).toEqual(DEFAULT_POST.stages[id]);
    expect(none.veil).toBe("auto");
  });

  it("leaves the settings as they are for an unknown preset and does not change its input", () => {
    const copy = JSON.parse(JSON.stringify(busy));
    expect(applyPreset(busy, "nope")).toBe(busy);
    applyPreset(busy, "dark");
    expect(busy).toEqual(copy);
  });

  it("only uses values the settings repair would keep (inside every limit)", () => {
    for (const p of PRESETS) {
      const out = applyPreset(DEFAULT_POST, p.id);
      expect(repairPostSettings(out)).toEqual(out);
    }
  });

  it("every preset changes something, and the effects it turns on are not neutral", () => {
    for (const p of PRESETS) {
      const out = applyPreset(DEFAULT_POST, p.id);
      expect(out).not.toEqual(DEFAULT_POST);
    }
  });

  it("names the preset the settings currently match, or none", () => {
    expect(presetOf(applyPreset(DEFAULT_POST, "dark"))).toBe("dark");
    expect(presetOf(DEFAULT_POST)).toBe("none");
    const nudged = applyPreset(DEFAULT_POST, "dark");
    expect(presetOf({ ...nudged, stages: { ...nudged.stages, tone: { ...nudged.stages.tone, params: { ...nudged.stages.tone.params, gamma: 1.123 } } } })).toBe("custom");
  });
});
