import { VEIL_MODES, type VeilMode } from "../lib/veil";
import { displayOrder, moveEnabled, rowNumbers } from "../lib/post/order";
import { DEFAULT_TONE, clampTone, type PostSettings, type RowId, type StageId, type ToneParams } from "../lib/post/settings";
import { POST_TOGGLE_KEY } from "../lib/post/keys";
import "./EnhancePanel.css";

export const ROW_NAMES: Record<RowId, string> = { veil: "GUI veil", portal: "Portal", tone: "Tone" };
const VEIL_LABELS: Record<VeilMode, string> = { off: "Off", auto: "Auto-undo", on: "Always undo" };
const SLIDERS: Array<{ key: keyof ToneParams; label: string; step: number }> = [
  { key: "gamma", label: "Gamma", step: 0.05 },
  { key: "black", label: "Black point", step: 1 },
  { key: "white", label: "White point", step: 1 },
  { key: "contrast", label: "Contrast", step: 1 },
  { key: "shadows", label: "Shadow lift", step: 1 },
];
const LIMITS: Record<keyof ToneParams, [number, number]> = { gamma: [0.3, 3], black: [0, 254], white: [1, 255], contrast: [-100, 100], shadows: [0, 100] };

interface Props {
  settings: PostSettings;
  /** The row whose controls are open. */
  selected: RowId;
  onSelect: (id: RowId) => void;
  onChange: (next: PostSettings) => void;
  onReset: () => void;
  /** What the portal stage reported for the picture on screen. */
  portalStatus?: string;
}

/**
 * The Enhance panel: a vertical list of effects. Each row has its own on/off switch (separate from selecting the row),
 * the ones that are on come first and show the order they are applied in, and veil and portal stay pinned on top.
 * Plain elements only, so the whole tree can be read without rendering.
 */
export function EnhancePanel({ settings, selected, onSelect, onChange, onReset, portalStatus }: Props) {
  const numbers = rowNumbers(settings);
  const stageOn = (id: StageId) => settings.stages[id].on;
  const rows: RowId[] = ["veil", "portal", ...displayOrder(settings.order, stageOn)];
  const isOn = (id: RowId) => (id === "veil" ? settings.veil !== "off" : id === "portal" ? settings.portal !== "off" : stageOn(id));
  const setTone = (patch: Partial<PostSettings["stages"]["tone"]>) => onChange({ ...settings, stages: { tone: { ...settings.stages.tone, ...patch } } });
  const flip = (id: RowId) => {
    if (id === "veil") onChange({ ...settings, veil: settings.veil === "off" ? "auto" : "off" });
    else if (id === "portal") onChange({ ...settings, portal: settings.portal === "off" ? "auto" : "off" });
    else setTone({ on: !settings.stages.tone.on });
  };
  const slider = (key: keyof ToneParams, label: string, step: number) => {
    const value = settings.stages.tone.params[key];
    return (
      <label className="post-slider" key={key}>
        <span>{label}</span>
        <input type="range" aria-label={label} min={LIMITS[key][0]} max={LIMITS[key][1]} step={step} value={value}
          onChange={e => {
            const next = Number(e.target.value);
            if (e.target.value === "" || !Number.isFinite(next)) return;
            setTone({ params: clampTone(key, next, settings.stages.tone.params) });
          }} />
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
          <p className="post-help">Reverses the darkening Minecraft draws behind an open screen. Auto only when a frame looks veiled; the thresholds are in Settings.</p>
        </div>
      );
    }
    if (id === "portal") {
      return (
        <div className="post-controls">
          <select aria-label="Undo portal overlay" value={settings.portal} onChange={e => (e.target.value === "off" || e.target.value === "auto") && onChange({ ...settings, portal: e.target.value })}>
            <option value="off">Off</option>
            <option value="auto">Auto-undo</option>
          </select>
          {portalStatus ? <p className="post-status" role="status">{portalStatus}</p> : null}
          <p className="post-help">Assumes portal rendering compatible with vanilla Minecraft 1.16.5; custom textures or shaders may affect the result. Protects GUI pixels when a reliable mask is available. Viewing correction only.</p>
        </div>
      );
    }
    return (
      <div className="post-controls">
        {SLIDERS.map(s => slider(s.key, s.label, s.step))}
        <button type="button" onClick={() => setTone({ params: { ...DEFAULT_TONE } })}>Reset tone</button>
      </div>
    );
  };
  const row = (id: RowId) => {
    const name = ROW_NAMES[id];
    const on = isOn(id);
    const number = numbers[id];
    const stage = id !== "veil" && id !== "portal";
    const enabledOrder = displayOrder(settings.order, stageOn);
    const at = stage ? enabledOrder.indexOf(id as StageId) : -1;
    const canMove = (dir: -1 | 1) => stage && on && at >= 0 && at + dir >= 0 && at + dir < enabledOrder.length && stageOn(enabledOrder[at + dir]);
    const move = (step: number) => onChange({ ...settings, order: moveEnabled(settings.order, stageOn, id as StageId, step) });
    return (
      <li key={id} data-row={id} className={`post-row ${on ? "on" : "off"}${selected === id ? " selected" : ""}`}>
        <div className="post-row-head">
          {number !== null ? <span className="post-badge">{number}</span> : <span className="post-badge-gap" aria-hidden="true" />}
          <button type="button" className="post-select" aria-label={`Show ${name} controls`} aria-expanded={selected === id} onClick={() => onSelect(id)}>{name}</button>
          {stage ? (
            <span className="post-moves">
              <button type="button" aria-label={`Move ${name} earlier`} disabled={!canMove(-1)} onClick={() => move(-1)}>▲</button>
              <button type="button" aria-label={`Move ${name} later`} disabled={!canMove(1)} onClick={() => move(1)}>▼</button>
            </span>
          ) : null}
          <button type="button" role="switch" className="post-switch" aria-label={`${name} on/off`} aria-checked={on} onClick={() => flip(id)}>{on ? "On" : "Off"}</button>
        </div>
        {selected === id ? controls(id) : null}
      </li>
    );
  };
  return (
    <div className={`enhance-panel${settings.enabled ? "" : " master-off"}`}>
      <div className="post-head">
        <strong>Enhance</strong>
        <span className="post-key" title="Turns all post-processing on or off">Key {POST_TOGGLE_KEY.toUpperCase()}</span>
        <button type="button" role="switch" className="post-switch post-master" aria-label="Post-processing" aria-checked={settings.enabled} onClick={() => onChange({ ...settings, enabled: !settings.enabled })}>{settings.enabled ? "On" : "Off"}</button>
      </div>
      <ul className="post-list">{rows.map(row)}</ul>
      <button type="button" className="post-reset" onClick={onReset}>Reset effects</button>
      <p className="post-help">Viewing only: the picture is changed for you to look at. Detection and exports use the original frames.</p>
    </div>
  );
}
