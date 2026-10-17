// Deblur: Richardson-Lucy deconvolution on brightness, assuming a Gaussian blur of the chosen size. A few iterations
// recover real edge detail; many iterations, or a blur size that is not the real one, make halos (ringing) and amplify
// compression blocks. Capped at ten iterations and always kept inside 0..255.
import { gaussianBlur } from "./blur";

export interface DeblurParams { iterations: number; radius: number }
export const DEFAULT_DEBLUR: DeblurParams = { iterations: 0, radius: 1.5 };

export function isDeblurIdentity(p: DeblurParams): boolean {
  return Math.round(p.iterations) < 1;
}

export function applyDeblur(data: Uint8ClampedArray, width: number, height: number, p: DeblurParams): Uint8ClampedArray {
  if (data.length % 4) throw new Error("Invalid pixel buffer: not whole RGBA pixels");
  if (data.length !== width * height * 4) throw new Error("Picture size does not match its pixel count");
  if (isDeblurIdentity(p)) return data;
  const count = width * height;
  const luma = new Float32Array(count);
  for (let i = 0; i < count; i++) luma[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  // work on brightness + 1 so the ratio below never divides by zero
  const observed = luma.map(v => v + 1);
  let estimate = Float32Array.from(observed);
  const ratio = new Float32Array(count);
  for (let k = 0, n = Math.min(10, Math.round(p.iterations)); k < n; k++) {
    const blurred = gaussianBlur(estimate, width, height, p.radius);
    for (let i = 0; i < count; i++) ratio[i] = observed[i] / Math.max(blurred[i], 1e-3);
    const correction = gaussianBlur(ratio, width, height, p.radius);
    const next = new Float32Array(count);
    for (let i = 0; i < count; i++) next[i] = Math.min(256, Math.max(1, estimate[i] * correction[i]));
    estimate = next;
  }
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < count; i++) {
    const shift = estimate[i] - observed[i];
    const j = i * 4;
    out[j] = data[j] + shift;
    out[j + 1] = data[j + 1] + shift;
    out[j + 2] = data[j + 2] + shift;
    out[j + 3] = data[j + 3];
  }
  return out;
}
