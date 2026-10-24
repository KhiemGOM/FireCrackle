// Match for the 3D quad: each of the fire's planes is a 2D quad for the app's matcher (lib/quadMatch.ts); the planes
// vote on their shared phase and agree on one sprite (lib/phaseConsensus.ts). A plane seen from behind shows its sprite
// flipped, so its candidates' mirror is turned into the tool's own mirror setting; and a plane drawn from the other
// sheet by the model (an entity's fire layers alternate fire_0 and fire_1) shows the same phase on that sheet.
// @ts-expect-error Node-only test API; the browser project intentionally excludes Node types.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { matchFirePlanes, matchPicture } from "./fire3dMatch";
import { rasterizeFire } from "./quadRaster";
import { matchFireQuad } from "./quadMatch";
import { spriteAtPhase } from "./phaseConsensus";
import type { ManualQuad } from "./quadMask";

let sheets: [Uint8ClampedArray, Uint8ClampedArray];
beforeAll(() => {
  sheets = [0, 1].map(i => new Uint8ClampedArray(readFileSync(new URL(`../../../fire-detection/data/assets/fire_${i}.rgba`, import.meta.url)))) as [Uint8ClampedArray, Uint8ClampedArray];
});

const W = 960, H = 540;
/** Three planes at different angles; the second is seen from behind (its sprite drawn flipped); the last two are drawn
 * from the other sheet (most of the planes: a plane-blind vote would pick the wrong sheet). */
const planes: { quad: ManualQuad; mirrored: boolean; sheet: 0 | 1 }[] = [
  { quad: [[0.2, 0.3], [0.38, 0.33], [0.37, 0.7], [0.21, 0.66]], mirrored: false, sheet: 0 },
  { quad: [[0.42, 0.28], [0.6, 0.3], [0.61, 0.69], [0.43, 0.68]], mirrored: true, sheet: 1 },
  { quad: [[0.64, 0.32], [0.8, 0.29], [0.79, 0.67], [0.65, 0.7]], mirrored: false, sheet: 1 },
];
/** A dark noisy frame with the planes painted as the game would: the tool's sprite (sheet, phase, mirror) on every
 * plane, each on its own sheet. */
function frame(sheet: 0 | 1, phase: number, mirrored: boolean, junk = -1, hiddenAbove = 0) {
  const data = new Uint8ClampedArray(W * H * 4);
  let s = 7;
  for (let i = 0; i < data.length; i += 4) { s = (s * 1103515245 + 12345) % 2147483648; const v = 30 + (s % 40); data.set([v + 20, v, v], i); data[i + 3] = 255; }
  planes.forEach((p, k) => {
    const own = (sheet ^ p.sheet) as 0 | 1;
    const layer = rasterizeFire(sheets[own], spriteAtPhase(own, phase), mirrored !== p.mirrored, p.quad, W, H);
    for (let i = 0; i < data.length; i += 4) if (layer[i + 3] > 0 && Math.floor(i / 4 / W) >= H * hiddenAbove) data.set(k === junk ? [90, 90, 255, 255] : [layer[i], layer[i + 1], layer[i + 2], 255], i);
  });
  return { width: W, height: H, data };
}

describe("matchFirePlanes", () => {
  it("finds the phase, sheet and mirror shared by every plane, a back-facing and an other-sheet plane included", () => {
    for (const [sheet, phase, mirrored] of [[0, 5, false], [1, 20, true]] as const) {
      const m = matchFirePlanes(frame(sheet, phase, mirrored), sheets, planes)!;
      expect(m.candidates[0]).toMatchObject({ phase, sheet, row: spriteAtPhase(sheet, phase), mirrored });
      expect(m.planes).toBe(3);
    }
  });
  it("offers three tries, best first: a confident vote, three sprites at its phase", () => {
    const m = matchFirePlanes(frame(0, 9, false), sheets, planes)!;
    expect(m.confident).toBe(true);
    expect(m.candidates).toHaveLength(3);
    expect(m.candidates.every(c => c.phase === 9)).toBe(true);
    expect(new Set(m.candidates.map(c => `${c.sheet}${c.mirrored}`)).size).toBe(3);
    expect(m.candidates[0]).toMatchObject({ sheet: 0, mirrored: false });
  });
  it("a plane covered by something else does not stop the others from deciding", () => {
    const m = matchFirePlanes(frame(0, 12, false, 1), sheets, planes)!;
    expect(m.candidates[0]).toMatchObject({ phase: 12, sheet: 0, mirrored: false });
  });
  it("planes only partly visible still vote: too little for the matcher to trust alone, but the vote was measured with them", () => {
    // only the base of each plane shows (the top is behind something): the matcher alone calls each one insufficient
    const image = frame(0, 5, false, -1, 0.66);
    for (const p of planes) expect(matchFireQuad(image, sheets, p.quad, { refineGeometry: false, phaseEvidence: true }).status).toBe("insufficient");
    const m = matchFirePlanes(image, sheets, planes);
    expect(m).not.toBeNull();
    expect(m!.planes).toBe(3);
    expect(m!.candidates.some(c => c.phase === 5)).toBe(true);
  });
  it("no planes, or none the matcher can read, give no answer", () => {
    expect(matchFirePlanes(frame(0, 3, false), sheets, [])).toBeNull();
    expect(matchFirePlanes(frame(0, 3, false), sheets, [{ quad: [[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001]], mirrored: false }])).toBeNull();
  });
});

describe("matchPicture (the picture worker's match3d task)", () => {
  it("decodes the native frame and matches its planes", async () => {
    const image = frame(1, 7, false);
    const m = await matchPicture({ bytes: new ArrayBuffer(8), sheets, planes }, { decode: async () => image });
    expect(m!.candidates[0]).toMatchObject({ phase: 7, sheet: 1, mirrored: false });
  });
});
