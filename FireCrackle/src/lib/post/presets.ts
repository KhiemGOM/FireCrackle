// Presets: a starting point for common footage. A preset switches on the effects it names (with its values) and every
// other effect off; the master switch, veil, portal and the effect order are left alone.
import { neutralEffects, type PostSettings } from "./settings";
import { STAGES, STAGE_IDS, repairParams, type Params, type StageId } from "./stages";

export interface Preset { id: string; name: string; stages: Partial<Record<StageId, Params>> }

export const PRESETS: readonly Preset[] = [
  { id: "dark", name: "Dark scene", stages: { tone: { gamma: 1.6, shadows: 40, contrast: 10 } } },
  { id: "compressed", name: "Compressed footage", stages: { sharpen: { amount: 80, radius: 1, threshold: 6 }, tone: { contrast: 10 } } },
  { id: "fire", name: "Fire focus", stages: { fire: { strength: 70 }, tone: { contrast: 15 } } },
];

const statesOf = (s: PostSettings) => JSON.stringify(STAGE_IDS.map(id => s.stages[id]));

/** The settings with a preset applied; "none" clears every effect; an unknown id returns the settings untouched. */
export function applyPreset(s: PostSettings, id: string): PostSettings {
  if (id === "none") return { ...s, stages: neutralEffects() };
  const preset = PRESETS.find(p => p.id === id);
  if (!preset) return s;
  const stages = neutralEffects();
  for (const stage of STAGE_IDS) {
    const given = preset.stages[stage];
    if (given) stages[stage] = { on: true, params: repairParams(stage, { ...STAGES[stage].defaults, ...given }) };
  }
  return { ...s, stages };
}

/** Which preset the effects currently match: its id, "none" when everything is off and neutral, or "custom". */
export function presetOf(s: PostSettings): string {
  if (statesOf(s) === statesOf({ ...s, stages: neutralEffects() })) return "none";
  for (const p of PRESETS) if (statesOf(s) === statesOf(applyPreset(s, p.id))) return p.id;
  return "custom";
}
