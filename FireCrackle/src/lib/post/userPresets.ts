// The presets the user saves: a small list kept in the browser's storage, repaired on every read.
import { PRESETS, presetFromSettings, type Preset } from "./presets";
import { STAGE_IDS, repairParams, type StageId } from "./stages";
import type { PostSettings } from "./settings";

export const USER_PRESETS_KEY = "firecrackle.post.presets.v1";
export const MAX_USER_PRESETS = 12;
export const MAX_PRESET_NAME = 24;

type Store = Pick<Storage, "getItem" | "setItem">;
const RESERVED = new Set<string>(["none", "custom", ...PRESETS.map(p => p.id)]);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const cleanName = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, MAX_PRESET_NAME).trim() : "");

/** Valid presets only: a usable id and name, known effects with their values brought inside their limits. */
export function repairUserPresets(raw: unknown): Preset[] {
  if (!Array.isArray(raw)) return [];
  const out: Preset[] = [];
  const ids = new Set<string>();
  for (const item of raw) {
    if (!isObject(item) || typeof item.id !== "string" || !item.id || RESERVED.has(item.id) || ids.has(item.id)) continue;
    const name = cleanName(item.name);
    if (!name) continue;
    const given = isObject(item.stages) ? item.stages : {};
    const stages: Preset["stages"] = {};
    for (const stage of STAGE_IDS) if (stage in given) stages[stage] = repairParams(stage, given[stage]);
    ids.add(item.id);
    out.push({ id: item.id, name, stages });
    if (out.length === MAX_USER_PRESETS) break;
  }
  return out;
}

export function readUserPresets(storage?: Pick<Store, "getItem">): Preset[] {
  try {
    const text = (storage ?? localStorage).getItem(USER_PRESETS_KEY);
    return text === null ? [] : repairUserPresets(JSON.parse(text));
  } catch {
    return [];
  }
}

export function writeUserPresets(list: readonly Preset[], storage?: Pick<Store, "setItem">): void {
  try { (storage ?? localStorage).setItem(USER_PRESETS_KEY, JSON.stringify(list)); } catch { /* Storage may be blocked or full. */ }
}

/**
 * Saves the effects that are on as a named preset. A blank name, nothing switched on, or a full list (for a new name)
 * returns the list as it was. The same name (any letter case) replaces that preset in place.
 */
export function addUserPreset(list: readonly Preset[], name: string, settings: PostSettings): Preset[] {
  const clean = cleanName(name);
  const anyOn = STAGE_IDS.some((id: StageId) => settings.stages[id].on);
  if (!clean || !anyOn) return list as Preset[];
  const at = list.findIndex(p => p.name.toLowerCase() === clean.toLowerCase());
  if (at < 0 && list.length >= MAX_USER_PRESETS) return list as Preset[];
  if (at >= 0) {
    const next = [...list];
    next[at] = { ...presetFromSettings(settings, list[at].id, list[at].name), name: list[at].name };
    return next;
  }
  const taken = new Set([...list.map(p => p.id), ...RESERVED]);
  let n = 1;
  while (taken.has(`user-${n}`)) n++;
  return [...list, presetFromSettings(settings, `user-${n}`, clean)];
}

export function removeUserPreset(list: readonly Preset[], id: string): Preset[] {
  return list.filter(p => p.id !== id);
}
