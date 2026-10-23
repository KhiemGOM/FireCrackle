import type { CSSProperties } from "react";
import { MENU_VEILS, VEIL_MODES, type MenuVeil, type VeilMode } from "../lib/veil";
import { displayOrder, moveEnabled, rowNumbers } from "../lib/post/order";
import { allPresets, applyPreset, presetOf, type Preset } from "../lib/post/presets";
import { PORTAL_FRAMES, STAGE_IDS, clampParam, repairManual, type PostSettings, type RowId, type StageId } from "../lib/post/settings";
import { STAGES, type Control } from "../lib/post/stages";
import { MAX_PRESET_NAME } from "../lib/post/userPresets";
import { POST_TOGGLE_KEY } from "../lib/post/keys";
import { Icon } from "./Icon";
import "./EnhancePanel.css";

export const ROW_NAMES: Record<RowId, string> = {
  veil: "GUI veil", portal: "Portal", tone: STAGES.tone.name, denoise: STAGES.denoise.name, deblur: STAGES.deblur.name, sharpen: STAGES.sharpen.name, fire: STAGES.fire.name, channels: STAGES.channels.name, edges: STAGES.edges.name,
};
const VEIL_LABELS: Record<VeilMode, string> = { off: "Off", auto: "Auto-undo", on: "Always undo" };
const MENU_VEIL_LABELS: Record<MenuVeil, string> = { flat: "Menus: vignette veil (1.16)", blur: "Menus: blur veil (1.21+)" };
/** Shown on hover, on the row name, instead of paragraphs in the panel. */
const ROW_HELP: Partial<Record<RowId, string>> = {
  veil: "Reverses the darkening Minecraft draws behind an open screen. Auto uses veil evidence and preserves detected GUI pixels. Always undo processes every pixel; thresholds are in Settings.",
  portal: "Assumes portal rendering like vanilla 1.16.5; custom textures or shaders may change the result. Auto fits the frame and opacity; Manual applies the ones you pick, even where Auto finds no fit. Auto protects detected GUI pixels; Manual processes the entire picture.",
  ...Object.fromEntries((Object.keys(STAGES) as StageId[]).filter(id => STAGES[id].help).map(id => [id, STAGES[id].help])),
};
const MASTER_TITLE = `Post-processing on/off · ${POST_TOGGLE_KEY.toUpperCase()} · view only: detection and exports use the original frames`;

interface Props {
  settings: PostSettings;
  /** The row whose controls are open. */
  selected: RowId;
  onSelect: (id: RowId) => void;
  onChange: (next: PostSettings) => void;
  onReset: () => void;
  /** What the portal stage reported for the picture on screen. */
  portalStatus?: string;
  /** The phase and opacity the automatic portal fit found last, to start the manual values from. */
  portalFit?: { phase: number; opacity: number } | null;
  /** The presets the user saved, the name being typed for the next one, and what to do with them. */
  userPresets?: readonly Preset[];
  presetName?: string;
  onPresetName?: (name: string) => void;
  onSavePreset?: (name: string) => void;
  onDeletePreset?: (id: string) => void;
}

const percent = (c: Control, v: number) => Math.min(100, Math.max(0, ((v - c.min) / (c.max - c.min)) * 100));

/**
 * The Enhance panel: a vertical list of effects. Each row has its own on/off switch (separate from selecting the row),
 * the ones that are on come first and show the order they are applied in, and veil and portal stay pinned on top.
 * Moving any control of an effect switches it on; a dot marks an effect whose controls differ from neutral; a slider
 * resets on double-click and can be typed into; Shift + arrow moves it a fine step. Plain elements only, so the whole
 * tree can be read without rendering.
 */
export function EnhancePanel({ settings, selected, onSelect, onChange, onReset, portalStatus, portalFit, userPresets = [], presetName = "", onPresetName, onSavePreset, onDeletePreset }: Props) {
  const numbers = rowNumbers(settings);
  const stageOn = (id: StageId) => settings.stages[id].on;
  const enabledOrder = displayOrder(settings.order, stageOn);
  const rows: RowId[] = ["veil", "portal", ...enabledOrder];
  const isStage = (id: RowId): id is StageId => id !== "veil" && id !== "portal";
  const isOn = (id: RowId) => (id === "veil" ? settings.veil !== "off" : id === "portal" ? settings.portal !== "off" : stageOn(id));
  const setStage = (id: StageId, patch: Partial<PostSettings["stages"][StageId]>) => onChange({ ...settings, stages: { ...settings.stages, [id]: { ...settings.stages[id], ...patch } } });
  const modified = (id: StageId) => STAGES[id].controls.some(c => settings.stages[id].params[c.key] !== STAGES[id].defaults[c.key]);
  const flip = (id: RowId) => {
    if (id === "veil") onChange({ ...settings, veil: settings.veil === "off" ? "auto" : "off" });
    else if (id === "portal") onChange({ ...settings, portal: settings.portal === "off" ? "auto" : "off" });
    else setStage(id, { on: !stageOn(id) });
  };
  const manual = (key: "phase" | "opacity", raw: string) => {
    const next = Number(raw);
    if (raw === "" || !Number.isFinite(next)) return;
    onChange({ ...settings, portalManual: repairManual({ ...settings.portalManual, [key]: next }) });
  };
  const iconButton = (label: string, icon: "reset" | "copy" | "save", onClick: () => void, disabled = false) => (
    <button type="button" className="icon-button icon-only" aria-label={label} title={label} disabled={disabled} onClick={onClick}><Icon name={icon} /></button>
  );
  const control = (id: StageId, c: Control) => {
    const value = settings.stages[id].params[c.key];
    const neutral = STAGES[id].defaults[c.key];
    // moving a control is asking for the effect, so it switches on; the number is brought inside the limits
    const commit = (raw: string) => {
      const next = Number(raw);
      if (raw === "" || !Number.isFinite(next)) return;
      setStage(id, { on: true, params: clampParam(id, c.key, next, settings.stages[id].params) });
    };
    const className = `post-slider${value !== neutral ? " changed" : ""}`;
    if (c.kind === "choice") {
      return (
        <label className={`${className} post-choice`} key={c.key}>
          <span>{c.label}</span>
          <select aria-label={c.label} value={value} onChange={e => commit(e.target.value)}>
            {c.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      );
    }
    const tick = percent(c, neutral);
    return (
      <label className={className} key={c.key}>
        <span>{c.label}</span>
        <span className="post-track">
          <input type="range" aria-label={c.label} min={c.min} max={c.max} step={c.step} value={value} style={{ "--pct": `${percent(c, value)}%`, "--f": String(percent(c, value) / 100) } as CSSProperties}
            title="Double-click to reset · Shift + arrow keys for fine steps"
            onChange={e => commit(e.target.value)}
            onDoubleClick={() => setStage(id, { params: { ...settings.stages[id].params, [c.key]: neutral } })}
            onKeyDown={e => {
              if (!e.shiftKey || !c.fine || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
              e.preventDefault();
              commit(String(Number((Number((e.target as HTMLInputElement).value) + (e.key === "ArrowRight" ? c.fine : -c.fine)).toFixed(4))));
            }} />
          {tick > 0.5 && tick < 99.5 ? <span className="post-tick" style={{ left: `${tick}%`, "--f": String(tick / 100) } as CSSProperties} /> : null}
        </span>
        <input type="number" className="post-number" aria-label={`${c.label} value`} key={`${c.key}-${value}`} min={c.min} max={c.max} step={c.step} defaultValue={value}
          onBlur={e => commit(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commit((e.target as HTMLInputElement).value); } }} />
      </label>
    );
  };
  const controls = (id: RowId) => {
    if (id === "veil") {
      return (
        <div className="post-controls">
          <select aria-label="Undo GUI veil" value={settings.veil} onChange={e => VEIL_MODES.includes(e.target.value as VeilMode) && onChange({ ...settings, veil: e.target.value as VeilMode })}>
            {VEIL_MODES.map(m => <option key={m} value={m}>{VEIL_LABELS[m]}</option>)}
          </select>
          {settings.veil !== "off" ? (
            <select aria-label="Menu veil" title="How this video's version veils menus (pause, options): inventories always use the flat veil" value={settings.menuVeil}
              onChange={e => MENU_VEILS.includes(e.target.value as MenuVeil) && onChange({ ...settings, menuVeil: e.target.value as MenuVeil })}>
              {MENU_VEILS.map(m => <option key={m} value={m}>{MENU_VEIL_LABELS[m]}</option>)}
            </select>
          ) : null}
        </div>
      );
    }
    if (id === "portal") {
      return (
        <div className="post-controls">
          <select aria-label="Undo portal overlay" value={settings.portal} onChange={e => (e.target.value === "off" || e.target.value === "auto" || e.target.value === "manual") && onChange({ ...settings, portal: e.target.value })}>
            <option value="off">Off</option>
            <option value="auto">Auto-undo</option>
            <option value="manual">Manual</option>
          </select>
          {settings.portal === "manual" ? (
            <>
              <label className="post-slider">
                <span>Phase</span>
                <input type="range" aria-label="Portal phase" min={0} max={PORTAL_FRAMES - 1} step={1} value={settings.portalManual.phase} onChange={e => manual("phase", e.target.value)} />
                <output>{settings.portalManual.phase}</output>
              </label>
              <label className="post-slider">
                <span>Opacity</span>
                <input type="range" aria-label="Portal opacity" min={0} max={1} step={0.01} value={settings.portalManual.opacity} onChange={e => manual("opacity", e.target.value)} />
                <output>{settings.portalManual.opacity}</output>
              </label>
              {iconButton("Use last fit", "copy", () => portalFit && onChange({ ...settings, portalManual: repairManual(portalFit) }), !portalFit)}
            </>
          ) : null}
          {portalStatus ? <p className="post-status" role="status">{portalStatus}</p> : null}
        </div>
      );
    }
    const spec = STAGES[id];
    return (
      <div className="post-controls">
        {spec.controls.map(c => control(id, c))}
        {iconButton(`Reset ${spec.name.toLowerCase()}`, "reset", () => setStage(id, { params: { ...spec.defaults } }))}
      </div>
    );
  };
  const row = (id: RowId) => {
    const name = ROW_NAMES[id];
    const on = isOn(id);
    const number = numbers[id];
    const changed = isStage(id) && modified(id);
    const at = isStage(id) ? enabledOrder.indexOf(id) : -1;
    const canMove = (dir: -1 | 1) => isStage(id) && on && at >= 0 && at + dir >= 0 && at + dir < enabledOrder.length && stageOn(enabledOrder[at + dir]);
    const move = (step: number) => isStage(id) && onChange({ ...settings, order: moveEnabled(settings.order, stageOn, id, step) });
    return (
      <li key={id} data-row={id} className={`post-row ${on ? "on" : "off"}${selected === id ? " selected" : ""}${changed ? " modified" : ""}`}>
        <div className="post-row-head">
          {number !== null ? <span className="post-badge">{number}</span> : <span className="post-badge-gap" aria-hidden="true" />}
          <button type="button" className="post-select" aria-label={`Show ${name} controls`} aria-expanded={selected === id} title={ROW_HELP[id]} onClick={() => onSelect(id)}>{name}</button>
          {changed ? <span className="post-dot" title="Changed from neutral" /> : null}
          {isStage(id) ? (
            <span className="post-moves">
              <button type="button" aria-label={`Move ${name} earlier`} title="Earlier" disabled={!canMove(-1)} onClick={() => move(-1)}>▲</button>
              <button type="button" aria-label={`Move ${name} later`} title="Later" disabled={!canMove(1)} onClick={() => move(1)}>▼</button>
            </span>
          ) : null}
          <button type="button" role="switch" className="post-switch" aria-label={`${name} on/off`} title={`${name} on/off`} aria-checked={on} onClick={() => flip(id)} />
        </div>
        {selected === id ? controls(id) : null}
      </li>
    );
  };
  const current = presetOf(settings, userPresets);
  const builtInCount = allPresets().length;
  const canSave = presetName.trim() !== "" && STAGE_IDS.some(id => stageOn(id));
  return (
    <div className={`enhance-panel${settings.enabled ? "" : " master-off"}`}>
      <div className="post-head">
        <span className="post-presets-label">Presets</span>
        {iconButton("Reset effects", "reset", onReset)}
        <button type="button" role="switch" className="post-switch post-master" aria-label="Post-processing" title={MASTER_TITLE} aria-checked={settings.enabled} onClick={() => onChange({ ...settings, enabled: !settings.enabled })} />
      </div>
      <div className="post-presets" role="group" aria-label="Presets">
        {allPresets(userPresets).map((p, i) => {
          const pressed = current === p.id;
          return (
            <span className="post-chip-wrap" key={p.id}>
              <button type="button" className={`post-chip${pressed ? " on" : ""}`} aria-label={`Preset ${p.name}`} aria-pressed={pressed} title={p.help}
                onClick={() => {
                  onChange(pressed ? applyPreset(settings, "none") : applyPreset(settings, p.id, userPresets));
                  if (!pressed) {
                    const first = Object.keys(p.stages).find(id => STAGE_IDS.includes(id as StageId));
                    if (first) onSelect(first as StageId);
                  }
                }}>{p.name}</button>
              {i >= builtInCount ? <button type="button" className="post-chip-x" aria-label={`Delete preset ${p.name}`} title="Delete this preset" onClick={() => onDeletePreset?.(p.id)}>×</button> : null}
            </span>
          );
        })}
      </div>
      <div className="post-save">
        <input type="text" className="post-name" aria-label="Preset name" placeholder="Save current as…" maxLength={MAX_PRESET_NAME} value={presetName}
          onChange={e => onPresetName?.(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && canSave) { e.preventDefault(); onSavePreset?.(presetName); } }} />
        {iconButton("Save as preset", "save", () => onSavePreset?.(presetName), !canSave)}
      </div>
      <ul className="post-list">{rows.map(row)}</ul>
    </div>
  );
}
