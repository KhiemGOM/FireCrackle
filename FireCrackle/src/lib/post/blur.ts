// A Gaussian blur made of three box blurs (running sums, so the cost does not grow with the radius).
// Edges repeat the nearest pixel. Pure: no frame, backend or detector access.

/** Box sizes (odd) whose three passes approximate a Gaussian of the given sigma. */
function boxSizes(sigma: number): number[] {
  const n = 3;
  const ideal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let low = Math.floor(ideal);
  if (low % 2 === 0) low--;
  if (low < 1) low = 1;
  const high = low + 2;
  const m = Math.round((12 * sigma * sigma - n * low * low - 4 * n * low - 3 * n) / (-4 * low - 4));
  return Array.from({ length: n }, (_, i) => (i < m ? low : high));
}

/** One box pass along lines: `count` lines of `length` samples, `step` apart within a line, `lineStep` between lines. */
function boxPass(src: Float32Array, dst: Float32Array, length: number, step: number, count: number, lineStep: number, radius: number): void {
  if (radius === 0) { dst.set(src); return; }
  const size = 2 * radius + 1;
  const last = length - 1;
  for (let line = 0; line < count; line++) {
    const base = line * lineStep;
    let acc = 0;
    for (let k = -radius; k <= radius; k++) acc += src[base + Math.min(last, Math.max(0, k)) * step];
    for (let x = 0; x < length; x++) {
      dst[base + x * step] = acc / size;
      acc += src[base + Math.min(last, x + radius + 1) * step] - src[base + Math.max(0, x - radius) * step];
    }
  }
}

export function gaussianBlur(src: Float32Array, width: number, height: number, sigma: number): Float32Array {
  if (width < 1 || height < 1 || src.length !== width * height) throw new Error("Blur buffer does not match its size");
  if (!(sigma >= 0.25)) return Float32Array.from(src);
  let from = Float32Array.from(src);
  let to = new Float32Array(src.length);
  for (const size of boxSizes(sigma)) {
    const radius = (size - 1) / 2;
    boxPass(from, to, width, 1, height, width, radius);
    boxPass(to, from, height, width, width, 1, radius);
  }
  return from;
}
