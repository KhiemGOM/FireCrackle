import { describe, expect, it } from "vitest";
import { DEFAULT_DENOISE, applyDenoise, isDenoiseIdentity } from "./denoise";

const denoise = (patch: Partial<typeof DEFAULT_DENOISE>) => ({ ...DEFAULT_DENOISE, strength: 50, ...patch });
/** Deterministic noise in -amp..amp. */
function noise(seed: number, amp: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return ((s / 4294967296) * 2 - 1) * amp; };
}
/** Grey picture: `base(x)` plus noise, alpha 255. */
function grey(w: number, h: number, base: (x: number) => number, amp: number, seed = 7) {
  const n = noise(seed, amp), d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = base(x) + n(); d.set([v, v, v, 255], (y * w + x) * 4); }
  return d;
}
const variance = (d: Uint8ClampedArray, x0: number, x1: number, w: number, h: number) => {
  const v: number[] = [];
  for (let y = 0; y < h; y++) for (let x = x0; x < x1; x++) v.push(d[(y * w + x) * 4]);
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length;
};

describe("denoise (edge-keeping smoothing)", () => {
  it("is the identity, returning the same array, at strength zero", () => {
    const d = grey(8, 8, () => 100, 5);
    expect(isDenoiseIdentity(DEFAULT_DENOISE)).toBe(true);
    expect(applyDenoise(d, 8, 8, DEFAULT_DENOISE)).toBe(d);
    expect(isDenoiseIdentity(denoise({}))).toBe(false);
  });

  it("calms noise on a flat area", () => {
    const w = 24, h = 24, d = grey(w, h, () => 120, 12);
    const out = applyDenoise(d, w, h, denoise({ radius: 2 }));
    expect(variance(out, 4, 20, w, h)).toBeLessThan(variance(d, 4, 20, w, h) * 0.5);
  });

  it("smooths more with a larger radius and with a higher strength", () => {
    const w = 24, h = 24, d = grey(w, h, () => 120, 12);
    const v = (p: Partial<typeof DEFAULT_DENOISE>) => variance(applyDenoise(d, w, h, denoise(p)), 4, 20, w, h);
    expect(v({ radius: 3 })).toBeLessThanOrEqual(v({ radius: 1 }));
    expect(v({ strength: 90 })).toBeLessThanOrEqual(v({ strength: 20 }));
  });

  it("keeps a strong edge sharp while it smooths on both sides", () => {
    const w = 24, h = 12, d = grey(w, h, x => (x < 12 ? 40 : 200), 5);
    const out = applyDenoise(d, w, h, denoise({ radius: 2 }));
    const at = (x: number, y = 6) => out[(y * w + x) * 4];
    expect(at(11)).toBeLessThan(40 + 12);   // the dark side next to the edge stays dark
    expect(at(12)).toBeGreaterThan(200 - 12); // the bright side stays bright
    expect(variance(out, 2, 9, w, h)).toBeLessThan(variance(d, 2, 9, w, h));
  });

  it("moves red, green and blue together and keeps alpha", () => {
    const w = 8, h = 8, d = grey(w, h, () => 100, 10);
    for (let i = 0; i < d.length; i += 4) { d[i + 1] = d[i] + 20; d[i + 2] = d[i] + 40; d[i + 3] = 180; }
    const out = applyDenoise(d, w, h, denoise({}));
    for (let i = 0; i < out.length; i += 4) expect(out[i + 3]).toBe(180);
    for (let i = 0; i < out.length; i += 4) { expect(Math.abs(out[i + 1] - out[i] - 20)).toBeLessThanOrEqual(1); expect(Math.abs(out[i + 2] - out[i] - 40)).toBeLessThanOrEqual(1); }
  });

  it("does not change its input, stays inside 0..255, and copes with tiny pictures", () => {
    const d = grey(8, 8, () => 250, 20), copy = new Uint8ClampedArray(d);
    const out = applyDenoise(d, 8, 8, denoise({ radius: 3 }));
    expect(d).toEqual(copy);
    for (const v of out) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(255); }
    expect(applyDenoise(new Uint8ClampedArray([9, 9, 9, 255]), 1, 1, denoise({})).length).toBe(4);
    expect(applyDenoise(new Uint8ClampedArray(2 * 2 * 4).fill(30), 2, 2, denoise({ radius: 3 })).length).toBe(16);
  });

  it("leaves a flat picture exactly as it is", () => {
    const d = new Uint8ClampedArray(6 * 6 * 4).fill(77);
    expect(applyDenoise(d, 6, 6, denoise({ radius: 3 }))).toEqual(d);
  });

  it("refuses a buffer that does not match the size", () => {
    expect(() => applyDenoise(new Uint8ClampedArray(12), 2, 2, denoise({}))).toThrow(/size/i);
  });
});
