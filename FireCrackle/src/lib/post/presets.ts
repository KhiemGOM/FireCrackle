// Presets: a starting point for common footage. A preset switches on the effects it names (with its values) and every
// other effect off; the master switch, veil, portal and the effect order are left alone.
// Inspection goals: levels/gamma https://blog.ampedsoftware.com/2023/10/10/enhance-a-backlit-scene
// and Find Edges https://helpx.adobe.com/after-effects/desktop/apply-effects-and-animation-presets/list-of-effects/stylize-effects.html
// Values are adjustable starting points for this app, not settings prescribed by those sources.
import { neutralEffects, type PostSettings } from "./settings";
import { STAGES, STAGE_IDS, repairParams, type Params, type StageId } from "./stages";

export interface Preset { id: string; name: string; help?: string; stages: Partial<Record<StageId, Params>> }

export const PRESETS: readonly Preset[] = [
  { id: "high-contrast", name: "High contrast", help: "Strong light/dark separation for faint boundaries. Deliberately clips shadows and highlights; adjust Contrast & levels for your scene.", stages: { tone: { contrast: 200, black: 12, white: 243 } } },
  { id: "find-edges", name: "Find edges", help: "White outlines on black, including colour-only boundaries. Adjust Sensitivity and Noise cutoff in Edge detection.", stages: { edges: { mode: 0, channel: 1, gain: 4, threshold: 4, amount: 100 } } },
  { id: "edge-overlay", name: "Edge overlay", help: "Cyan outlines over the picture, keeping the scene visible. Adjust Edge detection to expose weaker boundaries or suppress noise.", stages: { edges: { mode: 2, channel: 1, gain: 4, threshold: 6, amount: 100 } } },
  // brightens dark scenes, then calms the noise that brightening brings out
  { id: "dark", name: "Dark scene", help: "Lift shadow and midtone detail without pushing contrast hard, then calm the noise that brightening exposes.", stages: { tone: { gamma: 1.9, shadows: 50, black: 6, contrast: 12 }, denoise: { strength: 20, radius: 1 } } },
  // cleans blocky noise first, then sharpens gently; no tone change (a contrast step crushed dark frames)
  { id: "compressed", name: "Compressed footage", help: "Calm compression noise and sharpen gently. Strong contrast or sharpening can exaggerate video blocks.", stages: { denoise: { strength: 30, radius: 1 }, sharpen: { amount: 60, radius: 1.2, threshold: 4 } } },
  // fire-coloured pixels stay bright; the surroundings dim but stay visible
  { id: "fire", name: "Fire focus", help: "Keep orange regions bright and dim the surroundings for comparison. Lava and other orange objects also remain bright.", stages: { fire: { strength: 55 }, tone: { gamma: 1.25, shadows: 15 } } },
  // crisp texel boundaries, for judging a sprite or a quad
  { id: "edges", name: "Texture detail", help: "Sharpen fine texel boundaries while retaining the original colours. For an actual outline map, use Find edges.", stages: { sharpen: { amount: 150, radius: 0.8, threshold: 2 }, tone: { contrast: 12 } } },
  // a little deblur for soft footage; few iterations, because more makes halos
  { id: "soft", name: "Soft footage", help: "A few deblur iterations followed by gentle sharpening. Reduce these if bright or dark halos appear.", stages: { deblur: { iterations: 3, radius: 1.2 }, sharpen: { amount: 40, radius: 1, threshold: 3 } } },
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
