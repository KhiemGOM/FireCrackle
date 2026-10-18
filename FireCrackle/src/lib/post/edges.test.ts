import { describe, expect, it } from "vitest";
import { applyEdges, DEFAULT_EDGES, type EdgeParams } from "./edges";

const params = (patch: Partial<EdgeParams> = {}) => ({ ...DEFAULT_EDGES, gain: 1, threshold: 0, ...patch });
function picture(w = 8, h = 5, sample = (x: number, _y: number) => x < 4 ? [100, 100, 100] : [120, 120, 120]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([...sample(x, y), 80 + x + y], (y * w + x) * 4);
  return data;
}
const at = (d: Uint8ClampedArray, x: number, y = 2, w = 8) => d[(y * w + x) * 4];

describe("inspection edge maps", () => {
  it("normalizes a 20-level step to 20 and leaves flat regions black, including frame borders", () => {
    const out = applyEdges(picture(), 8, 5, params());
    expect([at(out, 0), at(out, 2), at(out, 3), at(out, 4), at(out, 5), at(out, 7)]).toEqual([0, 0, 20, 20, 0, 0]);
  });
  it("uses the same scale for horizontal and vertical boundaries", () => {
    const horizontal = picture(8, 8, (_x, y) => y < 4 ? [100, 100, 100] : [120, 120, 120]);
    expect(at(applyEdges(horizontal, 8, 8, params()), 2, 3)).toBe(20);
  });
  it("amplifies faint boundaries and rejects changes below the noise cutoff", () => {
    expect(at(applyEdges(picture(), 8, 5, params({ gain: 4 })), 3)).toBe(80);
    expect(at(applyEdges(picture(), 8, 5, params({ gain: 16, threshold: 25 })), 3)).toBe(0);
  });
  it("can expose colour boundaries that have almost identical brightness", () => {
    const input = picture(8, 5, x => x < 4 ? [255, 0, 0] : [0, 130, 0]);
    expect(at(applyEdges(input, 8, 5, params({ channel: 0, threshold: 1 })), 3)).toBe(0);
    expect(at(applyEdges(input, 8, 5, params({ channel: 1, threshold: 1 })), 3)).toBeGreaterThan(240);
  });
  it("offers black-on-white and an overlay that preserves the unmarked background", () => {
    const input = picture();
    expect(at(applyEdges(input, 8, 5, params({ mode: 1 })), 0)).toBe(255);
    expect(at(applyEdges(input, 8, 5, params({ mode: 1 })), 3)).toBe(235);
    const overlay = applyEdges(input, 8, 5, params({ mode: 2, gain: 16 }));
    expect(Array.from(overlay.slice(0, 4))).toEqual(Array.from(input.slice(0, 4)));
    expect(Array.from(overlay.slice((2 * 8 + 3) * 4, (2 * 8 + 3) * 4 + 3))).toEqual([0, 255, 200]);
  });
  it("preserves alpha and source pixels, and supports a zero-amount bypass", () => {
    const input = picture(), before = input.slice();
    const out = applyEdges(input, 8, 5, params());
    expect(input).toEqual(before);
    for (let i = 3; i < input.length; i += 4) expect(out[i]).toBe(input[i]);
    expect(applyEdges(input, 8, 5, params({ amount: 0 }))).toBe(input);
  });
  it("handles narrow/empty pictures without invented borders and rejects invalid dimensions", () => {
    for (const [w, h] of [[1, 1], [1, 5], [5, 1]]) {
      const out = applyEdges(picture(w, h, () => [80, 80, 80]), w, h, params());
      for (let i = 0; i < out.length; i += 4) expect(out[i]).toBe(0);
    }
    expect(applyEdges(new Uint8ClampedArray(), 0, 0, params())).toHaveLength(0);
    expect(() => applyEdges(picture(), 9, 5, params())).toThrow(/size/i);
  });
});
