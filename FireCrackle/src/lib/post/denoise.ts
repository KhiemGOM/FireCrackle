// Denoise: an edge-keeping smoothing (a bilateral filter). Neighbours count less the more their brightness differs, so flat
// areas and compression noise calm down while strong edges stay put. Red, green and blue share the same weights.

export interface DenoiseParams { strength: number; radius: number }
export const DEFAULT_DENOISE: DenoiseParams = { strength: 0, radius: 1 };

export function isDenoiseIdentity(p: DenoiseParams): boolean {
  return p.strength === 0;
}

export function applyDenoise(data: Uint8ClampedArray, width: number, height: number, p: DenoiseParams): Uint8ClampedArray {
  if (data.length % 4) throw new Error("Invalid pixel buffer: not whole RGBA pixels");
  if (data.length !== width * height * 4) throw new Error("Picture size does not match its pixel count");
  if (isDenoiseIdentity(p)) return data;
  const radius = Math.max(1, Math.round(p.radius));
  const sigmaRange = 0.6 * p.strength;
  const range = new Float32Array(256);
  for (let d = 0; d < 256; d++) range[d] = Math.exp(-(d * d) / (2 * sigmaRange * sigmaRange));
  const sigmaSpace = radius / 1.5;
  const size = 2 * radius + 1;
  const space = new Float32Array(size * size);
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) space[(dy + radius) * size + dx + radius] = Math.exp(-(dx * dx + dy * dy) / (2 * sigmaSpace * sigmaSpace));
  const count = width * height;
  const luma = new Uint8Array(count);
  for (let i = 0; i < count; i++) luma[i] = Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]);
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x, centre = luma[i];
      let sum = 0, r = 0, g = 0, b = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const j = yy * width + xx;
          const w = space[(dy + radius) * size + dx + radius] * range[Math.abs(luma[j] - centre)];
          sum += w;
          r += w * data[j * 4];
          g += w * data[j * 4 + 1];
          b += w * data[j * 4 + 2];
        }
      }
      const o = i * 4;
      out[o] = r / sum;
      out[o + 1] = g / sum;
      out[o + 2] = b / sum;
      out[o + 3] = data[o + 3];
    }
  }
  return out;
}
