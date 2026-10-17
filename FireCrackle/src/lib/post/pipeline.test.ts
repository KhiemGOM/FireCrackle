import { describe, expect, it } from "vitest";
import { enhance } from "./pipeline";
import { DEFAULT_POST, DEFAULT_TONE, type PostSettings } from "./settings";
import { buildToneLut } from "./tone";

const tone = (params: Partial<typeof DEFAULT_TONE>, on = true): PostSettings => ({ ...DEFAULT_POST, stages: { tone: { on, params: { ...DEFAULT_TONE, ...params } } } });
const picture = (w = 2, h = 1) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set([64 + i, 32, 200, 255 - i], i * 4);
  return d;
};

describe("enhancement pipeline", () => {
  it("does nothing and says so when the master switch is off", () => {
    const data = picture();
    const out = enhance({ data, width: 2, height: 1 }, { ...tone({ gamma: 2 }), enabled: false });
    expect(out.applied).toBe(false);
    expect(out.data).toBe(data);
  });

  it("does nothing when no effect is on, or an effect is on with every control neutral", () => {
    const data = picture();
    expect(enhance({ data, width: 2, height: 1 }, DEFAULT_POST).applied).toBe(false);
    expect(enhance({ data, width: 2, height: 1 }, tone({}, true)).applied).toBe(false);
    expect(enhance({ data, width: 2, height: 1 }, tone({ gamma: 2 }, false)).data).toBe(data);
  });

  it("applies tone to red, green and blue and keeps alpha", () => {
    const data = picture();
    const lut = buildToneLut({ ...DEFAULT_TONE, gamma: 2 });
    const out = enhance({ data, width: 2, height: 1 }, tone({ gamma: 2 }));
    expect(out.applied).toBe(true);
    expect([out.data[0], out.data[1], out.data[2], out.data[3]]).toEqual([lut[64], lut[32], lut[200], 255]);
    expect(out.data[7]).toBe(254);
  });

  it("does not change the picture it was given", () => {
    const data = picture();
    const copy = new Uint8ClampedArray(data);
    enhance({ data, width: 2, height: 1 }, tone({ gamma: 2, contrast: 30 }));
    expect(data).toEqual(copy);
  });

  it("handles a one-pixel picture", () => {
    const out = enhance({ data: new Uint8ClampedArray([10, 10, 10, 255]), width: 1, height: 1 }, tone({ shadows: 100 }));
    expect(out.applied).toBe(true);
    expect(out.data[0]).toBeGreaterThan(10);
  });

  it("refuses a picture whose pixel count does not match its size", () => {
    expect(() => enhance({ data: picture(), width: 3, height: 3 }, tone({ gamma: 2 }))).toThrow(/size/i);
  });
});
