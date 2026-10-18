import { useState } from "react";
import type { SettingInfo } from "../lib/api";

const GROUP_TITLES: Record<string, string> = {
  label: "Labelling",
  phase: "Phase check",
  phase_v2: "Clock and recovery",
  index: "Video timing",
  decode: "Frame decoding",
  autosave: "Autosave",
  timeline: "Timeline",
  project: "Project",
};

interface Props {
  extraSources?: boolean;
  onExtraSources?: (enabled: boolean) => void;
  settings: SettingInfo[];
  onSet: (key: string, value: number) => Promise<string | null>;
  onClose: () => void;
}

function Row({ s, onSet }: { s: SettingInfo; onSet: Props["onSet"] }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = text ?? String(s.value);

  async function commit(value: number) {
    const err = await onSet(s.key, value);
    setError(err);
    if (!err) setText(null);
  }

  return (
    <div className={`setting${error ? " bad" : ""}`}>
      <div className="setting-head">
        <label htmlFor={s.key}>{s.label}</label>
        <input
          id={s.key}
          type="number"
          value={shown}
          min={s.min}
          max={s.max}
          step={s.integer ? 1 : "any"}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text !== null && commit(Number(text))}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setText(null);
          }}
        />
        <button className="mini" disabled={s.value === s.default} onClick={() => commit(s.default)} title="back to the default">
          reset
        </button>
      </div>
      <div className="setting-range">
        default {s.default} · allowed {s.min} to {s.max}
        {s.integer ? " · whole numbers" : ""}
      </div>
      <div className="setting-explain">{s.explanation}</div>
      {error && <div className="setting-error">{error}</div>}
    </div>
  );
}

/** Every tunable threshold, generated from the backend's own description (with its explanation). */
export function SettingsPanel({ settings, onSet, onClose, extraSources = false, onExtraSources }: Props) {
  const groups = Array.from(new Set(settings.map((s) => s.key.split(".")[0])));
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Settings</h2>
          <button onClick={onClose}>close</button>
        </div>
        <p className="modal-note">
          Nothing is hard-coded: every threshold the program uses is here, with what it does. Changes apply at once and are saved in the
          project folder.
        </p>
        <div className="modal-body">
          <section>
            <h3>Texture sources</h3>
            <label><input type="checkbox" checked={extraSources} onChange={e => onExtraSources?.(e.target.checked)} /> Enable extra texture sources</label>
            <p className="setting-explain">Soul fire, lava, water and combined charts. Off keeps the 0.3 fire-only interface. Saved for this app.</p>
          </section>
          {groups.map((g) => (
            <section key={g}>
              <h3>{GROUP_TITLES[g] ?? g}</h3>
              {settings
                .filter((s) => s.key.startsWith(`${g}.`))
                .map((s) => (
                  <Row key={s.key} s={s} onSet={onSet} />
                ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
