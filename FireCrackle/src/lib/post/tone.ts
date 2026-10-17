// Tone: levels, shadow lift, gamma and contrast folded into one 256-entry table, applied to red, green and blue only.

export interface ToneParams { gamma: number; black: number; white: number; contrast: number; shadows: number }
export const DEFAULT_TONE: ToneParams = { gamma: 1, black: 0, white: 255, contrast: 0, shadows: 0 };

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function isToneIdentity(p: ToneParams): boolean {
  return p.gamma === 1 && p.black === 0 && p.white === 255 && p.contrast === 0 && p.shadows === 0;
}

/** Order: black/white points, shadow lift, gamma, contrast. Each step never goes backwards, so neither does the table. */
export function buildToneLut(p: ToneParams): Uint8Array {
  const lut = new Uint8Array(256);
  const black = p.black / 255, span = p.white / 255 - black;
  const lift = p.shadows / 100;
  const contrast = p.contrast >= 0 ? 1 + p.contrast / 50 : 1 + p.contrast / 100;
  for (let i = 0; i < 256; i++) {
    let v = i / 255;
    if (p.black !== 0 || p.white !== 255) v = clamp01((v - black) / span);
    if (lift > 0) v += 2 * lift * v * (1 - v) * (1 - v);
    if (p.gamma !== 1) v = Math.pow(v, 1 / p.gamma);
    if (p.contrast !== 0) v = clamp01((v - 0.5) * contrast + 0.5);
    lut[i] = Math.round(clamp01(v) * 255);
  }
  return lut;
}

/** A new RGBA array with tone applied and alpha untouched; the very same array when nothing would change. */
export function applyTone(data: Uint8ClampedArray, p: ToneParams): Uint8ClampedArray {
  if (data.length % 4) throw new Error("Invalid pixel buffer: not whole RGBA pixels");
  if (isToneIdentity(p)) return data;
  const lut = buildToneLut(p);
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    out[i] = lut[data[i]];
    out[i + 1] = lut[data[i + 1]];
    out[i + 2] = lut[data[i + 2]];
    out[i + 3] = data[i + 3];
  }
  return out;
}
