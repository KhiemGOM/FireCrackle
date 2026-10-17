import { describe, expect, it } from "vitest";
import { CHANNEL_MODES, DEFAULT_CHANNELS, applyChannels, isChannelsIdentity } from "./channels";

const pic = () => new Uint8ClampedArray([200, 100, 50, 255, 10, 20, 30, 128]);

describe("channel view", () => {
  it("shows all channels, returning the same array, by default", () => {
    const d = pic();
    expect(isChannelsIdentity(DEFAULT_CHANNELS)).toBe(true);
    expect(applyChannels(d, DEFAULT_CHANNELS)).toBe(d);
  });

  it("lists All, Red, Green, Blue and Brightness", () => {
    expect(CHANNEL_MODES.map(m => m.label)).toEqual(["All", "Red", "Green", "Blue", "Brightness"]);
  });

  it("shows one channel as grey", () => {
    expect([...applyChannels(pic(), { mode: 1 })]).toEqual([200, 200, 200, 255, 10, 10, 10, 128]);
    expect([...applyChannels(pic(), { mode: 2 })]).toEqual([100, 100, 100, 255, 20, 20, 20, 128]);
    expect([...applyChannels(pic(), { mode: 3 })]).toEqual([50, 50, 50, 255, 30, 30, 30, 128]);
  });

  it("shows brightness with the usual weights", () => {
    const out = applyChannels(pic(), { mode: 4 });
    const y = Math.round(0.299 * 200 + 0.587 * 100 + 0.114 * 50);
    expect([out[0], out[1], out[2]]).toEqual([y, y, y]);
  });

  it("keeps alpha", () => {
    const out = applyChannels(pic(), { mode: 2 });
    expect([out[3], out[7]]).toEqual([255, 128]);
  });

  it("does not change its input, and treats an unknown mode as All", () => {
    const d = pic(), copy = new Uint8ClampedArray(d);
    applyChannels(d, { mode: 1 });
    expect(d).toEqual(copy);
    expect(applyChannels(d, { mode: 9 })).toBe(d);
    expect(isChannelsIdentity({ mode: 9 })).toBe(true);
  });

  it("refuses a buffer that is not whole pixels", () => {
    expect(() => applyChannels(new Uint8ClampedArray(6), { mode: 1 })).toThrow(/pixel/i);
  });
});
