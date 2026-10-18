// Presets: a starting point for common footage. A preset switches on the effects it names (with its values) and every
// other effect off; the master switch, veil, portal and the effect order are left alone.
// Inspection goals: levels/gamma https://blog.ampedsoftware.com/2023/10/10/enhance-a-backlit-scene
// and Find Edges https://helpx.adobe.com/after-effects/desktop/apply-effects-and-animation-presets/list-of-effects/stylize-effects.html
// Values are adjustable starting points for this app, not settings prescribed by those sources.
import { neutralEffects, type PostSettings } from "./settings";
import { STAGES, STAGE_IDS, repairParams, type Params, type StageId } from "./stages";

export interface Preset { id: string; name: string; help?: string; stages: Partial<Record<StageId, Params>> }

export const PRESETS: readonly Preset[] = [
  { id: "high-contrast", name: "High contrast", help: "Strong contrast with Gamma 3 to lift dark detail. Deliberately clips highlights; adjust Gamma for your scene.", stages: { tone: { contrast: 200, gamma: 3, black: 0, white: 255 } } },
  { id: "find-edges", name: "Find edges", help: "White outlines on black, including colour-only boundaries. Adjust Sensitivity and Noise cutoff in Edge detection.", stages: { edges: { mode: 0, channel: 1, gain: 4, threshold: 4, amount: 100 } } },
  { id: "dark", name: "Dark scene", help: "Strong shadow recovery and midtone brightening, with noise smoothing. Raise Gamma further for very dark scenes.", stages: { tone: { gamma: 3.5, shadows: 85 }, denoise: { strength: 60, radius: 2 } } },
  { id: "fire", name: "Fire focus", help: "Full orange isolation: strongly dim and desaturate surroundings. Lava and other orange objects also stay bright.", stages: { fire: { strength: 100 } } },
  { id: "edges", name: "Texture detail", help: "Aggressive sharpening and contrast for texel boundaries. Halos and compression blocks become visible too; compare with V.", stages: { sharpen: { amount: 500, radius: 1.2, threshold: 0 }, tone: { contrast: 60, gamma: 1.4 } } },
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
