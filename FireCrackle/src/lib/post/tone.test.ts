import { describe, expect, it } from "vitest";
import { applyTone, buildToneLut, isToneIdentity } from "./tone";
import { DEFAULT_TONE } from "./settings";

const tone = (patch: Partial<typeof DEFAULT_TONE>) => ({ ...DEFAULT_TONE, ...patch });
const near = (a: number, b: number, tol = 1) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

describe("tone lookup table", () => {
  it("can recover dark midtones under strong contrast with the expanded gamma range", () => {
    const dark = buildToneLut(tone({ contrast: 200 }));
    const lifted = buildToneLut(tone({ contrast: 200, gamma: 10 }));
    expect(dark[32]).toBe(0);
    expect(lifted[32]).toBeGreaterThan(150);
    expect(lifted[0]).toBe(0);
    expect(lifted[255]).toBe(255);
    for (let i = 1; i < 256; i++) expect(lifted[i]).toBeGreaterThanOrEqual(lifted[i - 1]);
  });
  it("is exactly the identity at the neutral settings", () => {
    const lut = buildToneLut(DEFAULT_TONE);
    expect(lut).toHaveLength(256);
    for (let i = 0; i < 256; i++) expect(lut[i]).toBe(i);
    expect(isToneIdentity(DEFAULT_TONE)).toBe(true);
  });

  it("brightens the midtones with gamma above 1 and darkens them below 1, leaving black and white alone", () => {
    const bright = buildToneLut(tone({ gamma: 2 }));
    near(bright[64], 128);
    expect(bright[0]).toBe(0);
    expect(bright[255]).toBe(255);
    const dark = buildToneLut(tone({ gamma: 0.5 }));
    expect(dark[128]).toBeLessThan(128);
    expect(dark[0]).toBe(0);
    expect(dark[255]).toBe(255);
  });

  it("crushes everything at or below the black point and clips everything at or above the white point", () => {
    const lut = buildToneLut(tone({ black: 50 }));
    expect(lut[50]).toBe(0);
    expect(lut[10]).toBe(0);
    expect(lut[255]).toBe(255);
    const white = buildToneLut(tone({ white: 200 }));
    expect(white[200]).toBe(255);
    expect(white[250]).toBe(255);
    expect(white[0]).toBe(0);
  });

  it("raises contrast around the middle and lowers it with a negative value", () => {
    const high = buildToneLut(tone({ contrast: 50 }));
    expect(high[200]).toBeGreaterThan(200);
    expect(high[50]).toBeLessThan(50);
    near(high[128], 128);
    const low = buildToneLut(tone({ contrast: -50 }));
    expect(low[200]).toBeLessThan(200);
    expect(low[200]).toBeGreaterThan(128);
    expect(low[50]).toBeGreaterThan(50);
  });

  it("lifts the shadows far more than the highlights", () => {
    const lut = buildToneLut(tone({ shadows: 100 }));
    expect(lut[40]).toBeGreaterThan(40);
    expect(lut[0]).toBe(0);
    expect(lut[255]).toBe(255);
    expect(lut[40] - 40).toBeGreaterThan(lut[230] - 230);
  });

  it("never goes backwards (a brighter input is never darker), even with extreme settings", () => {
    const extremes = [
      tone({ gamma: 0.3 }), tone({ gamma: 3 }), tone({ contrast: 100 }), tone({ contrast: -100 }), tone({ shadows: 100 }),
      tone({ black: 253, white: 254 }), tone({ gamma: 3, contrast: 100, shadows: 100 }), tone({ gamma: 0.3, contrast: -100, black: 100, white: 150 }),
    ];
    for (const p of extremes) {
      const lut = buildToneLut(p);
      for (let i = 1; i < 256; i++) expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1]);
      for (let i = 0; i < 256; i++) expect(lut[i]).toBeGreaterThanOrEqual(0), expect(lut[i]).toBeLessThanOrEqual(255);
    }
  });

  it("is not the identity as soon as any control moves", () => {
    for (const p of [tone({ gamma: 1.1 }), tone({ black: 1 }), tone({ white: 254 }), tone({ contrast: 1 }), tone({ shadows: 1 })]) expect(isToneIdentity(p)).toBe(false);
  });
});

describe("applying tone to pixels", () => {
  const pixels = () => new Uint8ClampedArray([64, 64, 64, 255, 10, 20, 30, 128, 255, 0, 128, 0]);

  it("returns the very same array when nothing would change", () => {
    const input = pixels();
    expect(applyTone(input, DEFAULT_TONE)).toBe(input);
  });

  it("maps red, green and blue through the table and leaves alpha alone", () => {
    const input = pixels();
    const lut = buildToneLut(tone({ gamma: 2 }));
    const out = applyTone(input, tone({ gamma: 2 }));
    expect(out).not.toBe(input);
    expect([out[0], out[1], out[2]]).toEqual([lut[64], lut[64], lut[64]]);
    expect([out[4], out[5], out[6]]).toEqual([lut[10], lut[20], lut[30]]);
    expect([out[3], out[7], out[11]]).toEqual([255, 128, 0]);
  });

  it("does not change the array it was given", () => {
    const input = pixels();
    const copy = new Uint8ClampedArray(input);
    applyTone(input, tone({ gamma: 2, contrast: 40 }));
    expect(input).toEqual(copy);
  });

  it("accepts an empty picture and refuses a buffer that is not whole RGBA pixels", () => {
    expect(applyTone(new Uint8ClampedArray(0), tone({ gamma: 2 })).length).toBe(0);
    expect(() => applyTone(new Uint8ClampedArray(5), tone({ gamma: 2 }))).toThrow(/pixel/i);
  });
});
