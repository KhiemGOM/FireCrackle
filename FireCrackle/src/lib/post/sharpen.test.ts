import { describe, expect, it } from "vitest";
import { DEFAULT_SHARPEN, applySharpen, isSharpenIdentity } from "./sharpen";

const sharpen = (patch: Partial<typeof DEFAULT_SHARPEN>) => ({ ...DEFAULT_SHARPEN, amount: 100, ...patch });
/** A vertical step edge: left half dark, right half bright, in grey, alpha 255. */
function step(w = 16, h = 4, lo = 60, hi = 190) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set([x < w / 2 ? lo : hi, x < w / 2 ? lo : hi, x < w / 2 ? lo : hi, 255], (y * w + x) * 4);
  return d;
}
const at = (d: Uint8ClampedArray, w: number, x: number, y = 0) => d[(y * w + x) * 4];

describe("sharpen (unsharp mask on brightness)", () => {
  it("is the identity, returning the same array, when the amount is zero", () => {
    const d = step();
    expect(isSharpenIdentity(DEFAULT_SHARPEN)).toBe(true);
    expect(applySharpen(d, 16, 4, DEFAULT_SHARPEN)).toBe(d);
    expect(isSharpenIdentity(sharpen({}))).toBe(false);
  });

  it("changes nothing on a flat picture", () => {
    const d = new Uint8ClampedArray(8 * 8 * 4).fill(120);
    const out = applySharpen(d, 8, 8, sharpen({ amount: 200 }));
    expect(out).toEqual(d);
  });

  it("overshoots on both sides of an edge: the bright side gets brighter and the dark side darker", () => {
    const w = 16, out = applySharpen(step(w), w, 4, sharpen({ amount: 150, radius: 1.5 }));
    expect(at(out, w, 8)).toBeGreaterThan(190);
    expect(at(out, w, 7)).toBeLessThan(60);
    expect(at(out, w, 0)).toBe(60); // far from the edge nothing moves
    expect(at(out, w, 15)).toBe(190);
  });

  it("sharpens more with a larger amount", () => {
    const w = 16, a = applySharpen(step(w), w, 4, sharpen({ amount: 50 })), b = applySharpen(step(w), w, 4, sharpen({ amount: 200 }));
    expect(at(b, w, 8)).toBeGreaterThanOrEqual(at(a, w, 8));
    expect(at(b, w, 7)).toBeLessThanOrEqual(at(a, w, 7));
  });

  it("moves red, green and blue together (no colour fringes) and keeps alpha", () => {
    const w = 16, d = step(w);
    for (let i = 0; i < d.length; i += 4) { d[i + 1] = d[i] + 10 > 255 ? 255 : d[i] + 10; d[i + 3] = 200; }
    const out = applySharpen(d, w, 4, sharpen({}));
    const i = 8 * 4;
    expect(out[i] - d[i]).toBe(out[i + 1] - d[i + 1]); // the same shift in every channel
    expect(out[i + 2] - d[i + 2]).toBe(out[i] - d[i]);
    expect(out[i + 3]).toBe(200);
  });

  it("leaves a small difference alone below the threshold but still sharpens a big edge", () => {
    const w = 16, soft = step(w, 4, 100, 108);
    const kept = applySharpen(soft, w, 4, sharpen({ amount: 300, threshold: 20 }));
    expect(kept).toEqual(soft);
    const big = applySharpen(step(w), w, 4, sharpen({ amount: 300, threshold: 20 }));
    expect(at(big, w, 8)).toBeGreaterThan(190);
  });

  it("stays inside 0..255", () => {
    const w = 16, out = applySharpen(step(w, 4, 5, 250), w, 4, sharpen({ amount: 300, radius: 2 }));
    for (let i = 0; i < out.length; i += 4) { expect(out[i]).toBeGreaterThanOrEqual(0); expect(out[i]).toBeLessThanOrEqual(255); }
    expect(at(out, w, 8)).toBe(255);
    expect(at(out, w, 7)).toBe(0);
  });

  it("does not change its input and copes with tiny pictures", () => {
    const d = step(), copy = new Uint8ClampedArray(d);
    applySharpen(d, 16, 4, sharpen({}));
    expect(d).toEqual(copy);
    expect(applySharpen(new Uint8ClampedArray([10, 20, 30, 255]), 1, 1, sharpen({})).length).toBe(4);
    expect(applySharpen(new Uint8ClampedArray(2 * 2 * 4).fill(9), 2, 2, sharpen({ radius: 5 })).length).toBe(16);
  });

  it("refuses a buffer that does not match the size", () => {
    expect(() => applySharpen(new Uint8ClampedArray(12), 2, 2, sharpen({}))).toThrow(/size/i);
  });
});
