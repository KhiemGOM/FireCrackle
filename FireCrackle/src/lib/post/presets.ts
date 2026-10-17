// Presets: a starting point for common footage. A preset switches on the effects it names (with its values) and every
// other effect off; the master switch, veil, portal and the effect order are left alone. The built-in values were tuned
// by eye on real recordings (dark Nether, daylight, large first-person fire, smoke); you can save your own as well.
import { neutralEffects, type PostSettings } from "./settings";
import { STAGES, STAGE_IDS, repairParams, type Params, type StageId } from "./stages";

export interface Preset { id: string; name: string; stages: Partial<Record<StageId, Params>> }

export const PRESETS: readonly Preset[] = [
  // brightens dark scenes, then calms the noise that brightening brings out
  { id: "dark", name: "Dark scene", stages: { tone: { gamma: 1.9, shadows: 50, black: 6, contrast: 12 }, denoise: { strength: 20, radius: 1 } } },
  // cleans blocky noise first, then sharpens gently; no tone change (a contrast step crushed dark frames)
  { id: "compressed", name: "Compressed footage", stages: { denoise: { strength: 30, radius: 1 }, sharpen: { amount: 60, radius: 1.2, threshold: 4 } } },
  // fire-coloured pixels stay bright; the surroundings dim but stay visible
  { id: "fire", name: "Fire focus", stages: { fire: { strength: 55 }, tone: { gamma: 1.25, shadows: 15 } } },
  // crisp texel boundaries, for judging a sprite or a quad
  { id: "edges", name: "Texture edges", stages: { sharpen: { amount: 150, radius: 0.8, threshold: 2 }, tone: { contrast: 12 } } },
  // a little deblur for soft footage; few iterations, because more makes halos
  { id: "soft", name: "Soft footage", stages: { deblur: { iterations: 3, radius: 1.2 }, sharpen: { amount: 40, radius: 1, threshold: 3 } } },
];

const statesOf = (s: PostSettings) => JSON.stringify(STAGE_IDS.map(id => s.stages[id]));

/** The built-in presets followed by the user's own. */
export const allPresets = (user: readonly Preset[] = []): Preset[] => [...PRESETS, ...user];

/** The effects that are on, as a preset (what "save current as preset" stores). */
export function presetFromSettings(s: PostSettings, id: string, name: string): Preset {
  const stages: Preset["stages"] = {};
  for (const stage of STAGE_IDS) if (s.stages[stage].on) stages[stage] = { ...s.stages[stage].params };
  return { id, name, stages };
}

/** The settings with a preset applied; "none" clears every effect; an unknown id returns the settings untouched. */
export function applyPreset(s: PostSettings, id: string, user: readonly Preset[] = []): PostSettings {
  if (id === "none") return { ...s, stages: neutralEffects() };
  const preset = allPresets(user).find(p => p.id === id);
  if (!preset) return s;
  const stages = neutralEffects();
  for (const stage of STAGE_IDS) {
    const given = preset.stages[stage];
    if (given) stages[stage] = { on: true, params: repairParams(stage, { ...STAGES[stage].defaults, ...given }) };
  }
  return { ...s, stages };
}

/** Which preset the effects currently match: its id, "none" when everything is off and neutral, or "custom". */
export function presetOf(s: PostSettings, user: readonly Preset[] = []): string {
  if (statesOf(s) === statesOf({ ...s, stages: neutralEffects() })) return "none";
  for (const p of allPresets(user)) if (statesOf(s) === statesOf(applyPreset(s, p.id, user))) return p.id;
  return "custom";
}
