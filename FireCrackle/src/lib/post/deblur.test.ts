import { describe, expect, it } from "vitest";
import { DEFAULT_DEBLUR, applyDeblur, isDeblurIdentity } from "./deblur";
import { gaussianBlur } from "./blur";

const deblur = (patch: Partial<typeof DEFAULT_DEBLUR>) => ({ ...DEFAULT_DEBLUR, iterations: 6, ...patch });
const W = 32, H = 6;
/** A sharp vertical step of grey values, and the same step blurred the way the deblur assumes. */
function stepRow(lo = 50, hi = 200) {
  const luma = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) luma[y * W + x] = x < W / 2 ? lo : hi;
  return luma;
}
const toRgba = (luma: Float32Array) => {
  const d = new Uint8ClampedArray(luma.length * 4);
  for (let i = 0; i < luma.length; i++) d.set([luma[i], luma[i], luma[i], 255], i * 4);
  return d;
};
const row = (d: Uint8ClampedArray, y = 3) => Array.from({ length: W }, (_, x) => d[(y * W + x) * 4]);
const error = (a: number[], b: number[]) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);
const steepest = (r: number[]) => Math.max(...r.slice(1).map((v, i) => Math.abs(v - r[i])));

describe("deblur (Richardson-Lucy on brightness)", () => {
  it("is the identity, returning the same array, with zero iterations", () => {
    const d = toRgba(stepRow());
    expect(isDeblurIdentity(DEFAULT_DEBLUR)).toBe(true);
    expect(applyDeblur(d, W, H, DEFAULT_DEBLUR)).toBe(d);
    expect(isDeblurIdentity(deblur({}))).toBe(false);
  });

  it("brings a blurred edge back towards the sharp one", () => {
    const sharp = row(toRgba(stepRow())), blurred = toRgba(gaussianBlur(stepRow(), W, H, 1.5));
    const out = row(applyDeblur(blurred, W, H, deblur({ radius: 1.5 })));
    expect(error(out, sharp)).toBeLessThan(error(row(blurred), sharp));
    expect(steepest(out)).toBeGreaterThan(steepest(row(blurred)));
  });

  it("does more with more iterations", () => {
    const sharp = row(toRgba(stepRow())), blurred = toRgba(gaussianBlur(stepRow(), W, H, 1.5));
    const few = row(applyDeblur(blurred, W, H, deblur({ iterations: 2 }))), many = row(applyDeblur(blurred, W, H, deblur({ iterations: 8 })));
    expect(error(many, sharp)).toBeLessThan(error(few, sharp));
  });

  it("leaves a flat picture alone", () => {
    const d = new Uint8ClampedArray(8 * 8 * 4).fill(90);
    expect(applyDeblur(d, 8, 8, deblur({}))).toEqual(d);
  });

  it("stays inside 0..255 and never makes a number that is not finite, even next to pure black and pure white", () => {
    const luma = stepRow(0, 255), blurred = toRgba(gaussianBlur(luma, W, H, 1.5));
    const out = applyDeblur(blurred, W, H, deblur({ iterations: 10 }));
    for (const v of out) { expect(Number.isFinite(v)).toBe(true); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(255); }
  });

  it("moves red, green and blue together and keeps alpha", () => {
    const base = toRgba(gaussianBlur(stepRow(), W, H, 1.5));
    for (let i = 0; i < base.length; i += 4) { base[i + 1] = Math.min(255, base[i] + 10); base[i + 3] = 150; }
    const out = applyDeblur(base, W, H, deblur({}));
    for (let i = 0; i < out.length; i += 4) expect(out[i + 3]).toBe(150);
    const i = (3 * W + W / 2) * 4;
    expect(out[i] - base[i]).toBe(out[i + 1] - base[i + 1]);
  });

  it("does not change its input and copes with tiny pictures", () => {
    const d = toRgba(gaussianBlur(stepRow(), W, H, 1.5)), copy = new Uint8ClampedArray(d);
    applyDeblur(d, W, H, deblur({}));
    expect(d).toEqual(copy);
    expect(applyDeblur(new Uint8ClampedArray([10, 20, 30, 255]), 1, 1, deblur({})).length).toBe(4);
    expect(applyDeblur(new Uint8ClampedArray(2 * 2 * 4).fill(40), 2, 2, deblur({ radius: 3 })).length).toBe(16);
  });

  it("refuses a buffer that does not match the size", () => {
    expect(() => applyDeblur(new Uint8ClampedArray(12), 2, 2, deblur({}))).toThrow(/size/i);
  });
});
