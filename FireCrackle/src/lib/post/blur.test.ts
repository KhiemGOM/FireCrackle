import { describe, expect, it } from "vitest";
import { gaussianBlur } from "./blur";

const impulse = (w: number, h: number) => {
  const a = new Float32Array(w * h);
  a[Math.floor(h / 2) * w + Math.floor(w / 2)] = 1;
  return a;
};
const sum = (a: Float32Array) => a.reduce((x, y) => x + y, 0);

describe("gaussian blur (three box passes)", () => {
  it("leaves a constant picture constant", () => {
    const out = gaussianBlur(new Float32Array(12 * 9).fill(7), 12, 9, 2);
    for (const v of out) expect(v).toBeCloseTo(7, 4);
  });

  it("spreads an impulse symmetrically without losing or gaining any of it (away from the edges)", () => {
    const w = 41, h = 41, out = gaussianBlur(impulse(w, h), w, h, 2);
    expect(sum(out)).toBeCloseTo(1, 3);
    const cx = 20, cy = 20;
    for (let k = 1; k <= 6; k++) {
      expect(out[cy * w + cx + k]).toBeCloseTo(out[cy * w + cx - k], 5);
      expect(out[(cy + k) * w + cx]).toBeCloseTo(out[(cy - k) * w + cx], 5);
    }
    expect(out[cy * w + cx]).toBeGreaterThan(out[cy * w + cx + 1]);
    expect(out[cy * w + cx + 1]).toBeGreaterThan(0);
  });

  it("a bigger radius spreads further and lowers the peak", () => {
    const w = 41, h = 41;
    const small = gaussianBlur(impulse(w, h), w, h, 1), big = gaussianBlur(impulse(w, h), w, h, 3);
    expect(big[20 * w + 20]).toBeLessThan(small[20 * w + 20]);
    expect(big[20 * w + 26]).toBeGreaterThan(small[20 * w + 26]);
  });

  it("returns an equal copy, not the same array, for a radius too small to matter", () => {
    const src = Float32Array.from([1, 2, 3, 4]);
    const out = gaussianBlur(src, 2, 2, 0);
    expect(out).not.toBe(src);
    expect([...out]).toEqual([1, 2, 3, 4]);
  });

  it("works on a one-pixel picture and on a single row or column", () => {
    expect([...gaussianBlur(Float32Array.from([5]), 1, 1, 2)]).toEqual([5]);
    const row = gaussianBlur(Float32Array.from([0, 0, 9, 0, 0]), 5, 1, 1);
    expect(row).toHaveLength(5);
    for (const v of row) expect(Number.isFinite(v)).toBe(true);
    expect(gaussianBlur(new Float32Array(6).fill(1), 1, 6, 2)).toHaveLength(6);
  });

  it("does not change its input and refuses a buffer that does not match the size", () => {
    const src = impulse(9, 9), copy = Float32Array.from(src);
    gaussianBlur(src, 9, 9, 2);
    expect(src).toEqual(copy);
    expect(() => gaussianBlur(new Float32Array(5), 3, 3, 1)).toThrow(/size/i);
  });

  it("keeps every value inside the range of the input (it only averages)", () => {
    const w = 16, h = 16, src = new Float32Array(w * h);
    for (let i = 0; i < src.length; i++) src[i] = (i * 37) % 256;
    const out = gaussianBlur(src, w, h, 2.5);
    for (const v of out) { expect(v).toBeGreaterThanOrEqual(-1e-3); expect(v).toBeLessThanOrEqual(255 + 1e-3); }
  });
});
