import type { EdgeFilter } from "./atlasFilter";
import { VEIL_MODES, type VeilMode } from "./veil";
import type { PortalMode } from "./portal";

export interface Preferences {
  tab: "label" | "phase" | "misc" | "images";
  atlasFilter: EdgeFilter;
  matchOpen: boolean;
  matchOnlyFiltered: boolean;
  matchAdjustQuad: boolean;
  animationOpen: boolean;
  animationOnlyFiltered: boolean;
  animationDelayMs: number;
  /** Undo the GUI veil on shown pictures: never, when detected, or always. */
  veilMode: VeilMode;
  portalMode: PortalMode;
  miscTool: "compare" | "gui" | "fire3d";
  miscCompareMode: "original" | "diff" | "blink";
  miscDifferenceGain: number;
  miscGuiMode: "intervals" | "aim";
  miscGuiDisplay: "blink" | "before" | "after";
  miscGuiOrder: "motion" | "time";
  miscGuiMenus: boolean;
  /** Post effects on the frame comparison (lib/comparisonPost.ts). */
  miscComparePost: { veil: boolean; portal: boolean; enhance: boolean; blink: boolean };
  /** Which two frames the aim gallery shows: around the GUI, or at the cut where it opens or closes. */
  miscGuiPair: "around" | "open" | "close";
}
export const PREFERENCES_KEY = "firecrackle.preferences.v1";
export const DEFAULT_PREFERENCES: Preferences = { tab: "label", atlasFilter: { left: null, right: null }, matchOpen: false, matchOnlyFiltered: true, matchAdjustQuad: true, animationOpen: false, animationOnlyFiltered: true, animationDelayMs: 250, veilMode: "off", portalMode: "off", miscTool:"compare", miscCompareMode:"original", miscDifferenceGain:3, miscGuiMode:"aim", miscGuiDisplay:"blink", miscGuiOrder:"motion", miscGuiMenus:false, miscComparePost:{ veil:false, portal:false, enhance:false, blink:false }, miscGuiPair:"around" };
type Store = Pick<Storage, "getItem" | "setItem">;
export function readPreferences(storage?: Pick<Store, "getItem">): Preferences {
  const result = { ...DEFAULT_PREFERENCES, atlasFilter: { ...DEFAULT_PREFERENCES.atlasFilter }, miscComparePost: { ...DEFAULT_PREFERENCES.miscComparePost } };
  try {
    const raw = JSON.parse((storage ?? localStorage).getItem(PREFERENCES_KEY) ?? "null");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
    if (raw.tab === "label" || raw.tab === "phase" || raw.tab === "misc" || raw.tab === "images") result.tab = raw.tab;
    for (const key of ["matchOpen", "matchOnlyFiltered", "matchAdjustQuad", "animationOpen", "animationOnlyFiltered"] as const) if (typeof raw[key] === "boolean") result[key] = raw[key];
    if (VEIL_MODES.includes(raw.veilMode)) result.veilMode = raw.veilMode;
    if (raw.portalMode === "off" || raw.portalMode === "auto") result.portalMode = raw.portalMode;
    if (raw.miscTool === "compare" || raw.miscTool === "gui" || raw.miscTool === "fire3d") result.miscTool = raw.miscTool;
    if (["original","diff","blink"].includes(raw.miscCompareMode)) result.miscCompareMode = raw.miscCompareMode;
    if (Number.isInteger(raw.miscDifferenceGain) && raw.miscDifferenceGain >= 1 && raw.miscDifferenceGain <= 8) result.miscDifferenceGain = raw.miscDifferenceGain;
    if (raw.miscGuiMode === "intervals" || raw.miscGuiMode === "aim") result.miscGuiMode = raw.miscGuiMode;
    if (["blink","before","after"].includes(raw.miscGuiDisplay)) result.miscGuiDisplay = raw.miscGuiDisplay;
    if (raw.miscGuiOrder === "motion" || raw.miscGuiOrder === "time") result.miscGuiOrder = raw.miscGuiOrder;
    if (typeof raw.miscGuiMenus === "boolean") result.miscGuiMenus = raw.miscGuiMenus;
    for (const key of ["veil", "portal", "enhance", "blink"] as const) if (typeof raw.miscComparePost?.[key] === "boolean") result.miscComparePost[key] = raw.miscComparePost[key];
    if (["around", "open", "close"].includes(raw.miscGuiPair)) result.miscGuiPair = raw.miscGuiPair;
    if (Number.isInteger(raw.animationDelayMs) && raw.animationDelayMs >= 30 && raw.animationDelayMs <= 10000) result.animationDelayMs = raw.animationDelayMs;
    if (Array.isArray(raw.atlasFilter?.excluded)) {
      const excluded = [...new Set<number>(raw.atlasFilter.excluded.filter((n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 128))];
      if (excluded.length) result.atlasFilter.excluded = excluded;
    }
    for (const side of ["left", "right", "bottomWhiteMin", "bottomWhiteMax"] as const) {
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
