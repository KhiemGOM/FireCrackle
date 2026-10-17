// Post-processing settings: one global object, repaired on every read so an old, newer or hand-edited file never breaks the app.
import { VEIL_MODES, type VeilMode } from "../veil";
import type { PortalManual, PortalMode } from "../portal";
import { STAGES, STAGE_IDS, clampParam, repairParams, type Params, type StageId } from "./stages";
import { DEFAULT_TONE, type ToneParams } from "./tone";

export { STAGE_IDS, DEFAULT_TONE };
export type { StageId, Params, ToneParams };
/** The portal overlay animation has 32 frames (the local 1.16.5 atlas), numbered 0 to 31. */
export const PORTAL_FRAMES = 32;
export type RowId = "veil" | "portal" | StageId;

export interface StageState { on: boolean; params: Params }

export interface PostSettings {
  /** The master switch: off shows the untouched picture while every setting below is kept. */
  enabled: boolean;
  veil: VeilMode;
  portal: PortalMode;
  /** The phase and opacity used when the portal mode is Manual. */
  portalManual: PortalManual;
  /** The user's order of the effects (veil and portal always run first). Disabled effects keep their place in it. */
  order: StageId[];
  stages: Record<StageId, StageState>;
}

export const POST_KEY = "firecrackle.post.v1";

const neutralStages = (): Record<StageId, StageState> =>
  Object.fromEntries(STAGE_IDS.map(id => [id, { on: false, params: { ...STAGES[id].defaults } }])) as Record<StageId, StageState>;

export const DEFAULT_POST: PostSettings = { enabled: true, veil: "off", portal: "off", portalManual: { phase: 0, opacity: 0.5 }, order: [...STAGE_IDS], stages: neutralStages() };

/** Every effect off with its neutral controls (what a preset starts from). */
export const neutralEffects = neutralStages;

type Store = Pick<Storage, "getItem" | "setItem">;
export interface LegacyPrefs { veilMode?: unknown; portalMode?: unknown }

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const veilOf = (v: unknown): VeilMode => (VEIL_MODES.includes(v as VeilMode) ? (v as VeilMode) : "off");
const portalOf = (v: unknown): PortalMode => (v === "auto" || v === "manual" ? v : "off");

/** A phase (whole number inside the animation) and an opacity (0 to 1), with a bad or missing one replaced by its default. */
export function repairManual(raw: unknown): PortalManual {
  const r = isObject(raw) ? raw : {};
  const phase = typeof r.phase === "number" && Number.isFinite(r.phase) ? Math.min(PORTAL_FRAMES - 1, Math.max(0, Math.round(r.phase))) : 0;
  const opacity = typeof r.opacity === "number" && Number.isFinite(r.opacity) ? Math.min(1, Math.max(0, r.opacity)) : 0.5;
  return { phase, opacity };
}

/** A tone control moved to `value`, kept inside its limits and with black always below white. */
export function clampTone(key: keyof ToneParams, value: number, params: ToneParams): ToneParams {
  return clampParam("tone", key, value, params as unknown as Params) as unknown as ToneParams;
}

export { clampParam };

export function repairPostSettings(raw: unknown, legacy?: LegacyPrefs): PostSettings {
  const r = isObject(raw) ? raw : {};
  const given = isObject(r.stages) ? r.stages : {};
  const order: StageId[] = [];
  if (Array.isArray(r.order)) for (const id of r.order) if (STAGE_IDS.includes(id as StageId) && !order.includes(id as StageId)) order.push(id as StageId);
  for (const id of STAGE_IDS) if (!order.includes(id)) order.push(id);
  const stages = {} as Record<StageId, StageState>;
  for (const id of STAGE_IDS) {
    const one = isObject(given[id]) ? (given[id] as Record<string, unknown>) : {};
    stages[id] = { on: one.on === true, params: repairParams(id, one.params) };
  }
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : true,
    veil: veilOf("veil" in r ? r.veil : legacy?.veilMode),
    portal: portalOf("portal" in r ? r.portal : legacy?.portalMode),
    portalManual: repairManual(r.portalManual),
    order,
    stages,
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

/** Is any switched-on effect doing something? (An effect left at its neutral values changes nothing.) */
export function hasActiveEffect(s: PostSettings): boolean {
  return STAGE_IDS.some(id => s.stages[id].on && !STAGES[id].isIdentity(s.stages[id].params));
}

/** Does the picture need any work at all? False means the original frame is shown as it is. */
export function needsProcessing(s: PostSettings): boolean {
  return s.enabled && (s.veil !== "off" || s.portal !== "off" || hasActiveEffect(s));
}

/** What the picture is drawn with: the settings, or nothing at all while the master switch is off. */
export function pictureSettings(s: PostSettings): PostSettings {
  return s.enabled ? s : { ...s, veil: "off", portal: "off" };
}

export function toggleEnabled(s: PostSettings): PostSettings {
  return { ...s, enabled: !s.enabled };
}

/** Only effect controls moved (a slider drag): the picture waits a moment for these, but never for a switch. */
export function onlyParamsChanged(a: PostSettings, b: PostSettings): boolean {
  const flat = (s: PostSettings) => JSON.stringify({ ...s, stages: Object.fromEntries(STAGE_IDS.map(id => [id, s.stages[id].on])) });
  const params = (s: PostSettings) => JSON.stringify(STAGE_IDS.map(id => s.stages[id].params));
  return flat(a) === flat(b) && params(a) !== params(b);
}
