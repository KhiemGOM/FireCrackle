import { describe, expect, it } from "vitest";
import { enhance } from "./pipeline";
import { DEFAULT_POST, DEFAULT_TONE, type PostSettings } from "./settings";
import { buildToneLut } from "./tone";

const tone = (params: Partial<typeof DEFAULT_TONE>, on = true): PostSettings => ({ ...DEFAULT_POST, stages: { ...DEFAULT_POST.stages, tone: { on, params: { ...DEFAULT_TONE, ...params } } } });
const mixed = (order: PostSettings["order"]): PostSettings => ({
  ...DEFAULT_POST, order,
  stages: { ...DEFAULT_POST.stages, tone: { on: true, params: { ...DEFAULT_TONE, gamma: 2 } }, sharpen: { on: true, params: { amount: 200, radius: 1.5, threshold: 0 } } },
});
const edge = () => {
  const w = 16, h = 4, d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set([i % w < 8 ? 40 : 160, i % w < 8 ? 40 : 160, i % w < 8 ? 40 : 160, 255], i * 4);
  return { data: d, width: w, height: h };
};
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

  it("runs the effects in the user's order, so a different order gives a different picture", () => {
    const a = enhance(edge(), mixed(["tone", "sharpen", "fire", "channels"]));
    const b = enhance(edge(), mixed(["sharpen", "tone", "fire", "channels"]));
    expect(a.applied && b.applied).toBe(true);
    expect([...a.data]).not.toEqual([...b.data]);
  });

  it("skips an effect that is off even when it sits between two that are on", () => {
    const all = enhance(edge(), mixed(["tone", "sharpen", "fire", "channels"]));
    const off: PostSettings = { ...mixed(["tone", "sharpen", "fire", "channels"]), stages: { ...mixed([]).stages, sharpen: { on: false, params: { amount: 200, radius: 1.5, threshold: 0 } } } };
    const toneOnly = enhance(edge(), tone({ gamma: 2 }));
    expect([...enhance(edge(), off).data]).toEqual([...toneOnly.data]);
    expect([...all.data]).not.toEqual([...toneOnly.data]);
  });

  it("applies the channel view when it is switched on", () => {
    const s: PostSettings = { ...DEFAULT_POST, stages: { ...DEFAULT_POST.stages, channels: { on: true, params: { mode: 1 } } } };
    const out = enhance({ data: new Uint8ClampedArray([200, 100, 50, 255]), width: 1, height: 1 }, s);
    expect([...out.data]).toEqual([200, 200, 200, 255]);
    expect(out.applied).toBe(true);
  });

  it("reports nothing applied when every switched-on effect is neutral", () => {
    const s: PostSettings = { ...DEFAULT_POST, stages: { ...DEFAULT_POST.stages, sharpen: { on: true, params: { amount: 0, radius: 1.5, threshold: 0 } }, channels: { on: true, params: { mode: 0 } } } };
    const data = picture();
    expect(enhance({ data, width: 2, height: 1 }, s)).toEqual({ data, applied: false });
  });
});
