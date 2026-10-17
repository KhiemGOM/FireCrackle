import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { EnhancePanel } from "./EnhancePanel";
import { DEFAULT_POST, DEFAULT_TONE, type PostSettings, type RowId } from "../lib/post/settings";
import { PRESETS, applyPreset } from "../lib/post/presets";

type El = ReactElement<Record<string, any>>;
function all(node: unknown, pred: (e: El) => boolean): El[] {
  if (Array.isArray(node)) return node.flatMap(n => all(n, pred));
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const el = node as El;
  return [...(pred(el) ? [el] : []), ...all(el.props.children, pred)];
}
function text(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return text((node as El).props?.children);
}
const byLabel = (root: El, label: string) => all(root, e => e.props["aria-label"] === label)[0];
const row = (root: El, id: RowId) => all(root, e => e.props["data-row"] === id)[0];
const within = (r: El, label: string) => all(r, e => e.props["aria-label"] === label)[0];

const tone = (patch: Partial<PostSettings["stages"]["tone"]["params"]>, on = true): PostSettings["stages"] => ({ ...DEFAULT_POST.stages, tone: { on, params: { ...DEFAULT_TONE, ...patch } } });
const stage = (id: keyof PostSettings["stages"], params: Record<string, number>, on = true): PostSettings["stages"] => ({ ...DEFAULT_POST.stages, [id]: { on, params: { ...DEFAULT_POST.stages[id].params, ...params } } });

function panel(settings: PostSettings = DEFAULT_POST, selected: RowId = "veil", over: Record<string, unknown> = {}) {
  const handlers = { onSelect: vi.fn(), onChange: vi.fn(), onReset: vi.fn() };
  const root = EnhancePanel({ settings, selected, ...handlers, ...over } as Parameters<typeof EnhancePanel>[0]) as El;
  return { root, ...handlers };
}

describe("Enhance panel: the list", () => {
  it("lists GUI veil and Portal first, then the effects in their order", () => {
    const { root } = panel();
    const rows = all(root, e => e.props["data-row"] !== undefined).map(e => e.props["data-row"]);
    expect(rows).toEqual(["veil", "portal", "tone", "denoise", "deblur", "sharpen", "fire", "channels"]);
  });

  it("moves a switched-on effect up in front of the switched-off ones", () => {
    const { root } = panel({ ...DEFAULT_POST, stages: stage("channels", { mode: 2 }) });
    const rows = all(root, e => e.props["data-row"] !== undefined).map(e => e.props["data-row"]);
    expect(rows).toEqual(["veil", "portal", "channels", "tone", "denoise", "deblur", "sharpen", "fire"]);
  });

  it("names every effect", () => {
    const { root } = panel();
    for (const name of ["Tone", "Denoise", "Deblur", "Sharpen", "Fire view", "Channels"]) expect(within(root, `Show ${name} controls`)).toBeDefined();
  });

  it("puts a switched-on effect before a switched-off one and shows the order numbers on the ones that are on", () => {
    const { root } = panel({ ...DEFAULT_POST, veil: "auto", stages: tone({ gamma: 2 }) });
    expect(text(all(row(root, "veil"), e => e.props.className === "post-badge"))).toBe("1");
    expect(text(all(row(root, "tone"), e => e.props.className === "post-badge"))).toBe("2");
    expect(all(row(root, "portal"), e => e.props.className === "post-badge")).toHaveLength(0);
  });

  it("shows no numbers when everything is off", () => {
    const { root } = panel();
    expect(all(root, e => e.props.className === "post-badge")).toHaveLength(0);
  });

  it("dims the whole list but keeps the numbers while the master switch is off", () => {
    const { root } = panel({ ...DEFAULT_POST, veil: "auto", enabled: false });
    expect(String(root.props.className)).toContain("master-off");
    expect(all(row(root, "veil"), e => e.props.className === "post-badge")).toHaveLength(1);
  });
});

describe("Enhance panel: switches live inside the rows", () => {
  it("has a master switch that flips the global on/off", () => {
    const { root, onChange } = panel();
    const master = byLabel(root, "Post-processing");
    expect(master.props.role).toBe("switch");
    expect(master.props["aria-checked"]).toBe(true);
    master.props.onClick();
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_POST, enabled: false });
  });

  it("turns veil on as Auto and back off, and portal likewise", () => {
    const off = panel();
    within(row(off.root, "veil"), "GUI veil on/off").props.onClick();
    expect(off.onChange).toHaveBeenCalledWith({ ...DEFAULT_POST, veil: "auto" });
    within(row(off.root, "portal"), "Portal on/off").props.onClick();
    expect(off.onChange).toHaveBeenLastCalledWith({ ...DEFAULT_POST, portal: "auto" });
    const on = panel({ ...DEFAULT_POST, veil: "on", portal: "auto" });
    expect(within(row(on.root, "veil"), "GUI veil on/off").props["aria-checked"]).toBe(true);
    within(row(on.root, "veil"), "GUI veil on/off").props.onClick();
    expect(on.onChange).toHaveBeenCalledWith({ ...DEFAULT_POST, veil: "off", portal: "auto" });
    within(row(on.root, "portal"), "Portal on/off").props.onClick();
    expect(on.onChange).toHaveBeenLastCalledWith({ ...DEFAULT_POST, veil: "on", portal: "off" });
  });

  it("turns tone on and off without touching its controls", () => {
    const { root, onChange } = panel({ ...DEFAULT_POST, stages: tone({ gamma: 2 }, false) });
    within(row(root, "tone"), "Tone on/off").props.onClick();
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_POST, stages: tone({ gamma: 2 }, true) });
  });

  it("selecting a row is separate from its switch: the switch is not inside the select button and selecting changes nothing", () => {
    const { root, onSelect, onChange } = panel();
    const select = within(row(root, "tone"), "Show Tone controls");
    expect(all(select, e => e.props.role === "switch")).toHaveLength(0);
    select.props.onClick();
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("tone");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not change the settings object it was given", () => {
    const settings = { ...DEFAULT_POST, stages: tone({ gamma: 2 }) };
    const copy = JSON.parse(JSON.stringify(settings));
    const { root } = panel(settings, "tone");
    within(row(root, "tone"), "Tone on/off").props.onClick();
    byLabel(root, "Gamma").props.onChange({ target: { value: "1.5" } });
    expect(settings).toEqual(copy);
  });
});

describe("Enhance panel: the selected row's controls", () => {
  it("shows the veil mode choice for veil only when veil is selected", () => {
    const { root } = panel({ ...DEFAULT_POST, veil: "auto" }, "veil");
    const select = byLabel(root, "Undo GUI veil");
    expect(select.props.value).toBe("auto");
    expect(all(select, e => e.type === "option").map(o => o.props.value)).toEqual(["off", "auto", "on"]);
    expect(byLabel(panel(DEFAULT_POST, "tone").root, "Undo GUI veil")).toBeUndefined();
  });

  it("changes the veil mode from the choice", () => {
    const { root, onChange } = panel(DEFAULT_POST, "veil");
    byLabel(root, "Undo GUI veil").props.onChange({ target: { value: "on" } });
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_POST, veil: "on" });
  });

  it("offers Manual next to Off and Auto, and shows the phase and opacity controls only in Manual", () => {
    const auto = panel({ ...DEFAULT_POST, portal: "auto" }, "portal").root;
    expect(all(byLabel(auto, "Undo portal overlay"), e => e.type === "option").map(o => o.props.value)).toEqual(["off", "auto", "manual"]);
    expect(byLabel(auto, "Portal phase")).toBeUndefined();
    const manual = panel({ ...DEFAULT_POST, portal: "manual", portalManual: { phase: 12, opacity: 0.62 } }, "portal").root;
    expect(byLabel(manual, "Portal phase").props.value).toBe(12);
    expect(byLabel(manual, "Portal phase").props.max).toBe(31);
    expect(byLabel(manual, "Portal opacity").props.value).toBe(0.62);
  });

  it("changes the manual phase and opacity, keeping them inside their limits", () => {
    const settings = { ...DEFAULT_POST, portal: "manual" as const, portalManual: { phase: 4, opacity: 0.4 } };
    const { root, onChange } = panel(settings, "portal");
    byLabel(root, "Portal phase").props.onChange({ target: { value: "9" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...settings, portalManual: { phase: 9, opacity: 0.4 } });
    byLabel(root, "Portal phase").props.onChange({ target: { value: "99" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...settings, portalManual: { phase: 31, opacity: 0.4 } });
    byLabel(root, "Portal opacity").props.onChange({ target: { value: "0.8" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...settings, portalManual: { phase: 4, opacity: 0.8 } });
    onChange.mockClear();
    byLabel(root, "Portal opacity").props.onChange({ target: { value: "abc" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("starts the manual values from the last automatic fit, and only when there is one", () => {
    const settings = { ...DEFAULT_POST, portal: "manual" as const };
    const without = panel(settings, "portal").root;
    const useFit = (root: El) => byLabel(root, "Use last fit");
    expect(useFit(without).props.disabled).toBe(true);
    const { root, onChange } = panel(settings, "portal", { portalFit: { phase: 20, opacity: 0.39 } });
    expect(useFit(root).props.disabled).toBe(false);
    useFit(root).props.onClick();
    expect(onChange).toHaveBeenCalledWith({ ...settings, portalManual: { phase: 20, opacity: 0.39 } });
  });

  it("shows the portal choice and the portal status text when portal is selected", () => {
    const { root, onChange } = panel({ ...DEFAULT_POST, portal: "auto" }, "portal", { portalStatus: "No confident portal fit" });
    const select = byLabel(root, "Undo portal overlay");
    expect(select.props.value).toBe("auto");
    expect(all(select, e => e.type === "option").map(o => o.props.value)).toEqual(["off", "auto", "manual"]);
    expect(text(row(root, "portal"))).toContain("No confident portal fit");
    select.props.onChange({ target: { value: "off" } });
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_POST, portal: "off" });
  });

  it("shows five tone sliders with their values when tone is selected", () => {
    const { root } = panel({ ...DEFAULT_POST, stages: tone({ gamma: 1.5, black: 10, white: 240, contrast: -20, shadows: 30 }) }, "tone");
    const values = Object.fromEntries(["Gamma", "Black point", "White point", "Contrast", "Shadow lift"].map(l => [l, byLabel(root, l).props.value]));
    expect(values).toEqual({ Gamma: 1.5, "Black point": 10, "White point": 240, Contrast: -20, "Shadow lift": 30 });
    for (const l of Object.keys(values)) expect(byLabel(root, l).props.type).toBe("range");
  });

  it("changes one tone control and keeps the rest", () => {
    const { root, onChange } = panel({ ...DEFAULT_POST, stages: tone({ contrast: 10 }) }, "tone");
    byLabel(root, "Gamma").props.onChange({ target: { value: "2.5" } });
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_POST, stages: tone({ contrast: 10, gamma: 2.5 }) });
  });

  it("ignores a slider value that is not a number and clamps one that is out of range", () => {
    const { root, onChange } = panel({ ...DEFAULT_POST, stages: tone({}) }, "tone");
    byLabel(root, "Gamma").props.onChange({ target: { value: "abc" } });
    expect(onChange).not.toHaveBeenCalled();
    byLabel(root, "Gamma").props.onChange({ target: { value: "99" } });
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_POST, stages: tone({ gamma: 3 }) });
  });

  it("keeps black below white when one slider is dragged past the other", () => {
    const { root, onChange } = panel({ ...DEFAULT_POST, stages: tone({ white: 100 }) }, "tone");
    byLabel(root, "Black point").props.onChange({ target: { value: "200" } });
    const next = onChange.mock.calls[0][0] as PostSettings;
    expect(next.stages.tone.params.black).toBeLessThan(next.stages.tone.params.white);
  });

  it("resets only the tone controls from the tone row", () => {
    const { root, onChange } = panel({ ...DEFAULT_POST, veil: "auto", stages: tone({ gamma: 2, contrast: 40 }) }, "tone");
    byLabel(root, "Reset tone").props.onClick();
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_POST, veil: "auto", stages: tone({}) });
  });
});

describe("Enhance panel: order controls and reset", () => {
  it("gives effect rows earlier and later buttons, disabled when there is nowhere to move, and none on veil or portal", () => {
    const { root } = panel({ ...DEFAULT_POST, stages: tone({ gamma: 2 }) });
    const earlier = within(row(root, "tone"), "Move Tone earlier");
    const later = within(row(root, "tone"), "Move Tone later");
    expect(earlier.props.disabled).toBe(true);
    expect(later.props.disabled).toBe(true); // the only effect that is on
    expect(within(row(root, "veil"), "Move GUI veil earlier")).toBeUndefined();
    expect(within(row(root, "portal"), "Move Portal later")).toBeUndefined();
  });

  it("disables moving a switched-off effect", () => {
    const { root } = panel({ ...DEFAULT_POST, stages: tone({ gamma: 2 }, false) });
    expect(within(row(root, "tone"), "Move Tone earlier").props.disabled).toBe(true);
  });

  it("has a reset for everything", () => {
    const { root, onReset } = panel();
    byLabel(root, "Reset effects").props.onClick();
    expect(onReset).toHaveBeenCalledOnce();
  });

  it("shows the key that toggles post-processing", () => {
    expect(String(byLabel(panel().root, "Post-processing").props.title)).toContain("V");
  });
});

describe("Enhance panel: the other effects", () => {
  it("shows sharpen's three sliders and changes one", () => {
    const settings = { ...DEFAULT_POST, stages: stage("sharpen", { amount: 80, radius: 2, threshold: 4 }) };
    const { root, onChange } = panel(settings, "sharpen");
    expect(["Amount", "Radius", "Threshold"].map(l => byLabel(root, l).props.value)).toEqual([80, 2, 4]);
    byLabel(root, "Amount").props.onChange({ target: { value: "120" } });
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_POST, stages: stage("sharpen", { amount: 120, radius: 2, threshold: 4 }) });
  });

  it("clamps a slider to its limits", () => {
    const { root, onChange } = panel({ ...DEFAULT_POST, stages: stage("sharpen", { amount: 50 }) }, "sharpen");
    byLabel(root, "Amount").props.onChange({ target: { value: "9999" } });
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_POST, stages: stage("sharpen", { amount: 300 }) });
  });

  it("explains that the fire view is a view aid, not detection", () => {
    const { root } = panel({ ...DEFAULT_POST, stages: stage("fire", { strength: 50 }) }, "fire");
    expect(byLabel(root, "Strength").props.value).toBe(50);
    expect(String(within(row(root, "fire"), "Show Fire view controls").props.title).toLowerCase()).toContain("not a detector");
  });

  it("shows the channel view as a choice and changes it by number", () => {
    const { root, onChange } = panel({ ...DEFAULT_POST, stages: stage("channels", { mode: 1 }) }, "channels");
    const select = byLabel(root, "Channel");
    expect(select.type).toBe("select");
    expect(select.props.value).toBe(1);
    expect(all(select, e => e.type === "option").map(o => text(o))).toEqual(["All", "Red", "Green", "Blue", "Brightness"]);
    select.props.onChange({ target: { value: "3" } });
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_POST, stages: stage("channels", { mode: 3 }) });
    onChange.mockClear();
    select.props.onChange({ target: { value: "banana" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("resets only the selected effect's controls", () => {
    const settings = { ...DEFAULT_POST, stages: { ...stage("sharpen", { amount: 90 }), tone: { on: true, params: { ...DEFAULT_TONE, gamma: 2 } } } };
    const { root, onChange } = panel(settings, "sharpen");
    byLabel(root, "Reset sharpen").props.onClick();
    expect(onChange).toHaveBeenCalledWith({ ...settings, stages: { ...settings.stages, sharpen: { on: true, params: { ...DEFAULT_POST.stages.sharpen.params } } } });
  });

  it("moves an effect later past another that is on, by its button", () => {
    const settings = { ...DEFAULT_POST, stages: { ...tone({ gamma: 2 }), sharpen: { on: true, params: { amount: 80, radius: 1.5, threshold: 0 } } } };
    const { root, onChange } = panel(settings, "tone");
    const later = within(row(root, "tone"), "Move Tone later");
    expect(later.props.disabled).toBe(false);
    later.props.onClick();
    expect((onChange.mock.calls[0][0] as PostSettings).order).toEqual(["sharpen", "denoise", "deblur", "tone", "fire", "channels"]);
    expect(within(row(root, "sharpen"), "Move Sharpen later").props.disabled).toBe(true);
  });
});

describe("Enhance panel: presets", () => {
  it("offers None and every preset, and shows the one that matches", () => {
    const { root } = panel(applyPreset(DEFAULT_POST, "dark"));
    const select = byLabel(root, "Preset");
    expect(select.props.value).toBe("dark");
    const values = all(select, e => e.type === "option").map(o => o.props.value);
    expect(values).toEqual(["none", ...PRESETS.map(p => p.id)]);
  });

  it("shows Custom when the settings match no preset", () => {
    const base = applyPreset(DEFAULT_POST, "dark");
    const nudged = { ...base, stages: { ...base.stages, tone: { ...base.stages.tone, params: { ...base.stages.tone.params, gamma: 1.123 } } } };
    const select = byLabel(panel(nudged).root, "Preset");
    expect(select.props.value).toBe("custom");
    expect(all(select, e => e.type === "option").map(o => o.props.value)).toContain("custom");
  });

  it("applies the chosen preset through onChange, and ignores Custom", () => {
    const { root, onChange } = panel();
    byLabel(root, "Preset").props.onChange({ target: { value: "dark" } });
    expect(onChange).toHaveBeenCalledWith(applyPreset(DEFAULT_POST, "dark"));
    onChange.mockClear();
    byLabel(root, "Preset").props.onChange({ target: { value: "custom" } });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("Enhance panel: denoise and deblur", () => {
  it("shows denoise's strength and radius, and keeps the radius a whole number", () => {
    const { root, onChange } = panel({ ...DEFAULT_POST, stages: stage("denoise", { strength: 40, radius: 2 }) }, "denoise");
    expect([byLabel(root, "Strength").props.value, byLabel(root, "Radius").props.value]).toEqual([40, 2]);
    expect(byLabel(root, "Radius").props.step).toBe(1);
    byLabel(root, "Strength").props.onChange({ target: { value: "70" } });
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_POST, stages: stage("denoise", { strength: 70, radius: 2 }) });
  });

  it("shows deblur's iterations and radius, and warns that it can ring on compressed footage", () => {
    const { root } = panel({ ...DEFAULT_POST, stages: stage("deblur", { iterations: 4, radius: 1.5 }) }, "deblur");
    expect([byLabel(root, "Iterations").props.value, byLabel(root, "Blur size").props.value]).toEqual([4, 1.5]);
    expect(String(within(row(root, "deblur"), "Show Deblur controls").props.title).toLowerCase()).toContain("ring");
  });
});

describe("Enhance panel: icons and short text", () => {
  const rowsWithControls: RowId[] = ["veil", "portal", "tone", "denoise", "deblur", "sharpen", "fire", "channels"];

  it("has no help paragraphs: that text lives in tooltips", () => {
    for (const id of rowsWithControls) {
      const { root } = panel({ ...DEFAULT_POST, portal: id === "portal" ? "manual" : "off" }, id);
      expect(all(root, e => e.props.className === "post-help"), id).toHaveLength(0);
    }
  });

  it("gives every row a tooltip on its name that explains it (the effects that have help text)", () => {
    const { root } = panel();
    for (const id of ["veil", "portal", "denoise", "deblur", "sharpen", "fire"] as RowId[]) {
      const title = String(within(row(root, id), `Show ${{ veil: "GUI veil", portal: "Portal", denoise: "Denoise", deblur: "Deblur", sharpen: "Sharpen", fire: "Fire view" }[id as "veil"]} controls`).props.title ?? "");
      expect(title.length, id).toBeGreaterThan(20);
    }
  });

  it("shows every switch as a toggle with no words, its state in aria-checked", () => {
    const { root } = panel({ ...DEFAULT_POST, veil: "auto" });
    for (const label of ["Post-processing", "GUI veil on/off", "Portal on/off", "Tone on/off"]) {
      const sw = byLabel(root, label);
      expect(sw.props.role).toBe("switch");
      expect(text(sw), label).toBe("");
    }
    expect(byLabel(root, "GUI veil on/off").props["aria-checked"]).toBe(true);
    expect(byLabel(root, "Portal on/off").props["aria-checked"]).toBe(false);
  });

  it("has icon-only buttons for reset and use-last-fit, each with a label and a tooltip", () => {
    const { root } = panel({ ...DEFAULT_POST, portal: "manual" }, "portal");
    for (const label of ["Reset effects", "Use last fit"]) {
      const b = byLabel(root, label);
      expect(text(b), label).toBe("");
      expect(b.props.title).toBe(label);
      expect(all(b, e => e.props.className === "icon").length + all(b, e => typeof e.type === "function").length, label).toBeGreaterThan(0);
    }
    expect(text(byLabel(panel({ ...DEFAULT_POST }, "tone").root, "Reset tone"))).toBe("");
  });

  it("has no heading, key hint or footer sentence", () => {
    const { root } = panel();
    expect(all(root, e => e.type === "strong")).toHaveLength(0);
    expect(all(root, e => e.props.className === "post-key")).toHaveLength(0);
    expect(text(root).toLowerCase()).not.toContain("viewing only");
  });

  it("labels the preset choice by an icon, not a word", () => {
    const { root } = panel();
    expect(byLabel(root, "Preset").props.title).toBe("Preset");
    expect(text(all(root, e => e.props.className === "post-preset"))).not.toMatch(/^Preset/);
  });
});
