import { VEIL_MODES, type VeilMode } from "../lib/veil";
import { displayOrder, moveEnabled, rowNumbers } from "../lib/post/order";
import { PRESETS, applyPreset, presetOf } from "../lib/post/presets";
import { PORTAL_FRAMES, clampParam, repairManual, type PostSettings, type RowId, type StageId } from "../lib/post/settings";
import { STAGES } from "../lib/post/stages";
import { POST_TOGGLE_KEY } from "../lib/post/keys";
import { Icon } from "./Icon";
import "./EnhancePanel.css";

export const ROW_NAMES: Record<RowId, string> = {
  veil: "GUI veil", portal: "Portal", tone: STAGES.tone.name, denoise: STAGES.denoise.name, deblur: STAGES.deblur.name, sharpen: STAGES.sharpen.name, fire: STAGES.fire.name, channels: STAGES.channels.name,
};
const VEIL_LABELS: Record<VeilMode, string> = { off: "Off", auto: "Auto-undo", on: "Always undo" };
/** Shown on hover, on the row name, instead of paragraphs in the panel. */
const ROW_HELP: Partial<Record<RowId, string>> = {
  veil: "Reverses the darkening Minecraft draws behind an open screen. Auto only when a frame looks veiled; thresholds are in Settings.",
  portal: "Assumes portal rendering like vanilla 1.16.5; custom textures or shaders may change the result. Auto fits the frame and opacity; Manual applies the ones you pick, even where Auto finds no fit. GUI pixels are protected when a mask is available.",
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
}

/**
 * The Enhance panel: a vertical list of effects. Each row has its own on/off switch (separate from selecting the row),
 * the ones that are on come first and show the order they are applied in, and veil and portal stay pinned on top.
 * Switches and buttons use icons and tooltips instead of words. Plain elements only, so the whole tree can be read
 * without rendering.
 */
export function EnhancePanel({ settings, selected, onSelect, onChange, onReset, portalStatus, portalFit }: Props) {
  const numbers = rowNumbers(settings);
  const stageOn = (id: StageId) => settings.stages[id].on;
  const enabledOrder = displayOrder(settings.order, stageOn);
  const rows: RowId[] = ["veil", "portal", ...enabledOrder];
  const isStage = (id: RowId): id is StageId => id !== "veil" && id !== "portal";
  const isOn = (id: RowId) => (id === "veil" ? settings.veil !== "off" : id === "portal" ? settings.portal !== "off" : stageOn(id));
  const setStage = (id: StageId, patch: Partial<PostSettings["stages"][StageId]>) => onChange({ ...settings, stages: { ...settings.stages, [id]: { ...settings.stages[id], ...patch } } });
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
  const iconButton = (label: string, icon: "reset" | "copy", onClick: () => void, disabled = false) => (
    <button type="button" className="icon-button icon-only" aria-label={label} title={label} disabled={disabled} onClick={onClick}><Icon name={icon} /></button>
  );
  const control = (id: StageId, c: (typeof STAGES)[StageId]["controls"][number]) => {
    const value = settings.stages[id].params[c.key];
    const set = (raw: string) => {
      const next = Number(raw);
      if (raw === "" || !Number.isFinite(next)) return;
      setStage(id, { params: clampParam(id, c.key, next, settings.stages[id].params) });
    };
    if (c.kind === "choice") {
      return (
        <label className="post-slider post-choice" key={c.key}>
          <span>{c.label}</span>
          <select aria-label={c.label} value={value} onChange={e => set(e.target.value)}>
            {c.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      );
    }
    return (
      <label className="post-slider" key={c.key}>
        <span>{c.label}</span>
        <input type="range" aria-label={c.label} min={c.min} max={c.max} step={c.step} value={value} onChange={e => set(e.target.value)} />
        <output>{value}</output>
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
    const at = isStage(id) ? enabledOrder.indexOf(id) : -1;
    const canMove = (dir: -1 | 1) => isStage(id) && on && at >= 0 && at + dir >= 0 && at + dir < enabledOrder.length && stageOn(enabledOrder[at + dir]);
    const move = (step: number) => isStage(id) && onChange({ ...settings, order: moveEnabled(settings.order, stageOn, id, step) });
    return (
      <li key={id} data-row={id} className={`post-row ${on ? "on" : "off"}${selected === id ? " selected" : ""}`}>
        <div className="post-row-head">
          {number !== null ? <span className="post-badge">{number}</span> : <span className="post-badge-gap" aria-hidden="true" />}
          <button type="button" className="post-select" aria-label={`Show ${name} controls`} aria-expanded={selected === id} title={ROW_HELP[id]} onClick={() => onSelect(id)}>{name}</button>
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
  const current = presetOf(settings);
  return (
    <div className={`enhance-panel${settings.enabled ? "" : " master-off"}`}>
      <div className="post-head">
        <label className="post-preset">
          <Icon name="settings" />
          <select aria-label="Preset" title="Preset" value={current} onChange={e => {
            if (e.target.value === "custom") return;
            const next = applyPreset(settings, e.target.value);
            if (next !== settings) onChange(next);
          }}>
            <option value="none">None</option>
            {PRESETS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            {current === "custom" ? <option value="custom" disabled>Custom</option> : null}
          </select>
        </label>
        {iconButton("Reset effects", "reset", onReset)}
        <button type="button" role="switch" className="post-switch post-master" aria-label="Post-processing" title={MASTER_TITLE} aria-checked={settings.enabled} onClick={() => onChange({ ...settings, enabled: !settings.enabled })} />
      </div>
      <ul className="post-list">{rows.map(row)}</ul>
    </div>
  );
}
