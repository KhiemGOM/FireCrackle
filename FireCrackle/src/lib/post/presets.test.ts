import { describe, expect, it } from "vitest";
import { PRESETS, applyPreset, presetOf } from "./presets";
import { DEFAULT_POST, STAGE_IDS, repairPostSettings, type PostSettings } from "./settings";
import { enhance } from "./pipeline";
import { buildToneLut, type ToneParams } from "./tone";

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

describe("the built-in presets are useful and not cluttered", () => {
  const on = (id: string) => {
    const s = applyPreset(DEFAULT_POST, id);
    return STAGE_IDS.filter(stage => s.stages[stage].on);
  };

  it("includes explicit contrast and edge views alongside the existing footage aids", () => {
    expect(PRESETS.map(p => p.id)).toEqual(["high-contrast", "find-edges", "edge-overlay", "dark", "compressed", "fire", "edges", "soft"]);
    expect(PRESETS.map(p => p.name)).toEqual(["High contrast", "Find edges", "Edge overlay", "Dark scene", "Compressed footage", "Fire focus", "Texture detail", "Soft footage"]);
  });

  it("each switch on at most three effects", () => {
    for (const p of PRESETS) expect(on(p.id).length, p.id).toBeLessThanOrEqual(3);
  });

  it("Dark scene lifts the shadows and brightens, and calms the noise that brightening brings out", () => {
    const s = applyPreset(DEFAULT_POST, "dark");
    expect(s.stages.tone.params.gamma).toBeGreaterThanOrEqual(1.5);
    expect(s.stages.tone.params.shadows).toBeGreaterThanOrEqual(30);
    expect(s.stages.denoise.on).toBe(true);
    expect(s.stages.denoise.params.strength).toBeGreaterThan(0);
  });

  it("Compressed footage cleans first and sharpens gently, without changing the tones (a contrast step crushed dark frames)", () => {
    const s = applyPreset(DEFAULT_POST, "compressed");
    expect(on("compressed")).toEqual(["denoise", "sharpen"]);
    expect(STAGE_IDS.indexOf("denoise")).toBeLessThan(STAGE_IDS.indexOf("sharpen"));
    expect(s.stages.sharpen.params.amount).toBeLessThanOrEqual(100);
    expect(s.stages.tone.on).toBe(false);
  });

  it("Fire focus shows fire-coloured pixels but keeps some of the surroundings visible", () => {
    const s = applyPreset(DEFAULT_POST, "fire");
    expect(s.stages.fire.on).toBe(true);
    expect(s.stages.fire.params.strength).toBeGreaterThanOrEqual(40);
    expect(s.stages.fire.params.strength).toBeLessThan(100); // full strength hides all context
    expect(s.stages.tone.params.gamma).toBeGreaterThan(1);
    expect(s.stages.channels.on).toBe(false);
  });

  it("Texture edges sharpens with a small radius to show the texel boundaries", () => {
    const s = applyPreset(DEFAULT_POST, "edges");
    expect(s.stages.sharpen.on).toBe(true);
    expect(s.stages.sharpen.params.amount).toBeGreaterThanOrEqual(100);
    expect(s.stages.sharpen.params.radius).toBeLessThanOrEqual(1);
  });

  it("Soft footage deblurs with few iterations (more makes halos)", () => {
    const s = applyPreset(DEFAULT_POST, "soft");
    expect(s.stages.deblur.on).toBe(true);
    expect(s.stages.deblur.params.iterations).toBeGreaterThanOrEqual(1);
    expect(s.stages.deblur.params.iterations).toBeLessThanOrEqual(5);
  });
});

describe("purposeful inspection presets", () => {
  it("makes modest midtone differences clearly separate at high contrast", () => {
    const s = applyPreset(DEFAULT_POST, "high-contrast");
    expect(s.stages.tone.on).toBe(true);
    const lut = buildToneLut(s.stages.tone.params as unknown as ToneParams);
    expect(lut[145] - lut[110]).toBeGreaterThan(150);
  });
  it("finds real boundaries through the image pipeline, rather than just sharpening", () => {
    const data = new Uint8ClampedArray(8 * 3 * 4);
    for (let i = 0; i < 24; i++) data.set([i % 8 < 4 ? 80 : 160, 60, 20, 255], i * 4);
    const s = applyPreset(DEFAULT_POST, "find-edges");
    const out = enhance({ data, width: 8, height: 3 }, s);
    expect(out.applied).toBe(true);
    expect(out.data[0]).toBe(0);
    expect(out.data[(8 + 3) * 4]).toBeGreaterThan(100);
    expect(s.stages.sharpen.on).toBe(false);
  });
  it("explains the visual purpose of every built-in preset", () => {
    for (const p of PRESETS) expect(p.help?.length).toBeGreaterThan(15);
  });
});
