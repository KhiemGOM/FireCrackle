// Post-processing settings: one global object, repaired on every read so an old, newer or hand-edited file never breaks the app.
import { VEIL_MODES, type VeilMode } from "../veil";
import { isToneIdentity } from "./tone";

export type StageId = "tone";
export type RowId = "veil" | "portal" | StageId;
export const STAGE_IDS: StageId[] = ["tone"];

export interface ToneParams { gamma: number; black: number; white: number; contrast: number; shadows: number }
export const DEFAULT_TONE: ToneParams = { gamma: 1, black: 0, white: 255, contrast: 0, shadows: 0 };
export const TONE_LIMITS: Record<keyof ToneParams, readonly [number, number]> = {
  gamma: [0.3, 3], black: [0, 254], white: [1, 255], contrast: [-100, 100], shadows: [0, 100],
};

export interface PostSettings {
  /** The master switch: off shows the untouched picture while every setting below is kept. */
  enabled: boolean;
  veil: VeilMode;
  portal: "off" | "auto";
  /** The user's order of the effects (veil and portal always run first). Disabled effects keep their place in it. */
  order: StageId[];
  stages: { tone: { on: boolean; params: ToneParams } };
}

export const POST_KEY = "firecrackle.post.v1";
export const DEFAULT_POST: PostSettings = {
  enabled: true, veil: "off", portal: "off", order: ["tone"], stages: { tone: { on: false, params: { ...DEFAULT_TONE } } },
};

type Store = Pick<Storage, "getItem" | "setItem">;
export interface LegacyPrefs { veilMode?: unknown; portalMode?: unknown }

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const veilOf = (v: unknown): VeilMode => (VEIL_MODES.includes(v as VeilMode) ? (v as VeilMode) : "off");
const portalOf = (v: unknown): "off" | "auto" => (v === "auto" ? "auto" : "off");

/** A tone control moved to `value`, kept inside its limits and with black always below white. */
export function clampTone(key: keyof ToneParams, value: number, params: ToneParams): ToneParams {
  const [lo, hi] = TONE_LIMITS[key];
  let v = Math.min(hi, Math.max(lo, value));
  if (key === "black") v = Math.min(v, params.white - 1);
  if (key === "white") v = Math.max(v, params.black + 1);
  return { ...params, [key]: v };
}

function repairTone(raw: unknown): ToneParams {
  const r = isObject(raw) ? raw : {};
  const out = { ...DEFAULT_TONE };
  for (const key of Object.keys(DEFAULT_TONE) as Array<keyof ToneParams>) {
    const v = r[key];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = Math.min(TONE_LIMITS[key][1], Math.max(TONE_LIMITS[key][0], v));
  }
  if (out.black >= out.white) { out.black = DEFAULT_TONE.black; out.white = DEFAULT_TONE.white; }
  return out;
}

export function repairPostSettings(raw: unknown, legacy?: LegacyPrefs): PostSettings {
  const r = isObject(raw) ? raw : {};
  const tone = isObject(r.stages) && isObject(r.stages.tone) ? r.stages.tone : {};
  const order: StageId[] = [];
  if (Array.isArray(r.order)) for (const id of r.order) if (STAGE_IDS.includes(id as StageId) && !order.includes(id as StageId)) order.push(id as StageId);
  for (const id of STAGE_IDS) if (!order.includes(id)) order.push(id);
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : true,
    veil: veilOf("veil" in r ? r.veil : legacy?.veilMode),
    portal: portalOf("portal" in r ? r.portal : legacy?.portalMode),
    order,
    stages: { tone: { on: tone.on === true, params: repairTone(tone.params) } },
  };
}

/** Saved settings; with nothing saved yet, the old Veil and Portal preferences seed the new ones once. */
export function readPostSettings(storage?: Pick<Store, "getItem">, legacy?: LegacyPrefs): PostSettings {
  try {
    const text = (storage ?? localStorage).getItem(POST_KEY);
    if (text === null) return repairPostSettings(null, legacy);
    const raw = JSON.parse(text);
    return isObject(raw) ? repairPostSettings(raw) : repairPostSettings(null);
  } catch {
    return repairPostSettings(null);
  }
}

export function writePostSettings(settings: PostSettings, storage?: Store): void {
  try { (storage ?? localStorage).setItem(POST_KEY, JSON.stringify(settings)); } catch { /* Storage may be blocked or full. */ }
}

/** Does the picture need any work at all? False means the original frame is shown as it is. */
export function needsProcessing(s: PostSettings): boolean {
  return s.enabled && (s.veil !== "off" || s.portal !== "off" || (s.stages.tone.on && !isToneIdentity(s.stages.tone.params)));
}

/** What the picture is drawn with: the settings, or nothing at all while the master switch is off. */
export function pictureSettings(s: PostSettings): PostSettings {
  return s.enabled ? s : { ...s, veil: "off", portal: "off" };
}

export function toggleEnabled(s: PostSettings): PostSettings {
  return { ...s, enabled: !s.enabled };
}

/** Only tone controls moved (a slider drag): the picture waits a moment for these, but never for a switch. */
export function onlyToneParamsChanged(a: PostSettings, b: PostSettings): boolean {
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  return a.enabled === b.enabled && a.veil === b.veil && a.portal === b.portal && same(a.order, b.order)
    && a.stages.tone.on === b.stages.tone.on && !same(a.stages.tone.params, b.stages.tone.params);
}
