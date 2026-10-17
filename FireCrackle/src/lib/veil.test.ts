import { vi as sharedVeilTest } from "vitest";
import { initVeil } from "./veil";
beforeAll(async()=>{
  const {readFile}=await sharedVeilTest.importActual<{readFile(path:URL):Promise<Uint8Array<ArrayBuffer>>}>("node:fs/promises");
  await initVeil(await readFile(new URL("./veil.wasm",import.meta.url)));
});
import { beforeAll, describe, expect, it } from "vitest";
import { A_BOTTOM, A_TOP, DEFAULT_VEIL_OPTIONS, applyVeil, detectVeilStrict, detectVeil, unveilRgba, type VeilOptions } from "./veil";

// The game draws fillGradient(0xC0101010 -> 0xD0101010) behind an open screen: colour (16,16,16), alpha 192/255 at the
// top row to 208/255 at the bottom row. out = 16a + p(1-a). (Same cases as fire-detection/core/tests/veil.rs.)

const W = 320;
const H = 180;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A natural-ish RGBA scene: smooth gradients plus noise, values within lo..hi. */
function scene(seed: number, lo: number, hi: number, w = W, h = H): Uint8ClampedArray {
  const r = rng(seed);
  const f = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const base = lo + (hi - lo) * (0.5 + 0.5 * Math.sin(x / 23) * Math.cos(y / 17));
      for (let k = 0; k < 3; k++) {
        const v = base + Math.floor(r() * 21) - 10 + k * 4;
        f[(y * w + x) * 4 + k] = Math.min(hi, Math.max(lo, Math.floor(v)));
      }
      f[(y * w + x) * 4 + 3] = 255;
    }
  return f;
}

const alphaAt = (y: number, h: number) => A_TOP + ((A_BOTTOM - A_TOP) * (y + 0.5)) / h;

/** The game's forward veil. */
function veil(frame: Uint8ClampedArray, w = W, h = H): Uint8ClampedArray {
  const out = new Uint8ClampedArray(frame);
  for (let y = 0; y < h; y++) {
    const a = alphaAt(y, h);
    for (let x = 0; x < w; x++)
      for (let k = 0; k < 3; k++) {
        const i = (y * w + x) * 4 + k;
        out[i] = Math.round(16 * a + frame[i] * (1 - a));
      }
  }
  return out;
}

const solid = (v: number, w = W, h = H) => {
  const f = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < f.length; i += 4) f.fill(v, i, i + 3), (f[i + 3] = 255);
  return f;
};

describe("constants", () => {
  it("are the game's gradient alphas", () => {
    expect(A_TOP).toBeCloseTo(192 / 255, 12);
    expect(A_BOTTOM).toBeCloseTo(208 / 255, 12);
  });
  it("default thresholds are the detector's validated ones", () => {
    expect(DEFAULT_VEIL_OPTIONS).toEqual({ minShare: 0.9, margin: 0.2, slack: 2 });
  });
});

describe("detectVeil: basics", () => {
  it("detects a veiled scene", () => {
    for (let seed = 0; seed < 5; seed++) expect(detectVeil(veil(scene(seed, 0, 255)), W, H)).toBe(true);
  });
  it("does not flag a normal bright scene", () => {
    for (let seed = 0; seed < 5; seed++) expect(detectVeil(scene(100 + seed, 0, 255), W, H)).toBe(false);
  });
  it("does not flag a dark scene with real blacks (a veil can never produce them)", () => {
    for (let seed = 0; seed < 5; seed++) expect(detectVeil(scene(200 + seed, 0, 70), W, H)).toBe(false);
  });
  it("detects a veiled all-black scene and not a plain black one", () => {
    expect(detectVeil(veil(solid(0)), W, H)).toBe(true);
    expect(detectVeil(solid(0), W, H)).toBe(false);
  });
});

describe("detectVeil: GUI over the veil", () => {
  it("bright buttons and text over the veil do not hide it", () => {
    const f = veil(scene(7, 0, 255));
    for (let y = 60; y < 90; y++) for (let x = 100; x < 220; x++) f.fill(255, (y * W + x) * 4, (y * W + x) * 4 + 3);
    expect(detectVeil(f, W, H)).toBe(true);
  });
  it("a big inventory panel in the middle (over 10% of the frame) does not hide it", () => {
    const f = veil(scene(8, 0, 255));
    for (let y = 40; y < 150; y++) for (let x = 70; x < 250; x++) f.fill(200, (y * W + x) * 4, (y * W + x) * 4 + 3);
    expect(detectVeil(f, W, H)).toBe(true);
  });
  it("a veil-looking middle inside an unveiled scene is not a veil", () => {
    const f = scene(9, 0, 255);
    const v = veil(scene(10, 0, 255));
    for (let y = 0; y < H; y++) for (let x = 70; x < 250; x++) for (let k = 0; k < 4; k++) f[(y * W + x) * 4 + k] = v[(y * W + x) * 4 + k];
    expect(detectVeil(f, W, H)).toBe(false);
  });
});

describe("detectVeil: parity with the exhaustive definition", () => {
  function reference(rgba: Uint8ClampedArray, w: number, h: number, y0: number, o: VeilOptions): boolean {
    const lo = 16 * A_TOP - o.slack;
    const margin = Math.min(Math.max(Math.floor(w * o.margin), 1), Math.max(1, Math.floor(w / 2)));
    let inside = 0;
    let total = 0;
    for (let y = y0; y < h; y++) {
      const a = alphaAt(y, h);
      const hi = 16 * a + 255 * (1 - a) + o.slack;
      for (const x of [...Array(margin).keys(), ...Array.from({ length: margin }, (_, i) => w - margin + i)]) {
        total++;
        const i = (y * w + x) * 4;
        if ([0, 1, 2].every((k) => rgba[i + k] >= lo && rgba[i + k] <= hi)) inside++;
      }
    }
    return inside >= o.minShare * total;
  }
  it("agrees on random frames of many sizes, shares and start rows", () => {
    const r = rng(1123);
    for (const [w, h] of [[1, 9], [2, 11], [7, 17], [80, 45]] as const)
      for (const percent of [0, 10, 89, 90, 91, 100]) {
        const f = new Uint8ClampedArray(w * h * 4);
        for (let i = 0; i < f.length; i += 4) {
          const good = r() * 100 < percent;
          for (let k = 0; k < 3; k++) f[i + k] = good ? 16 + Math.floor(r() * 30) : Math.floor(r() * 256);
          f[i + 3] = 255;
        }
        for (const y0 of [0, Math.floor(h / 2)])
          expect(detectVeilStrict(f, w, h, DEFAULT_VEIL_OPTIONS, y0), `${w}x${h} ${percent}% y0=${y0}`).toBe(reference(f, w, h, y0, DEFAULT_VEIL_OPTIONS));
      }
  });
});

describe("detectVeil: thresholds are options", () => {
  it("a stricter share rejects a mostly-veiled frame the default accepts", () => {
    const f = veil(scene(11, 0, 255));
    // spoil a few of the judged margin pixels (well under the 10% the default tolerates)
    for (let y = 0; y < H; y++) for (let x = 0; x < 5; x++) if ((y + x) % 12 === 0) f.fill(255, (y * W + x) * 4, (y * W + x) * 4 + 3);
    expect(detectVeilStrict(f, W, H)).toBe(true);
    expect(detectVeilStrict(f, W, H, { ...DEFAULT_VEIL_OPTIONS, minShare: 1 })).toBe(false);
  });
  it("a larger slack accepts values just outside the legal range", () => {
    const f = solid(10); // below 16 * a_top (about 12): not legal
    expect(detectVeilStrict(f, W, H)).toBe(false);
    expect(detectVeilStrict(f, W, H, { ...DEFAULT_VEIL_OPTIONS, slack: 6 })).toBe(true);
  });
  it("the margin decides how much of the picture is judged", () => {
    const f = veil(scene(12, 0, 255));
    for (let y = 0; y < H; y++) for (let x = 60; x < 260; x++) f.fill(255, (y * W + x) * 4, (y * W + x) * 4 + 3); // wide bright middle
    expect(detectVeilStrict(f, W, H, { ...DEFAULT_VEIL_OPTIONS, margin: 0.2 })).toBe(true);
    expect(detectVeilStrict(f, W, H, { ...DEFAULT_VEIL_OPTIONS, margin: 0.5 })).toBe(false);
  });
});

describe("detectVeil: bad input is an error", () => {
  it("rejects a buffer of the wrong size", () => {
    expect(() => detectVeil(new Uint8ClampedArray(10), W, H)).toThrow();
  });
  it("rejects zero sizes and a start row past the end", () => {
    expect(() => detectVeil(new Uint8ClampedArray(0), 0, 0)).toThrow();
    expect(() => detectVeil(solid(0, 4, 4), 4, 4, DEFAULT_VEIL_OPTIONS, 4)).toThrow();
  });
  it("rejects thresholds out of range", () => {
    const f = solid(0, 4, 4);
    for (const bad of [{ minShare: 0 }, { minShare: 1.01 }, { margin: 0 }, { margin: 0.51 }, { slack: -1 }, { minShare: Number.NaN }])
      expect(() => detectVeil(f, 4, 4, { ...DEFAULT_VEIL_OPTIONS, ...bad }), JSON.stringify(bad)).toThrow();
  });
});

describe("unveilRgba", () => {
  it("is exact for the veil colour: the floor at each row becomes black", () => {
    const f = solid(0);
    const out = unveilRgba(veil(f), W, H);
    expect(Array.from(out.slice(0, 4))).toEqual([0, 0, 0, 255]);
    expect(Array.from(out.slice((H - 1) * W * 4, (H - 1) * W * 4 + 4))).toEqual([0, 0, 0, 255]);
  });
  it("returns the original within the rounding of an 8-bit round trip", () => {
    const f = scene(21, 0, 255);
    const out = unveilRgba(veil(f), W, H);
    let worst = 0;
    for (let i = 0; i < f.length; i++) if (i % 4 !== 3) worst = Math.max(worst, Math.abs(out[i] - f[i]));
    expect(worst).toBeLessThanOrEqual(3); // 0.5 / (1 - a) is at most 0.5 / (47/255) = 2.7
  });
  it("uses the alpha of each row (the same veiled value comes back brighter lower down)", () => {
    const f = solid(40);
    const top = unveilRgba(f, W, H)[0];
    const bottom = unveilRgba(f, W, H)[(H - 1) * W * 4];
    const a0 = alphaAt(0, H);
    const a1 = alphaAt(H - 1, H);
    expect(top).toBe(Math.round((40 - 16 * a0) / (1 - a0)));
    expect(bottom).toBe(Math.round((40 - 16 * a1) / (1 - a1)));
    expect(bottom).not.toBe(top);
  });
  it("clamps to 0..255 and leaves the alpha channel alone", () => {
    const f = new Uint8ClampedArray([0, 0, 0, 77, 255, 255, 255, 33]);
    const out = unveilRgba(f, 2, 1);
    expect(Array.from(out)).toEqual([0, 0, 0, 77, 255, 255, 255, 33]);
  });
  it("does not change its input and returns a new buffer", () => {
    const f = scene(22, 0, 255, 8, 8);
    const copy = new Uint8ClampedArray(f);
    const out = unveilRgba(f, 8, 8);
    expect(f).toEqual(copy);
    expect(out).not.toBe(f);
    expect(out).toHaveLength(f.length);
  });
  it("rejects a buffer of the wrong size or zero size", () => {
    expect(() => unveilRgba(new Uint8ClampedArray(7), 2, 1)).toThrow();
    expect(() => unveilRgba(new Uint8ClampedArray(0), 0, 0)).toThrow();
  });
});

describe("applyVeil: the three modes", () => {
  const veiled = { data: veil(scene(31, 0, 255)), width: W, height: H };
  const normal = { data: scene(32, 0, 255), width: W, height: H };
  it("off leaves the picture alone", () => {
    for (const img of [veiled, normal]) {
      const r = applyVeil(img, "off", DEFAULT_VEIL_OPTIONS);
      expect(r.applied).toBe(false);
      expect(r.data).toBe(img.data);
    }
  });
  it("auto undoes a veiled frame and leaves a normal one alone", () => {
    const a = applyVeil(veiled, "auto", DEFAULT_VEIL_OPTIONS);
    expect(a.applied).toBe(true);
    expect(a.data).toEqual(unveilRgba(veiled.data, W, H));
    const b = applyVeil(normal, "auto", DEFAULT_VEIL_OPTIONS);
    expect(b.applied).toBe(false);
    expect(b.data).toBe(normal.data);
  });
  it("on undoes every frame, even one that does not look veiled", () => {
    const r = applyVeil(normal, "on", DEFAULT_VEIL_OPTIONS);
    expect(r.applied).toBe(true);
    expect(r.data).toEqual(unveilRgba(normal.data, W, H));
  });
  it("never mutates the source", () => {
    const copy = new Uint8ClampedArray(veiled.data);
    applyVeil(veiled, "on", DEFAULT_VEIL_OPTIONS);
    expect(veiled.data).toEqual(copy);
  });
  it("an unusable picture falls back to the original instead of throwing", () => {
    const broken = { data: new Uint8ClampedArray(3), width: 10, height: 10 };
    const r = applyVeil(broken, "on", DEFAULT_VEIL_OPTIONS);
    expect(r.applied).toBe(false);
    expect(r.data).toBe(broken.data);
    expect(r.error).toBeTruthy();
  });
});
