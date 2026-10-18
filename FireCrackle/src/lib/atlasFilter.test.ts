import { expect, it } from "vitest";
import { animationPool, appearanceId, nextAppearance, appearanceEdges, edgeFilterValue, matchesEdges, matchingAppearances, sheetEdgeCounts, spriteSheetEdgeCounts, type AtlasEdges } from "./atlasFilter";

it('keeps the fire map callback compatible and counts 32px fluid edges at native size',()=>{
 const fire=new Uint8ClampedArray(16*16*32*4);
 expect([fire,fire].map(sheetEdgeCounts).map(rows=>rows.length)).toEqual([32,32]);
 const fluid=new Uint8ClampedArray(32*32*16*4);
 for(let y=0;y<32;y++)fluid[(y*32+31)*4+3]=255;
 expect(spriteSheetEdgeCounts(fluid,32,16)[0].right).toBe(32);
 expect(spriteSheetEdgeCounts(fluid,32,16)).toHaveLength(16);
});

it("counts only visible pixels at x=0 and x=15, in each animation row", () => {
  const rgba = new Uint8ClampedArray(16 * 512 * 4);
  for (let y = 0; y < 3; y++) rgba[(y * 16) * 4 + 3] = 255;
  for (let y = 4; y < 11; y++) rgba[(y * 16 + 15) * 4 + 3] = 255;
  rgba[(16 * 16) * 4 + 3] = 1; // Any visible alpha counts, including translucent pixels.
  rgba[(17 * 16 + 7) * 4 + 3] = 255; // Interior pixel must not affect either edge.
  rgba[(20 * 16) * 4] = 255; // RGB under transparent alpha must not count.
  const rows = sheetEdgeCounts(rgba);
  expect(rows).toHaveLength(32);
  expect(rows[0]).toEqual({ left: 3, right: 7, bottomWhite: 0 });
  expect(rows[1]).toEqual({ left: 1, right: 0, bottomWhite: 0 });
  expect(rows[31]).toEqual({ left: 0, right: 0, bottomWhite: 0 });
  expect(() => sheetEdgeCounts(new Uint8ClampedArray(10))).toThrow();
});
it("totals separate bottom-row white and near-white patches, ignoring yellow cream, other rows and hidden white", () => {
  const rgba = new Uint8ClampedArray(16 * 512 * 4);
  for (const x of [0, 1, 5, 9, 10, 15]) rgba.set([255, 255, 255, 255], (15 * 16 + x) * 4);
  rgba.set([254, 253, 247, 255], (15 * 16 + 3) * 4);
  rgba.set([245, 245, 245, 255], (15 * 16 + 11) * 4); // Inclusive near-white boundary.
  rgba.set([255, 255, 244, 255], (15 * 16 + 12) * 4); // Every channel must pass.
  rgba.set([253, 249, 227, 255], (15 * 16 + 13) * 4); // Pale cream stays outside.
  rgba.set([255, 255, 255, 0], (15 * 16 + 4) * 4);
  rgba.set([255, 255, 255, 127], (15 * 16 + 6) * 4);
  rgba.set([255, 255, 255, 255], (14 * 16 + 7) * 4);
  rgba.set([255, 255, 255, 255], (31 * 16 + 8) * 4);
  const rows = sheetEdgeCounts(rgba);
  expect(rows[0].bottomWhite).toBe(8);
  expect(rows[1].bottomWhite).toBe(1);
  expect(rows[2].bottomWhite).toBe(0);
  expect(appearanceEdges([rows, rows], 0, 0, true).bottomWhite).toBe(8);
});
it("combines inclusive white bounds with edges, mirrors, exclusions and animation", () => {
  const edges: AtlasEdges = [Array.from({length: 32}, (_, row) => ({left: 3, right: 7, bottomWhite: row % 17})), Array.from({length: 32}, () => ({left: 2, right: 9, bottomWhite: 16}))];
  const filter = {left: 7, right: 3, bottomWhiteMin: 5, bottomWhiteMax: 7, excluded: [appearanceId(0, 5, true)]};
  const pool = animationPool(edges, filter);
  expect(pool.map(s => s.row)).toEqual([6, 7, 22, 23, 24]);
  expect(matchingAppearances(edges, filter)).toBe(5);
  expect(animationPool(null, {left: null, right: null, bottomWhiteMin: 0})).toHaveLength(0);
  expect(matchesEdges({left: 0, right: 0, bottomWhite: 0}, {left: null, right: null, bottomWhiteMax: 0})).toBe(true);
  expect(matchesEdges({left: 0, right: 0, bottomWhite: 16}, {left: null, right: null, bottomWhiteMin: 16})).toBe(true);
  expect(matchingAppearances(edges, {...filter, bottomWhiteMin: 8, bottomWhiteMax: 7})).toBe(0);
});

it("swaps edge counts for mirrored appearances and supports independent filters", () => {
  const edges: AtlasEdges = [Array.from({ length: 32 }, () => ({ left: 3, right: 7 })), Array.from({ length: 32 }, () => ({ left: 2, right: 9 }))];
  expect(appearanceEdges(edges, 0, 0, true)).toEqual({ left: 7, right: 3 });
  expect(matchingAppearances(edges, { left: null, right: null })).toBe(128);
  expect(matchingAppearances(edges, { left: 3, right: 7 })).toBe(32);
  expect(matchingAppearances(edges, { left: 7, right: 3 })).toBe(32);
  expect(matchingAppearances(edges, { left: 3, right: 9 })).toBe(0);
  expect(matchesEdges({ left: 0, right: 16 }, { left: 0, right: null })).toBe(true);
});

it("keeps zero distinct from Any and rejects invalid counts", () => {
  expect(edgeFilterValue("0")).toBe(0);
  expect(edgeFilterValue("16")).toBe(16);
  for (const value of ["", " ", "17", "-1", "2.5", "NaN"]) expect(edgeFilterValue(value)).toBeNull();
});
it("visits all 128 appearances once before wrapping, independent of filters when disabled", () => {
  const pool=animationPool(null);
  expect(new Set(pool.map(s=>appearanceId(s.sheet,s.row,s.mirrored))).size).toBe(128);
  expect(nextAppearance(pool,pool[127])).toEqual(pool[0]);
  expect(nextAppearance(pool,pool[0],-1)).toEqual(pool[127]);
  expect(nextAppearance([],pool[0])).toBeNull();
});
it("combines mirrored edge counts with reversible per-appearance exclusions", () => {
  const edges:AtlasEdges=[Array.from({length:32},()=>({left:3,right:7})),Array.from({length:32},()=>({left:2,right:9}))];
  const excluded=[appearanceId(0,0,true)];
  const filter={left:7,right:3,excluded};
  const pool=animationPool(edges,filter);
  expect(pool).toHaveLength(31);
  expect(pool.every(s=>s.sheet===0&&s.mirrored&&s.row!==0)).toBe(true);
  expect(matchingAppearances(edges,filter)).toBe(31);
  expect(animationPool(null,filter)).toHaveLength(0);
  expect(animationPool(null,{left:null,right:null,excluded})).toHaveLength(127);
  expect(animationPool(edges,{...filter,excluded:[]})).toHaveLength(32);
});

it.each([
  ["soul_fire_0", 128, 32], ["soul_fire_1", 128, 32],
  ["lava_still", 40, 20], ["lava_flow", 32, 16],
  ["water_still", 64, 32], ["water_flow", 64, 32],
] as const)("cycles valid %s appearances without normal-fire filters", (atlas, count, rows) => {
  const pool = animationPool(null, {left: 99, right: 99}, atlas);
  expect(pool).toHaveLength(count);
  expect(pool.every(s => s.atlas?.startsWith(atlas.startsWith("soul") ? "soul_fire" : atlas) && s.row >= 0 && s.row < rows)).toBe(true);
  expect(new Set(pool.map(s => `${s.atlas}:${s.row}:${s.mirrored}`)).size).toBe(count);
  expect(nextAppearance(pool, pool[count - 1])).toEqual(pool[0]);
  expect(nextAppearance(pool, pool[0], -1)).toEqual(pool[count - 1]);
  expect(nextAppearance(pool, {sheet: 0, row: 2, mirrored: false})).toEqual(pool[0]);
});
