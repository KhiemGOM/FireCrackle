// Sharpen: an unsharp mask on brightness only, so every channel moves together and no colour fringes appear.
import { gaussianBlur } from "./blur";

export interface SharpenParams { amount: number; radius: number; threshold: number }
export const DEFAULT_SHARPEN: SharpenParams = { amount: 0, radius: 1.5, threshold: 0 };

export function isSharpenIdentity(p: SharpenParams): boolean {
  return p.amount === 0;
}

/** A new RGBA array with edges sharpened and alpha untouched; the very same array when nothing would change. */
export function applySharpen(data: Uint8ClampedArray, width: number, height: number, p: SharpenParams): Uint8ClampedArray {
  if (data.length % 4) throw new Error("Invalid pixel buffer: not whole RGBA pixels");
  if (data.length !== width * height * 4) throw new Error("Picture size does not match its pixel count");
  if (isSharpenIdentity(p)) return data;
  const count = width * height;
  const luma = new Float32Array(count);
  for (let i = 0; i < count; i++) luma[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  const soft = gaussianBlur(luma, width, height, p.radius);
  const gain = p.amount / 100;
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < count; i++) {
    let detail = luma[i] - soft[i];
    if (Math.abs(detail) < p.threshold) detail = 0;
    const shift = detail * gain;
    const j = i * 4;
    out[j] = data[j] + shift;
    out[j + 1] = data[j + 1] + shift;
    out[j + 2] = data[j + 2] + shift;
    out[j + 3] = data[j + 3];
  }
  return out;
}
