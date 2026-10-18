import { ANIMATION_ATLASES, soulFire, type AnimationAtlas } from "./animationAtlases";
import type { PreviewSprite } from "./firePreview";
export interface EdgeCounts { left: number; right: number; bottomWhite?: number }
export interface EdgeFilter { left: number | null; right: number | null; bottomWhiteMin?: number | null; bottomWhiteMax?: number | null; excluded?: number[] }
export type AtlasEdges = [EdgeCounts[], EdgeCounts[]];
/** Include almost-white texels, while leaving visibly yellow creams outside the reference count. */
export const BOTTOM_WHITE_CHANNEL_MIN = 245;
export const appearanceId = (sheet: 0 | 1, row: number, mirrored: boolean) => sheet * 64 + Number(mirrored) * 32 + row;
export function matchesAppearance(edges: AtlasEdges | null, sheet: 0 | 1, row: number, mirrored: boolean, filter: EdgeFilter): boolean {
  if (filter.excluded?.includes(appearanceId(sheet, row, mirrored))) return false;
  if (filter.left === null && filter.right === null && filter.bottomWhiteMin == null && filter.bottomWhiteMax == null) return true;
  return edges !== null && matchesEdges(appearanceEdges(edges, sheet, row, mirrored), filter);
}
/** A complete cycle visits every sheet, mirror and animation row once. */
export function animationPool(edges: AtlasEdges | null, filter?: EdgeFilter, atlas?: AnimationAtlas): PreviewSprite[] {
  const pool: PreviewSprite[] = [];
  if (atlas) {
    const sources: AnimationAtlas[] = soulFire(atlas) ? ["soul_fire_0", "soul_fire_1"] : [atlas];
    for (const source of sources) for (const mirrored of [false, true]) for (let row = 0; row < ANIMATION_ATLASES[source].rows; row++) {
      const sheet = source.endsWith("_0") || source.endsWith("_still") ? 0 : 1;
      pool.push({ atlas: source, sheet, row, mirrored });
    }
    return pool;
  }
  for (const sheet of [0, 1] as const) for (const mirrored of [false, true]) for (let row = 0; row < 32; row++) {
    if (!filter || matchesAppearance(edges, sheet, row, mirrored, filter)) pool.push({ sheet, row, mirrored });
  }
  return pool;
}
export function nextAppearance(pool: PreviewSprite[], current: PreviewSprite, direction = 1): PreviewSprite | null {
  if (!pool.length) return null;
  const index = pool.findIndex(sprite => sprite.atlas === current.atlas && appearanceId(sprite.sheet, sprite.row, sprite.mirrored) === appearanceId(current.sheet, current.row, current.mirrored));
  return pool[index < 0 ? direction > 0 ? 0 : pool.length - 1 : (index + direction + pool.length) % pool.length];
}

/** Edge counts use visible alpha. Bottom white totals opaque texels with every RGB channel >=245 on y=15.
 * User-entered inclusive bounds express uncertainty in the footage; no colour threshold is inferred from it.
 */
export function sheetEdgeCounts(rgba: Uint8ClampedArray): EdgeCounts[] {
  return spriteSheetEdgeCounts(rgba,16,32);
}
export function spriteSheetEdgeCounts(rgba: Uint8ClampedArray,side:number,rows:number): EdgeCounts[] {
  if (![16,32].includes(side)||!Number.isInteger(rows)||rows<1||rgba.length !== side*side*rows*4) throw new Error("Invalid animation sprite sheet");
  return Array.from({ length: rows }, (_, row) => {
    let left = 0, right = 0;
    for (let y = row * side; y < row * side + side; y++) {
      if (rgba[(y * side) * 4 + 3] > 0) left++;
      if (rgba[(y * side + side-1) * 4 + 3] > 0) right++;
    }
    let bottomWhite = 0;
    for (let x = 0; x < side; x++) {
      const i = ((row * side + side-1) * side + x) * 4;
      if (rgba[i + 3] === 255 && rgba[i] >= BOTTOM_WHITE_CHANNEL_MIN && rgba[i + 1] >= BOTTOM_WHITE_CHANNEL_MIN && rgba[i + 2] >= BOTTOM_WHITE_CHANNEL_MIN) bottomWhite++;
    }
    return { left, right, bottomWhite };
  });
}
export function appearanceEdges(edges: AtlasEdges, sheet: 0 | 1, row: number, mirrored: boolean): EdgeCounts {
  const counts = edges[sheet][row];
  return mirrored ? { ...counts, left: counts.right, right: counts.left } : counts;
}
export function matchesEdges(counts: EdgeCounts, filter: EdgeFilter): boolean {
  return (filter.left === null || filter.left === counts.left) && (filter.right === null || filter.right === counts.right)
    && (filter.bottomWhiteMin == null || (counts.bottomWhite !== undefined && counts.bottomWhite >= filter.bottomWhiteMin))
    && (filter.bottomWhiteMax == null || (counts.bottomWhite !== undefined && counts.bottomWhite <= filter.bottomWhiteMax));
}
export function edgeFilterValue(value: string,max=16): number | null {
  if (!value.trim()) return null;
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 && count <= max ? count : null;
}
export function matchingAppearances(edges: AtlasEdges, filter: EdgeFilter): number {
  let matches = 0;
  for (const sheet of [0, 1] as const) for (let row = 0; row < edges[sheet].length; row++) for (const mirrored of [false, true]) {
    if (matchesAppearance(edges, sheet, row, mirrored, filter)) matches++;
  }
  return matches;
}
