// View-only Scharr gradients: https://docs.opencv.org/4.x/d2/d2c/tutorial_sobel_derivatives.html
// Like an editor's Find Edges view, this emphasizes existing transitions; it does not reconstruct detail.
export interface EdgeParams { amount: number; gain: number; threshold: number; mode: number; channel: number }
export const DEFAULT_EDGES: EdgeParams = { amount: 100, gain: 4, threshold: 4, mode: 0, channel: 1 };
export const isEdgesIdentity = (p: EdgeParams) => p.amount === 0;

/** mode: white edges, black edges, or cyan overlay. channel: brightness or strongest RGB gradient. */
export function applyEdges(data: Uint8ClampedArray, width: number, height: number, p: EdgeParams): Uint8ClampedArray {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 0 || height < 0 || data.length !== width * height * 4) throw new Error("Picture size does not match its pixel count");
  if (isEdgesIdentity(p) || data.length === 0) return data;
  let source: Uint8ClampedArray | Float32Array = data;
  let stride = 4, channels = 3;
  if (p.channel === 0) {
    source = new Float32Array(width * height);
    for (let i = 0; i < source.length; i++) source[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    stride = 1; channels = 1;
  }
  const out = new Uint8ClampedArray(data.length), opacity = p.amount / 100;
  for (let y = 0; y < height; y++) {
    const top = Math.max(0, y - 1) * width * stride, mid = y * width * stride, bottom = Math.min(height - 1, y + 1) * width * stride;
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - 1) * stride, center = x * stride, right = Math.min(width - 1, x + 1) * stride;
      let squared = 0;
      for (let c = 0; c < channels; c++) {
        const gx = 3 * (source[top + right + c] - source[top + left + c]) + 10 * (source[mid + right + c] - source[mid + left + c]) + 3 * (source[bottom + right + c] - source[bottom + left + c]);
        const gy = 3 * (source[bottom + left + c] - source[top + left + c]) + 10 * (source[bottom + center + c] - source[top + center + c]) + 3 * (source[bottom + right + c] - source[top + right + c]);
        squared = Math.max(squared, gx * gx + gy * gy);
      }
      // A straight intensity step of N has gradient N after dividing Scharr's positive weights by 16.
      const edge = Math.min(255, Math.max(0, (Math.sqrt(squared) / 16 - p.threshold) * p.gain));
      const i = (y * width + x) * 4;
      if (p.mode === 2) {
        const a = opacity * edge / 255;
        out[i] = data[i] * (1 - a);
        out[i + 1] = data[i + 1] * (1 - a) + 255 * a;
        out[i + 2] = data[i + 2] * (1 - a) + 200 * a;
      } else {
        const value = p.mode === 1 ? 255 - edge : edge;
        for (let c = 0; c < 3; c++) out[i + c] = data[i + c] * (1 - opacity) + value * opacity;
      }
      out[i + 3] = data[i + 3];
    }
  }
  return out;
}
