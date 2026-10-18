export type QuadPoint = [number, number];
export type ManualQuad = [QuadPoint, QuadPoint, QuadPoint, QuadPoint];
export const DEFAULT_QUAD: ManualQuad = [[0.3, 0.2], [0.7, 0.2], [0.7, 0.8], [0.3, 0.8]];

/** Keep corner order and reject folded/collapsed masks. Image fractions may extend beyond [0,1]. */
export function validQuad(quad: ManualQuad): boolean {
  return quad.every((p, i) => {
    const b = quad[(i + 1) % 4], c = quad[(i + 2) % 4];
    return p.every(Number.isFinite) &&
      (b[0] - p[0]) * (c[1] - b[1]) - (b[1] - p[1]) * (c[0] - b[0]) > 0.00001;
  });
}

export function moveQuadCorner(quad: ManualQuad, corner: number, point: QuadPoint): ManualQuad {
  if (!Number.isInteger(corner) || corner < 0 || corner > 3 || !point.every(Number.isFinite)) return quad;
  const next = quad.map((p, i) => i === corner ? [...point] : p) as ManualQuad;
  return validQuad(next) ? next : quad;
}

export function translateQuad(quad: ManualQuad, delta: QuadPoint): ManualQuad {
  if (!delta.every(Number.isFinite)) return quad;
  const next = quad.map(([x, y]) => [x + delta[0], y + delta[1]]) as ManualQuad;
  return validQuad(next) ? next : quad;
}

/** Invert the SVG screen transform, including letterboxing, video zoom and pan. */
export function screenToQuadPoint(matrix: { a: number; b: number; c: number; d: number; e: number; f: number }, x: number, y: number, width: number, height: number): QuadPoint | null {
  const { a, b, c, d, e, f } = matrix;
  const det = a * d - b * c;
  if (![a, b, c, d, e, f, x, y, width, height, det].every(Number.isFinite) || det === 0 || width <= 0 || height <= 0) return null;
  const point: QuadPoint = [(d * (x - e) - c * (y - f)) / det / width, (a * (y - f) - b * (x - e)) / det / height];
  return point.every(Number.isFinite) ? point : null;
}

/** Perspective mapping from a unit sprite square to a convex four-corner mask. */
export function projectQuad(q: ManualQuad, u: number, v: number): QuadPoint {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const determinant = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / determinant;
  const h = (dx1 * dy3 - dx3 * dy1) / determinant;
  const denominator = g * u + h * v + 1;
  return [((x1 - x0 + g * x1) * u + (x3 - x0 + h * x3) * v + x0) / denominator,
    ((y1 - y0 + g * y1) * u + (y3 - y0 + h * y3) * v + y0) / denominator];
}

export function manualTexels(rgba: Uint8ClampedArray, row: number, mirrored: boolean, quad: ManualQuad,side=16,rows=32) {
  if (![16,32].includes(side) || !Number.isInteger(rows) || rows<1 || rgba.length !== side * side * rows * 4 || !Number.isInteger(row) || row < 0 || row >= rows || !validQuad(quad)) throw new Error("Invalid manual fire mask");
  const result: Array<{ points: QuadPoint[]; colour: string; alpha: number }> = [];
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const sourceX = mirrored ? side - 1 - x : x;
    const i = ((row * side + y) * side + sourceX) * 4;
    if (!rgba[i + 3]) continue;
    result.push({
      points: [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]].map(([px, py]) => projectQuad(quad, px / side, py / side)),
      colour: `rgb(${rgba[i]}, ${rgba[i + 1]}, ${rgba[i + 2]})`, alpha: rgba[i + 3] / 255,
    });
  }
  return result;
}
