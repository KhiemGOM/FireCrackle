import { describe, expect, it, vi } from "vitest";
import { forgetQuad, readFrameQuads, recalledQuad, rememberQuad, sameQuad, writeFrameQuads } from "./frameQuads";
import type { ManualQuad } from "./quadMask";

const quadA: ManualQuad = [[0.31, 0.22], [0.71, 0.21], [0.69, 0.83], [0.3, 0.8]];
const quadB: ManualQuad = [[0.1, 0.1], [0.5, 0.1], [0.5, 0.6], [0.1, 0.6]];
const memory = () => { const data = new Map<string, string>(); return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }; };

describe("remembering where the quad mask was confirmed on each frame", () => {
  it("recalls the quad of a frame, and nothing for a frame never confirmed", () => {
    const quads = rememberQuad(new Map(), 12, quadA);
    expect(recalledQuad(quads, 12)).toEqual(quadA);
    expect(recalledQuad(quads, 13)).toBeUndefined();
  });

  it("keeps each frame's own quad, and a later confirmation replaces the earlier one", () => {
    let quads = rememberQuad(new Map(), 1, quadA);
    quads = rememberQuad(quads, 2, quadB);
    expect([recalledQuad(quads, 1), recalledQuad(quads, 2)]).toEqual([quadA, quadB]);
    quads = rememberQuad(quads, 1, quadB);
    expect(recalledQuad(quads, 1)).toEqual(quadB);
  });

  it("does not change the map it was given", () => {
    const before = new Map<number, ManualQuad>();
    rememberQuad(before, 5, quadA);
    expect(before.size).toBe(0);
  });

  it("forgets a frame's quad without touching the others", () => {
    const quads = forgetQuad(rememberQuad(rememberQuad(new Map(), 1, quadA), 2, quadB), 1);
    expect([recalledQuad(quads, 1), recalledQuad(quads, 2)]).toEqual([undefined, quadB]);
  });

  it("survives a restart: written for a video, read back to the same positions", () => {
    const store = memory();
    expect(writeFrameQuads("D:/a.mkv", rememberQuad(rememberQuad(new Map(), 7, quadA), 90000, quadB), store)).toBe(true);
    const back = readFrameQuads("D:/a.mkv", store);
    expect(recalledQuad(back, 7)).toEqual(quadA);
    expect(recalledQuad(back, 90000)).toEqual(quadB);
  });

  it("is kept per video", () => {
    const store = memory();
    writeFrameQuads("D:/a.mkv", rememberQuad(new Map(), 7, quadA), store);
    expect(readFrameQuads("D:/b.mkv", store).size).toBe(0);
    writeFrameQuads("D:/b.mkv", rememberQuad(new Map(), 7, quadB), store);
    expect(recalledQuad(readFrameQuads("D:/a.mkv", store), 7)).toEqual(quadA);
  });

  it("compares quads with a tolerance finer than a pixel", () => {
    expect(sameQuad(quadA, quadA.map(p => [...p]) as ManualQuad)).toBe(true);
    expect(sameQuad(quadA, quadB)).toBe(false);
    expect(sameQuad(quadA, [[0.31, 0.22], [0.71, 0.21], [0.69, 0.83], [0.3000001, 0.8]])).toBe(true);
  });
});

describe("a damaged or unavailable store never breaks the tool", () => {
  const key = (video: string) => `firecrackle.quads.v1:${encodeURIComponent(video)}`;
  it("reads nothing from corrupt, wrongly shaped or missing data", () => {
    for (const raw of ["{not json", "[]", "null", "42", '"text"']) {
      const store = memory(); store.data.set(key("v"), raw);
      expect(readFrameQuads("v", store).size, raw).toBe(0);
    }
    expect(readFrameQuads("v", memory()).size).toBe(0);
  });

  it("keeps the good entries and drops invalid ones", () => {
    const store = memory();
    const flat = (q: ManualQuad) => q.flat();
    store.data.set(key("v"), JSON.stringify({
      "4": flat(quadA),
      "-1": flat(quadA), "1.5": flat(quadA), "abc": flat(quadA),
      "5": [0.1, 0.1], "6": flat(quadA).map(String), "7": [...flat(quadA).slice(0, 7), null],
      "8": [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], "9": [0.1, 0.1, 0.9, 0.1, 9e999, 0.9, 0.1, 0.9],
    }));
    const quads = readFrameQuads("v", store);
    expect([...quads.keys()]).toEqual([4]);
    expect(recalledQuad(quads, 4)).toEqual(quadA);
  });

  it("does not throw when the store cannot be read or written", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
    expect(readFrameQuads("v", broken).size).toBe(0);
    expect(writeFrameQuads("v", rememberQuad(new Map(), 1, quadA), broken)).toBe(false);
  });

  it("stores nothing without a video", () => {
    const store = memory(); const set = vi.spyOn(store, "setItem");
    expect(writeFrameQuads(undefined, rememberQuad(new Map(), 1, quadA), store)).toBe(false);
    expect(set).not.toHaveBeenCalled();
    expect(readFrameQuads(undefined, store).size).toBe(0);
  });

  it("refuses to remember a frame that is not a frame number or a quad that is not a quad", () => {
    expect(rememberQuad(new Map(), -1, quadA).size).toBe(0);
    expect(rememberQuad(new Map(), 1.5, quadA).size).toBe(0);
    expect(rememberQuad(new Map(), 1, [[0, 0], [0, 0], [0, 0], [0, 0]]).size).toBe(0);
    expect(rememberQuad(new Map(), 1, [[NaN, 0], [1, 0], [1, 1], [0, 1]]).size).toBe(0);
  });
});
