import { VEIL_MODES, type VeilMode } from "../lib/veil";
import { displayOrder, moveEnabled, rowNumbers } from "../lib/post/order";
import { PRESETS, applyPreset, presetOf } from "../lib/post/presets";
import { PORTAL_FRAMES, clampParam, repairManual, type PostSettings, type RowId, type StageId } from "../lib/post/settings";
import { STAGES } from "../lib/post/stages";
import { POST_TOGGLE_KEY } from "../lib/post/keys";
import "./EnhancePanel.css";

export const ROW_NAMES: Record<RowId, string> = {
  veil: "GUI veil", portal: "Portal", tone: STAGES.tone.name, denoise: STAGES.denoise.name, deblur: STAGES.deblur.name, sharpen: STAGES.sharpen.name, fire: STAGES.fire.name, channels: STAGES.channels.name,
};
const VEIL_LABELS: Record<VeilMode, string> = { off: "Off", auto: "Auto-undo", on: "Always undo" };

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
 * Plain elements only, so the whole tree can be read without rendering.
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
          <p className="post-help">Reverses the darkening Minecraft draws behind an open screen. Auto only when a frame looks veiled; the thresholds are in Settings.</p>
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
              <button type="button" disabled={!portalFit} onClick={() => portalFit && onChange({ ...settings, portalManual: repairManual(portalFit) })}>Use last fit</button>
              <p className="post-help">Manual: you choose the portal animation frame and its opacity, and it is applied even where Auto finds no fit. Pixels where the undo is badly conditioned stay unchanged.</p>
            </>
          ) : null}
          {portalStatus ? <p className="post-status" role="status">{portalStatus}</p> : null}
          <p className="post-help">Assumes portal rendering compatible with vanilla Minecraft 1.16.5; custom textures or shaders may affect the result. Protects GUI pixels when a reliable mask is available. Viewing correction only.</p>
        </div>
      );
    }
    const spec = STAGES[id];
    return (
      <div className="post-controls">
        {spec.controls.map(c => control(id, c))}
        <button type="button" onClick={() => setStage(id, { params: { ...spec.defaults } })}>{`Reset ${spec.name.toLowerCase()}`}</button>
        {spec.help ? <p className="post-help">{spec.help}</p> : null}
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
          <button type="button" className="post-select" aria-label={`Show ${name} controls`} aria-expanded={selected === id} onClick={() => onSelect(id)}>{name}</button>
          {isStage(id) ? (
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
  const current = presetOf(settings);
  return (
    <div className={`enhance-panel${settings.enabled ? "" : " master-off"}`}>
      <div className="post-head">
        <strong>Enhance</strong>
        <span className="post-key" title="Turns all post-processing on or off">Key {POST_TOGGLE_KEY.toUpperCase()}</span>
        <button type="button" role="switch" className="post-switch post-master" aria-label="Post-processing" aria-checked={settings.enabled} onClick={() => onChange({ ...settings, enabled: !settings.enabled })}>{settings.enabled ? "On" : "Off"}</button>
      </div>
      <label className="post-preset">
        <span>Preset</span>
        <select aria-label="Preset" value={current} onChange={e => {
          if (e.target.value === "custom") return;
          const next = applyPreset(settings, e.target.value);
          if (next !== settings) onChange(next);
        }}>
          <option value="none">None</option>
          {PRESETS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          {current === "custom" ? <option value="custom" disabled>Custom</option> : null}
        </select>
      </label>
      <ul className="post-list">{rows.map(row)}</ul>
      <button type="button" className="post-reset" onClick={onReset}>Reset effects</button>
      <p className="post-help">Viewing only: the picture is changed for you to look at. Detection and exports use the original frames.</p>
    </div>
  );
}
