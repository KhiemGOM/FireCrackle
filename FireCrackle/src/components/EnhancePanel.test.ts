import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { EnhancePanel } from "./EnhancePanel";
import { DEFAULT_POST, DEFAULT_TONE, type PostSettings, type RowId } from "../lib/post/settings";
import { PRESETS, applyPreset } from "../lib/post/presets";
import { addUserPreset } from "../lib/post/userPresets";
import { STAGES } from "../lib/post/stages";

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
  const handlers = { onSelect: vi.fn(), onChange: vi.fn(), onReset: vi.fn(), onPresetName: vi.fn(), onSavePreset: vi.fn(), onDeletePreset: vi.fn() };
  const root = EnhancePanel({ settings, selected, userPresets: [], presetName: "", ...handlers, ...over } as Parameters<typeof EnhancePanel>[0]) as El;
  return { root, ...handlers };
}

describe("Enhance panel: the list", () => {
  it("puts Contrast first in the clearly named levels row, with an aggressive range", () => {
    const { root } = panel(DEFAULT_POST, "tone");
    expect(byLabel(root, "Show Contrast & levels controls")).toBeDefined();
    const sliders = all(row(root, "tone"), e => e.type === "input" && e.props.type === "range");
    expect(sliders[0].props["aria-label"]).toBe("Contrast");
    expect(sliders[0].props.max).toBeGreaterThan(100);
  });

  it("opens a preset's relevant controls immediately", () => {
    const { root, onSelect } = panel();
    byLabel(root, "Preset High contrast").props.onClick();
    expect(onSelect).toHaveBeenCalledWith("tone");
    byLabel(root, "Preset Find edges").props.onClick();
    expect(onSelect).toHaveBeenLastCalledWith("edges");
  });

  it("exposes the edge view, sensitivity and noise cutoff and turns edges on when adjusted", () => {
    const { root, onChange } = panel(DEFAULT_POST, "edges");
    expect(byLabel(root, "Edges from")).toBeDefined();
    expect(byLabel(root, "Sensitivity")).toBeDefined();
    expect(byLabel(root, "Noise cutoff")).toBeDefined();
    byLabel(root, "Edge view").props.onChange({ target: { value: "2" } });
    expect(onChange.mock.calls[0][0].stages.edges).toMatchObject({ on: true, params: { mode: 2 } });
  });
  it("lists GUI veil and Portal first, then the effects in their order", () => {
    const { root } = panel();
    const rows = all(root, e => e.props["data-row"] !== undefined).map(e => e.props["data-row"]);
    expect(rows).toEqual(["veil", "portal", "tone", "denoise", "deblur", "sharpen", "fire", "channels", "edges"]);
  });

  it("moves a switched-on effect up in front of the switched-off ones", () => {
    const { root } = panel({ ...DEFAULT_POST, stages: stage("channels", { mode: 2 }) });
    const rows = all(root, e => e.props["data-row"] !== undefined).map(e => e.props["data-row"]);
    expect(rows).toEqual(["veil", "portal", "channels", "tone", "denoise", "deblur", "sharpen", "fire", "edges"]);
  });

  it("names every effect", () => {
    const { root } = panel();
    for (const name of ["Contrast & levels", "Denoise", "Deblur", "Sharpen", "Fire view", "Channels", "Edge detection"]) expect(within(root, `Show ${name} controls`)).toBeDefined();
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
  it("has the one global on/off inside the panel, as a switch with the key in its tooltip", () => {
    const { root, onChange } = panel();
    const master = byLabel(root, "Post-processing");
    expect(master.props.role).toBe("switch");
    expect(master.props["aria-checked"]).toBe(true);
    expect(String(master.props.title)).toContain("V");
    expect(text(master)).toBe("");
    master.props.onClick();
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_POST, enabled: false });
    expect(all(root, e => e.props.role === "switch").length).toBe(1 + 7 + 2); // the master, then one per row
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
    within(row(root, "tone"), "Contrast & levels on/off").props.onClick();
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_POST, stages: tone({ gamma: 2 }, true) });
  });

  it("selecting a row is separate from its switch: the switch is not inside the select button and selecting changes nothing", () => {
    const { root, onSelect, onChange } = panel();
    const select = within(row(root, "tone"), "Show Contrast & levels controls");
    expect(all(select, e => e.props.role === "switch")).toHaveLength(0);
    select.props.onClick();
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("tone");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not change the settings object it was given", () => {
    const settings = { ...DEFAULT_POST, stages: tone({ gamma: 2 }) };
    const copy = JSON.parse(JSON.stringify(settings));
    const { root } = panel(settings, "tone");
    within(row(root, "tone"), "Contrast & levels on/off").props.onClick();
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
    byLabel(root, "Reset contrast & levels").props.onClick();
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_POST, veil: "auto", stages: tone({}) });
  });
});

describe("Enhance panel: order controls and reset", () => {
  it("gives effect rows earlier and later buttons, disabled when there is nowhere to move, and none on veil or portal", () => {
    const { root } = panel({ ...DEFAULT_POST, stages: tone({ gamma: 2 }) });
    const earlier = within(row(root, "tone"), "Move Contrast & levels earlier");
    const later = within(row(root, "tone"), "Move Contrast & levels later");
    expect(earlier.props.disabled).toBe(true);
    expect(later.props.disabled).toBe(true); // the only effect that is on
    expect(within(row(root, "veil"), "Move GUI veil earlier")).toBeUndefined();
    expect(within(row(root, "portal"), "Move Portal later")).toBeUndefined();
  });

  it("disables moving a switched-off effect", () => {
    const { root } = panel({ ...DEFAULT_POST, stages: tone({ gamma: 2 }, false) });
    expect(within(row(root, "tone"), "Move Contrast & levels earlier").props.disabled).toBe(true);
  });

  it("has a reset for everything", () => {
    const { root, onReset } = panel();
    byLabel(root, "Reset effects").props.onClick();
    expect(onReset).toHaveBeenCalledOnce();
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
    const later = within(row(root, "tone"), "Move Contrast & levels later");
    expect(later.props.disabled).toBe(false);
    later.props.onClick();
    expect((onChange.mock.calls[0][0] as PostSettings).order).toEqual(["sharpen", "denoise", "deblur", "tone", "fire", "channels", "edges"]);
    expect(within(row(root, "sharpen"), "Move Sharpen later").props.disabled).toBe(true);
  });
});

describe("Enhance panel: preset buttons", () => {
  const group = (root: El) => all(root, e => e.props.role === "group" && e.props["aria-label"] === "Presets")[0];
  const chip = (root: El, name: string) => byLabel(root, `Preset ${name}`);

  it("shows the presets as buttons under the word Presets, with no dropdown", () => {
    const { root } = panel();
    expect(group(root)).toBeDefined();
    expect(byLabel(root, "Preset")).toBeUndefined();
    expect(all(group(root), e => e.type === "select")).toHaveLength(0);
    for (const p of PRESETS) {
      const b = chip(root, p.name);
      expect(b.type).toBe("button");
      expect(text(b)).toBe(p.name);
    }
    expect(text(all(root, e => e.props.className === "post-presets-label")[0])).toBe("Presets");
  });

  it("marks the preset the settings match as pressed, and none when they match nothing", () => {
    const { root } = panel(applyPreset(DEFAULT_POST, "dark"));
    expect(chip(root, "Dark scene").props["aria-pressed"]).toBe(true);
    expect(chip(root, "Fire focus").props["aria-pressed"]).toBe(false);
    const base = applyPreset(DEFAULT_POST, "dark");
    const nudged = { ...base, stages: { ...base.stages, tone: { ...base.stages.tone, params: { ...base.stages.tone.params, gamma: 1.123 } } } };
    for (const p of PRESETS) expect(chip(panel(nudged).root, p.name).props["aria-pressed"], p.name).toBe(false);
  });

  it("applies a preset when its button is clicked, and clears the effects when the pressed one is clicked again", () => {
    const first = panel();
    chip(first.root, "Dark scene").props.onClick();
    expect(first.onChange).toHaveBeenCalledWith(applyPreset(DEFAULT_POST, "dark"));
    const pressed = panel(applyPreset(DEFAULT_POST, "dark"));
    chip(pressed.root, "Dark scene").props.onClick();
    expect(pressed.onChange).toHaveBeenCalledWith(applyPreset(applyPreset(DEFAULT_POST, "dark"), "none"));
  });

  it("shows the presets the user saved after the built-in ones, with a delete button each", () => {
    const user = addUserPreset([], "My night", { ...DEFAULT_POST, stages: { ...DEFAULT_POST.stages, tone: { on: true, params: { ...DEFAULT_POST.stages.tone.params, gamma: 1.4 } } } });
    const { root, onChange, onDeletePreset } = panel(DEFAULT_POST, "veil", { userPresets: user });
    const b = chip(root, "My night");
    expect(text(b)).toBe("My night");
    b.props.onClick();
    expect(onChange).toHaveBeenCalledWith(applyPreset(DEFAULT_POST, user[0].id, user));
    byLabel(root, "Delete preset My night").props.onClick();
    expect(onDeletePreset).toHaveBeenCalledExactlyOnceWith(user[0].id);
    expect(byLabel(root, "Delete preset Dark scene")).toBeUndefined(); // built-in presets cannot be deleted
  });

  it("saves the current effects under a typed name: the name box is controlled, Enter and the button both save", () => {
    const { root, onPresetName, onSavePreset } = panel(applyPreset(DEFAULT_POST, "dark"), "veil", { presetName: "Cave" });
    const input = byLabel(root, "Preset name");
    expect(input.props.value).toBe("Cave");
    input.props.onChange({ target: { value: "Cave 2" } });
    expect(onPresetName).toHaveBeenCalledWith("Cave 2");
    input.props.onKeyDown({ key: "Enter", preventDefault: vi.fn() });
    expect(onSavePreset).toHaveBeenCalledWith("Cave");
    byLabel(root, "Save as preset").props.onClick();
    expect(onSavePreset).toHaveBeenCalledTimes(2);
  });

  it("cannot save with a blank name or with no effect switched on, and other keys do not save", () => {
    expect(byLabel(panel(applyPreset(DEFAULT_POST, "dark"), "veil", { presetName: "  " }).root, "Save as preset").props.disabled).toBe(true);
    expect(byLabel(panel(DEFAULT_POST, "veil", { presetName: "Cave" }).root, "Save as preset").props.disabled).toBe(true);
    const ok = panel(applyPreset(DEFAULT_POST, "dark"), "veil", { presetName: "Cave" });
    expect(byLabel(ok.root, "Save as preset").props.disabled).toBe(false);
    byLabel(ok.root, "Preset name").props.onKeyDown({ key: "a", preventDefault: vi.fn() });
    expect(ok.onSavePreset).not.toHaveBeenCalled();
    const blank = panel(applyPreset(DEFAULT_POST, "dark"), "veil", { presetName: " " });
    byLabel(blank.root, "Preset name").props.onKeyDown({ key: "Enter", preventDefault: vi.fn() });
    expect(blank.onSavePreset).not.toHaveBeenCalled();
  });
});

describe("Enhance panel: sliders you can trust", () => {
  const off = (id: keyof PostSettings["stages"], params: Record<string, number> = {}) => stage(id, params, false);

  it("switches an effect on when you move one of its controls", () => {
    const settings = { ...DEFAULT_POST, stages: off("sharpen", { amount: 0 }) };
    const { root, onChange } = panel(settings, "sharpen");
    byLabel(root, "Amount").props.onChange({ target: { value: "60" } });
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_POST, stages: stage("sharpen", { amount: 60 }, true) });
  });

  it("switches it on from a choice and from a typed number too", () => {
    const channels = panel({ ...DEFAULT_POST, stages: off("channels") }, "channels");
    byLabel(channels.root, "Channel").props.onChange({ target: { value: "2" } });
    expect(channels.onChange).toHaveBeenCalledWith({ ...DEFAULT_POST, stages: stage("channels", { mode: 2 }, true) });
    const typed = panel({ ...DEFAULT_POST, stages: off("fire") }, "fire");
    byLabel(typed.root, "Strength value").props.onBlur({ target: { value: "30" } });
    expect(typed.onChange).toHaveBeenCalledWith({ ...DEFAULT_POST, stages: stage("fire", { strength: 30 }, true) });
  });

  it("leaves the switch alone when you reset a control (resetting is not asking for the effect)", () => {
    const settings = { ...DEFAULT_POST, stages: off("sharpen", { amount: 80 }) };
    const { root, onChange } = panel(settings, "sharpen");
    byLabel(root, "Amount").props.onDoubleClick();
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_POST, stages: off("sharpen", { amount: 0 }) });
  });

  it("marks a row whose controls differ from neutral, on or off, and not one that is untouched", () => {
    const marked = (settings: PostSettings, id: RowId) => all(row(panel(settings).root, id), e => e.props.className === "post-dot");
    expect(marked({ ...DEFAULT_POST, stages: off("sharpen", { amount: 80 }) }, "sharpen")).toHaveLength(1);
    expect(marked({ ...DEFAULT_POST, stages: stage("tone", { gamma: 1.3 }) }, "tone")).toHaveLength(1);
    expect(marked({ ...DEFAULT_POST, stages: stage("tone", {}) }, "tone")).toHaveLength(0);
    expect(marked(DEFAULT_POST, "veil")).toHaveLength(0);
    expect(String(row(panel({ ...DEFAULT_POST, stages: stage("tone", { gamma: 1.3 }) }).root, "tone").props.className)).toContain("modified");
  });

  it("highlights a control that is away from its neutral value", () => {
    const { root } = panel({ ...DEFAULT_POST, stages: stage("tone", { gamma: 1.3 }) }, "tone");
    const labelOf = (name: string) => all(root, e => e.type === "label" && all(e, x => x.props["aria-label"] === name).length > 0)[0];
    expect(String(labelOf("Gamma").props.className)).toContain("changed");
    expect(String(labelOf("Contrast").props.className)).not.toContain("changed");
  });

  it("resets one control to its neutral value on double-click and leaves the others", () => {
    const settings = { ...DEFAULT_POST, stages: stage("tone", { gamma: 1.8, contrast: 30 }) };
    const { root, onChange } = panel(settings, "tone");
    byLabel(root, "Gamma").props.onDoubleClick();
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_POST, stages: stage("tone", { gamma: 1, contrast: 30 }) });
  });

  it("lets you type a number: it is committed on Enter or on leaving the box, clamped, and nonsense is ignored", () => {
    const { root, onChange } = panel({ ...DEFAULT_POST, stages: stage("tone", {}) }, "tone");
    const box = byLabel(root, "Gamma value");
    expect(box.props.type).toBe("number");
    expect([box.props.min, box.props.max, box.props.step]).toEqual([0.3, 3, 0.05]);
    box.props.onBlur({ target: { value: "2" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_POST, stages: stage("tone", { gamma: 2 }) });
    box.props.onKeyDown({ key: "Enter", target: { value: "9" }, preventDefault: vi.fn() });
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_POST, stages: stage("tone", { gamma: 3 }) });
    onChange.mockClear();
    box.props.onBlur({ target: { value: "abc" } });
    box.props.onBlur({ target: { value: "" } });
    box.props.onKeyDown({ key: "Escape", target: { value: "2" }, preventDefault: vi.fn() });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps the typed box in step with the slider (its default value follows the value)", () => {
    const a = byLabel(panel({ ...DEFAULT_POST, stages: stage("tone", { gamma: 1.5 }) }, "tone").root, "Gamma value");
    const b = byLabel(panel({ ...DEFAULT_POST, stages: stage("tone", { gamma: 2.5 }) }, "tone").root, "Gamma value");
    expect(a.props.defaultValue).toBe(1.5);
    expect(b.props.defaultValue).toBe(2.5);
    expect(a.key).not.toBe(b.key); // a new key makes the box show the new value
  });

  it("moves by a fine step with Shift and an arrow key, clamped, and leaves plain arrows to the browser", () => {
    const { root, onChange } = panel({ ...DEFAULT_POST, stages: stage("tone", { gamma: 1.5 }) }, "tone");
    const slider = byLabel(root, "Gamma");
    const prevent = vi.fn();
    slider.props.onKeyDown({ key: "ArrowRight", shiftKey: true, preventDefault: prevent, target: { value: "1.5" } });
    expect(prevent).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_POST, stages: stage("tone", { gamma: 1.51 }) });
    slider.props.onKeyDown({ key: "ArrowLeft", shiftKey: true, preventDefault: vi.fn(), target: { value: "1.5" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_POST, stages: stage("tone", { gamma: 1.49 }) });
    onChange.mockClear();
    const plain = vi.fn();
    slider.props.onKeyDown({ key: "ArrowRight", shiftKey: false, preventDefault: plain, target: { value: "1.5" } });
    slider.props.onKeyDown({ key: "ArrowUp", shiftKey: true, preventDefault: plain, target: { value: "1.5" } });
    expect(plain).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    const top = panel({ ...DEFAULT_POST, stages: stage("tone", { gamma: 3 }) }, "tone");
    byLabel(top.root, "Gamma").props.onKeyDown({ key: "ArrowRight", shiftKey: true, preventDefault: vi.fn(), target: { value: "3" } });
    expect(top.onChange).toHaveBeenLastCalledWith({ ...DEFAULT_POST, stages: stage("tone", { gamma: 3 }) });
  });

  it("draws a tick where neutral is when that is inside the range, and none when neutral is at an end", () => {
    const ticks = (settings: PostSettings, id: RowId, label: string) => {
      const { root } = panel(settings, id);
      const lab = all(root, e => e.type === "label" && all(e, x => x.props["aria-label"] === label).length > 0)[0];
      return all(lab, e => e.props.className === "post-tick");
    };
    const gamma = ticks({ ...DEFAULT_POST, stages: stage("tone", {}) }, "tone", "Gamma");
    expect(gamma).toHaveLength(1);
    expect(parseFloat(String(gamma[0].props.style.left))).toBeCloseTo(((1 - 0.3) / (3 - 0.3)) * 100, 1);
    expect(parseFloat(String(ticks({ ...DEFAULT_POST, stages: stage("tone", {}) }, "tone", "Contrast")[0].props.style.left))).toBeCloseTo(20, 1);
    expect(ticks({ ...DEFAULT_POST, stages: stage("tone", {}) }, "tone", "Shadow lift")).toHaveLength(0); // neutral 0 is the left end
    expect(ticks({ ...DEFAULT_POST, stages: stage("tone", {}) }, "tone", "White point")).toHaveLength(0); // neutral 255 is the right end
  });

  it("fills the track up to the value through a CSS variable", () => {
    const slider = byLabel(panel({ ...DEFAULT_POST, stages: stage("tone", { gamma: 1.5 }) }, "tone").root, "Gamma");
    expect(parseFloat(String(slider.props.style["--pct"]))).toBeCloseTo(((1.5 - 0.3) / 2.7) * 100, 1);
    const atMin = byLabel(panel({ ...DEFAULT_POST, stages: stage("sharpen", { amount: 0 }) }, "sharpen").root, "Amount");
    expect(parseFloat(String(atMin.props.style["--pct"]))).toBe(0);
  });

  it("gives every control a fine step, so Shift+arrow always has something sensible to do", () => {
    for (const id of Object.keys(STAGES) as Array<keyof typeof STAGES>) for (const c of STAGES[id].controls) if (c.kind === "range") expect(c.fine ?? c.step, `${id}.${c.key}`).toBeGreaterThan(0);
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
  const rowsWithControls: RowId[] = ["veil", "portal", "tone", "denoise", "deblur", "sharpen", "fire", "channels", "edges"];

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
    for (const label of ["GUI veil on/off", "Portal on/off", "Contrast & levels on/off"]) {
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
    expect(text(byLabel(panel({ ...DEFAULT_POST }, "tone").root, "Reset contrast & levels"))).toBe("");
  });

  it("has no heading, key hint or footer sentence", () => {
    const { root } = panel();
    expect(all(root, e => e.type === "strong")).toHaveLength(0);
    expect(all(root, e => e.props.className === "post-key")).toHaveLength(0);
    expect(text(root).toLowerCase()).not.toContain("viewing only");
  });

});
