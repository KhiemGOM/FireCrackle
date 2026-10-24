// The Match panel every tool shares (the quad mask, the 3D quad, first-person fire): Find, the options that apply to
// that tool, up to three numbered tries with their details on hover, the match's details and its live status. Each
// tool supplies its own matcher and leaves out options that do not apply to it (the 3D quad's planes come from its
// camera, so it has no mask changes; first-person fire matches a row and FOV, so it has neither option).
import { useEffect, useState, type SyntheticEvent } from "react";
import { Icon } from "./Icon";
import { readPreferences, writePreferences } from "../lib/preferences";
import "./QuadMatchControls.css";

export function showDetails(e: SyntheticEvent<HTMLButtonElement>) {
  const tip = e.currentTarget.nextElementSibling as HTMLElement | null;
  if (!tip?.showPopover) return;
  tip.showPopover();
  const anchor = e.currentTarget.getBoundingClientRect(), box = tip.getBoundingClientRect();
  tip.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - box.width - 8))}px`;
  tip.style.top = `${anchor.bottom + box.height + 8 <= window.innerHeight ? anchor.bottom + 6 : Math.max(8, anchor.top - box.height - 6)}px`;
}
export function hideDetails(e: SyntheticEvent<HTMLButtonElement>) {
  const tip = e.currentTarget.nextElementSibling as HTMLElement | null;
  tip?.hidePopover?.();
}

/** The options shared by every Match panel (one saved setting each, whichever tool changes it). */
export function useMatchOptions() {
  const saved = readPreferences();
  const [adjustQuad, setAdjustQuad] = useState(saved.matchAdjustQuad);
  const [onlyFiltered, setOnlyFiltered] = useState(saved.matchOnlyFiltered);
  return { adjustQuad, setAdjustQuad, onlyFiltered, setOnlyFiltered };
}
/** Saves the options when they change (call it after the panel's other effects). */
export function useSaveMatchOptions({ adjustQuad, onlyFiltered }: { adjustQuad: boolean; onlyFiltered: boolean }) {
  useEffect(() => { writePreferences({ matchAdjustQuad: adjustQuad, matchOnlyFiltered: onlyFiltered }); }, [adjustQuad, onlyFiltered]);
}

export interface MatchRank { key: string; label: string; details: string; pressed: boolean; onClick: () => void }
export interface MatchPanelProps {
  find: { label?: string; ariaLabel?: string; title: string; busy: boolean; disabled: boolean; onClick: () => void };
  /** Only filtered sprites (the atlas filters) and Allow mask changes, for the tools they apply to. */
  onlyFiltered?: { checked: boolean; onChange: (checked: boolean) => void };
  adjust?: { checked: boolean; onChange: (checked: boolean) => void };
  ranks: MatchRank[];
  ranksDisabled: boolean;
  info: string;
  summary: string;
  error?: boolean;
  /** Names the panel, and its live status (screen readers, and a tool's tests, find them by these). */
  label?: string;
  statusLabel?: string;
}

/** The panel's elements (a plain render, so a tool's own element tree holds them). */
export function matchPanel({ find, onlyFiltered, adjust, ranks, ranksDisabled, info, summary, error, label, statusLabel }: MatchPanelProps) {
  return <div className="match-controls" {...(label ? { "aria-label": label } : {})}>
    <button className="icon-button with-text" style={{ whiteSpace: "nowrap", flexShrink: 0 }} disabled={find.disabled || find.busy} onClick={find.onClick} title={find.title}
      {...(find.ariaLabel ? { "aria-label": find.ariaLabel } : {})}>
      <Icon name="zoomIn" /> {find.busy ? "Matching…" : find.label ?? "Find best match"}
    </button>
    {onlyFiltered && <label title="Apply the atlas left/right edge filters before trying any sprite"><input type="checkbox" aria-label="Only filtered sprites" checked={onlyFiltered.checked} onChange={e => onlyFiltered.onChange(e.target.checked)} /> Only filtered sprites</label>}
    {adjust && <label title="Fit candidate corners, then refine alignment of each suggested sprite. Off keeps all four corners exactly where you placed them."><input type="checkbox" aria-label="Adjust quad while matching" checked={adjust.checked} onChange={e => adjust.onChange(e.target.checked)} /> Allow mask changes</label>}
    {ranks.slice(0, 3).map((r, i) =>
      <span className="match-hover" key={r.key}>
        <button className="match-rank" disabled={ranksDisabled} aria-label={r.label} aria-pressed={r.pressed} onClick={r.onClick}
          onMouseEnter={showDetails} onMouseLeave={hideDetails} onFocus={showDetails} onBlur={hideDetails}>{i + 1}</button>
        <span className="match-details" popover="manual" role="tooltip">{r.details}</span>
      </span>)}
    <span className="match-hover">
      <button className={`icon-button icon-only${error ? " warn" : ""}`} aria-label="Match details" onMouseEnter={showDetails} onMouseLeave={hideDetails} onFocus={showDetails} onBlur={hideDetails}><Icon name={error ? "alert" : "info"} /></button>
      <span className="match-details" popover="manual" role="tooltip">{info}</span>
    </span>
    <span className="match-live-status" role={error ? "alert" : "status"} {...(statusLabel ? { "aria-label": statusLabel } : {})}>{summary}</span>
  </div>;
}
