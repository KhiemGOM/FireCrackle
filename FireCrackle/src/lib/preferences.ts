import type { EdgeFilter } from "./atlasFilter";
import { VEIL_MODES, type VeilMode } from "./veil";

export interface Preferences {
  tab: "label" | "phase" | "images";
  atlasFilter: EdgeFilter;
  matchOpen: boolean;
  matchOnlyFiltered: boolean;
  matchAdjustQuad: boolean;
  animationOpen: boolean;
  animationOnlyFiltered: boolean;
  animationDelayMs: number;
  /** Undo the GUI veil on shown pictures: never, when detected, or always. */
  veilMode: VeilMode;
  portalMode: "off" | "auto";
}
export const PREFERENCES_KEY = "firecrackle.preferences.v1";
export const DEFAULT_PREFERENCES: Preferences = { tab: "label", atlasFilter: { left: null, right: null }, matchOpen: false, matchOnlyFiltered: true, matchAdjustQuad: true, animationOpen: false, animationOnlyFiltered: true, animationDelayMs: 250, veilMode: "off", portalMode: "off" };
type Store = Pick<Storage, "getItem" | "setItem">;
export function readPreferences(storage?: Pick<Store, "getItem">): Preferences {
  const result = { ...DEFAULT_PREFERENCES, atlasFilter: { ...DEFAULT_PREFERENCES.atlasFilter } };
  try {
    const raw = JSON.parse((storage ?? localStorage).getItem(PREFERENCES_KEY) ?? "null");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
    if (raw.tab === "label" || raw.tab === "phase" || raw.tab === "images") result.tab = raw.tab;
    for (const key of ["matchOpen", "matchOnlyFiltered", "matchAdjustQuad", "animationOpen", "animationOnlyFiltered"] as const) if (typeof raw[key] === "boolean") result[key] = raw[key];
    if (VEIL_MODES.includes(raw.veilMode)) result.veilMode = raw.veilMode;
    if (raw.portalMode === "off" || raw.portalMode === "auto") result.portalMode = raw.portalMode;
    if (Number.isInteger(raw.animationDelayMs) && raw.animationDelayMs >= 30 && raw.animationDelayMs <= 10000) result.animationDelayMs = raw.animationDelayMs;
    if (Array.isArray(raw.atlasFilter?.excluded)) {
      const excluded = [...new Set<number>(raw.atlasFilter.excluded.filter((n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 128))];
      if (excluded.length) result.atlasFilter.excluded = excluded;
    }
    for (const side of ["left", "right"] as const) {
      const n = raw.atlasFilter?.[side];
      if (Number.isInteger(n) && n >= 0 && n <= 16) result.atlasFilter[side] = n;
    }
  } catch { /* Preferences are optional when storage is unavailable. */ }
  return result;
}
/** Merge the latest stored values so independent panels cannot overwrite each other's preferences. */
export function writePreferences(patch: Partial<Preferences>, storage?: Store): void {
  try { const store = storage ?? localStorage; store.setItem(PREFERENCES_KEY, JSON.stringify({ ...readPreferences(store), ...patch })); } catch { /* Storage may be blocked or full. */ }
}
