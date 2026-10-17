import { describe, expect, it } from "vitest";
import { DEFAULT_FIRE, applyFire, fireWeight, isFireIdentity } from "./fire";

const px = (r: number, g: number, b: number, a = 255) => new Uint8ClampedArray([r, g, b, a]);
const fire = (strength: number) => ({ ...DEFAULT_FIRE, strength });

describe("fire view (a view aid, not a detector)", () => {
  it("is the identity, returning the same array, at strength zero", () => {
    const d = px(200, 90, 20);
    expect(isFireIdentity(DEFAULT_FIRE)).toBe(true);
    expect(applyFire(d, fire(0))).toBe(d);
    expect(isFireIdentity(fire(1))).toBe(false);
  });

  it("rates orange and yellow-orange as fire-coloured and blue, green and grey as not", () => {
    expect(fireWeight(255, 120, 20)).toBeGreaterThan(0.9);
    expect(fireWeight(255, 190, 40)).toBeGreaterThan(0.9);
    expect(fireWeight(30, 60, 200)).toBe(0);
    expect(fireWeight(40, 200, 60)).toBe(0);
    expect(fireWeight(128, 128, 128)).toBe(0);
    expect(fireWeight(0, 0, 0)).toBe(0);
    expect(fireWeight(255, 255, 255)).toBe(0);
  });

  it("feathers at the edge of the hue range instead of cutting", () => {
    const mid = fireWeight(255, 140, 20);   // hue about 31 degrees: inside the range
    const edge = fireWeight(255, 52, 20);   // hue about 8 degrees: on the feathered edge
    const outside = fireWeight(255, 28, 20); // hue about 2 degrees: outside
    expect(mid).toBe(1);
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(1);
    expect(outside).toBe(0);
  });

  it("keeps fire-coloured pixels at least as bright and dims everything else, more with more strength", () => {
    const orange = applyFire(px(220, 110, 20), fire(100));
    expect(orange[0] + orange[1] + orange[2]).toBeGreaterThanOrEqual(220 + 110 + 20);
    const blue = px(30, 60, 200);
    const half = applyFire(blue, fire(50)), full = applyFire(blue, fire(100));
    const lum = (d: Uint8ClampedArray) => 0.299 * d[0] + 0.587 * d[1] + 0.114 * d[2];
    expect(lum(full)).toBeLessThan(lum(half));
    expect(lum(half)).toBeLessThan(lum(blue));
  });

  it("desaturates what is not fire at full strength (the colour channels move together)", () => {
    const out = applyFire(px(30, 60, 200), fire(100));
    expect(Math.max(out[0], out[1], out[2]) - Math.min(out[0], out[1], out[2])).toBeLessThan(200 - 30);
  });

  it("lands halfway at half strength", () => {
    const grey = px(200, 200, 200), full = applyFire(grey, fire(100)), half = applyFire(grey, fire(50));
    expect(half[0]).toBe(Math.round((200 + full[0]) / 2));
  });

  it("keeps alpha and stays inside 0..255", () => {
    const out = applyFire(new Uint8ClampedArray([255, 160, 0, 77, 255, 255, 255, 12]), fire(100));
    expect(out[3]).toBe(77);
    expect(out[7]).toBe(12);
    for (const v of out) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(255); }
  });

  it("does not change its input and refuses a buffer that is not whole pixels", () => {
    const d = px(10, 20, 30), copy = new Uint8ClampedArray(d);
    applyFire(d, fire(80));
    expect(d).toEqual(copy);
    expect(() => applyFire(new Uint8ClampedArray(6), fire(80))).toThrow(/pixel/i);
  });
});
