import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { EnhancePanel } from "./EnhancePanel";
import { DEFAULT_POST, DEFAULT_TONE, type PostSettings, type RowId } from "../lib/post/settings";

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

const tone = (patch: Partial<PostSettings["stages"]["tone"]["params"]>, on = true): PostSettings["stages"] => ({ tone: { on, params: { ...DEFAULT_TONE, ...patch } } });

function panel(settings: PostSettings = DEFAULT_POST, selected: RowId = "veil", over: Record<string, unknown> = {}) {
  const handlers = { onSelect: vi.fn(), onChange: vi.fn(), onReset: vi.fn() };
  const root = EnhancePanel({ settings, selected, ...handlers, ...over } as Parameters<typeof EnhancePanel>[0]) as El;
  return { root, ...handlers };
}

describe("Enhance panel: the list", () => {
  it("lists GUI veil, Portal and Tone, in that order, veil and portal always first", () => {
    const { root } = panel();
    const rows = all(root, e => e.props["data-row"] !== undefined).map(e => e.props["data-row"]);
    expect(rows).toEqual(["veil", "portal", "tone"]);
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

  it("shows the portal choice and the portal status text when portal is selected", () => {
    const { root, onChange } = panel({ ...DEFAULT_POST, portal: "auto" }, "portal", { portalStatus: "No confident portal fit" });
    const select = byLabel(root, "Undo portal overlay");
    expect(select.props.value).toBe("auto");
    expect(all(select, e => e.type === "option").map(o => o.props.value)).toEqual(["off", "auto"]);
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
    all(root, e => e.type === "button" && text(e) === "Reset tone")[0].props.onClick();
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
    all(root, e => e.type === "button" && text(e) === "Reset effects")[0].props.onClick();
    expect(onReset).toHaveBeenCalledOnce();
  });

  it("shows the key that toggles post-processing", () => {
    expect(text(all(panel().root, e => e.props.className === "post-key"))).toContain("V");
  });
});
