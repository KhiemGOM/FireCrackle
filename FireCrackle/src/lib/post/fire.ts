// Fire view: a way to LOOK at a frame. Orange and yellow-orange pixels stay (a little brighter) while everything else
// is dimmed and desaturated. It is a view aid, not a detector: torches, lava, GUI pieces and orange items light up too,
// and nothing here is used to decide whether a frame has fire.

export interface FireParams { strength: number }
export const DEFAULT_FIRE: FireParams = { strength: 0 };

export function isFireIdentity(p: FireParams): boolean {
  return p.strength === 0;
}

const ramp = (x: number, from: number, to: number) => (x <= from ? 0 : x >= to ? 1 : (x - from) / (to - from));

/** How fire-coloured a colour is, from 0 to 1: hue about 12 to 52 degrees (feathered at both ends), saturated and not dark. */
export function fireWeight(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  if (max === 0 || delta === 0) return 0;
  let hue = max === r ? 60 * (((g - b) / delta) % 6) : max === g ? 60 * ((b - r) / delta + 2) : 60 * ((r - g) / delta + 4);
  if (hue < 0) hue += 360;
  return ramp(hue, 4, 12) * (1 - ramp(hue, 52, 62)) * ramp(delta / max, 0.25, 0.45) * ramp(max / 255, 0.2, 0.35);
}

/** A new RGBA array with the fire view applied and alpha untouched; the very same array at strength zero. */
export function applyFire(data: Uint8ClampedArray, p: FireParams): Uint8ClampedArray {
  if (data.length % 4) throw new Error("Invalid pixel buffer: not whole RGBA pixels");
  if (isFireIdentity(p)) return data;
  const s = p.strength / 100;
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const w = fireWeight(r, g, b);
    const dim = (0.299 * r + 0.587 * g + 0.114 * b) * 0.45;
    out[i] = r + ((w * Math.min(255, r * 1.2) + (1 - w) * dim) - r) * s;
    out[i + 1] = g + ((w * Math.min(255, g * 1.2) + (1 - w) * dim) - g) * s;
    out[i + 2] = b + ((w * Math.min(255, b * 1.2) + (1 - w) * dim) - b) * s;
    out[i + 3] = data[i + 3];
  }
  return out;
}
