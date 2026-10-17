// The effects, described once: name, neutral values, the controls to show for them, how to tell they change nothing and
// how to apply them. Settings, the pipeline, presets and the panel all read this table, so a new effect is added here.
import { DEFAULT_TONE, applyTone, isToneIdentity, type ToneParams } from "./tone";
import { DEFAULT_SHARPEN, applySharpen, isSharpenIdentity, type SharpenParams } from "./sharpen";
import { DEFAULT_DENOISE, applyDenoise, isDenoiseIdentity, type DenoiseParams } from "./denoise";
import { DEFAULT_DEBLUR, applyDeblur, isDeblurIdentity, type DeblurParams } from "./deblur";
import { DEFAULT_FIRE, applyFire, isFireIdentity, type FireParams } from "./fire";
import { CHANNEL_MODES, DEFAULT_CHANNELS, applyChannels, isChannelsIdentity, type ChannelsParams } from "./channels";

export type StageId = "tone" | "denoise" | "deblur" | "sharpen" | "fire" | "channels";
export const STAGE_IDS: StageId[] = ["tone", "denoise", "deblur", "sharpen", "fire", "channels"];
export type Params = Record<string, number>;

export interface Control {
  key: string;
  label: string;
  kind: "range" | "choice";
  min: number;
  max: number;
  step: number;
  options?: ReadonlyArray<{ value: number; label: string }>;
}

export interface StageSpec {
  id: StageId;
  name: string;
  /** One sentence shown under the controls. */
  help?: string;
  defaults: Params;
  controls: readonly Control[];
  isIdentity(p: Params): boolean;
  apply(data: Uint8ClampedArray, width: number, height: number, p: Params): Uint8ClampedArray;
  /** Rules that tie controls together, applied to a whole set of values (black must stay below white). */
  repair?(p: Params): Params;
  /** The same rules applied when one control is moved. */
  constrain?(key: string, value: number, p: Params): Params;
}

const range = (key: string, label: string, min: number, max: number, step: number): Control => ({ key, label, kind: "range", min, max, step });

export const STAGES: Record<StageId, StageSpec> = {
  tone: {
    id: "tone", name: "Tone", defaults: { ...DEFAULT_TONE },
    controls: [range("gamma", "Gamma", 0.3, 3, 0.05), range("black", "Black point", 0, 254, 1), range("white", "White point", 1, 255, 1), range("contrast", "Contrast", -100, 100, 1), range("shadows", "Shadow lift", 0, 100, 1)],
    isIdentity: p => isToneIdentity(p as unknown as ToneParams),
    apply: (d, _w, _h, p) => applyTone(d, p as unknown as ToneParams),
    repair: p => (p.black >= p.white ? { ...p, black: DEFAULT_TONE.black, white: DEFAULT_TONE.white } : p),
    constrain: (key, value, p) => ({ ...p, [key]: key === "black" ? Math.min(value, p.white - 1) : key === "white" ? Math.max(value, p.black + 1) : value }),
  },
  denoise: {
    id: "denoise", name: "Denoise", defaults: { ...DEFAULT_DENOISE },
    help: "Calms compression noise while keeping strong edges. A bigger radius smooths more and costs more time.",
    controls: [range("strength", "Strength", 0, 100, 1), range("radius", "Radius", 1, 3, 1)],
    isIdentity: p => isDenoiseIdentity(p as unknown as DenoiseParams),
    apply: (d, w, h, p) => applyDenoise(d, w, h, p as unknown as DenoiseParams),
  },
  deblur: {
    id: "deblur", name: "Deblur", defaults: { ...DEFAULT_DEBLUR },
    help: "Assumes a Gaussian blur of the chosen size. Keep the iterations low: it can ring (halos) and sharpen compression blocks.",
    controls: [range("iterations", "Iterations", 0, 10, 1), range("radius", "Blur size", 0.5, 3, 0.1)],
    isIdentity: p => isDeblurIdentity(p as unknown as DeblurParams),
    apply: (d, w, h, p) => applyDeblur(d, w, h, p as unknown as DeblurParams),
  },
  sharpen: {
    id: "sharpen", name: "Sharpen", defaults: { ...DEFAULT_SHARPEN },
    help: "Sharpens brightness only, so colours do not fringe. JPEG blocks get sharper too: keep it gentle on compressed footage.",
    controls: [range("amount", "Amount", 0, 300, 5), range("radius", "Radius", 0.5, 5, 0.1), range("threshold", "Threshold", 0, 50, 1)],
    isIdentity: p => isSharpenIdentity(p as unknown as SharpenParams),
    apply: (d, w, h, p) => applySharpen(d, w, h, p as unknown as SharpenParams),
  },
  fire: {
    id: "fire", name: "Fire view", defaults: { ...DEFAULT_FIRE },
    help: "A view aid, not a detector: orange things (torches, lava, GUI pieces) also stay bright. It never feeds detection.",
    controls: [range("strength", "Strength", 0, 100, 1)],
    isIdentity: p => isFireIdentity(p as unknown as FireParams),
    apply: (d, _w, _h, p) => applyFire(d, p as unknown as FireParams),
  },
  channels: {
    id: "channels", name: "Channels", defaults: { ...DEFAULT_CHANNELS },
    controls: [{ key: "mode", label: "Channel", kind: "choice", min: 0, max: CHANNEL_MODES.length - 1, step: 1, options: CHANNEL_MODES }],
    isIdentity: p => isChannelsIdentity(p as unknown as ChannelsParams),
    apply: (d, _w, _h, p) => applyChannels(d, p as unknown as ChannelsParams),
  },
};

/** A set of control values made valid: numbers inside their limits, choices from the list, cross-control rules applied. */
export function repairParams(id: StageId, raw: unknown): Params {
  const spec = STAGES[id];
  const given = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  let out: Params = { ...spec.defaults };
  for (const c of spec.controls) {
    const v = given[c.key];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    if (c.kind === "choice") { if (c.options?.some(o => o.value === v)) out[c.key] = v; }
    else out[c.key] = Math.min(c.max, Math.max(c.min, v));
  }
  if (spec.repair) out = spec.repair(out);
  return out;
}

/** One control moved to `value`: clamped to its limits (or ignored when a choice is not on the list), rules applied. */
export function clampParam(id: StageId, key: string, value: number, params: Params): Params {
  const spec = STAGES[id];
  const control = spec.controls.find(c => c.key === key);
  if (!control || !Number.isFinite(value)) return params;
  if (control.kind === "choice") return control.options?.some(o => o.value === value) ? { ...params, [key]: value } : params;
  const v = Math.min(control.max, Math.max(control.min, value));
  return spec.constrain ? spec.constrain(key, v, params) : { ...params, [key]: v };
}
