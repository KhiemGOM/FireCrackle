// Width of the 3D quad's world panel beside the video. The video stays the main panel: the side panel is kept between
// a minimum and a share of the space.
export const SIDE_MIN = 220;
export const SIDE_MAX_SHARE = 0.5;
export const SIDE_DEFAULT = 380;

export function clampSideWidth(width: number, space: number): number {
  const w = Number.isFinite(width) ? width : SIDE_DEFAULT;
  if (!Number.isFinite(space)) return Math.max(SIDE_MIN, Math.round(w));
  return Math.round(Math.max(SIDE_MIN, Math.min(w, space * SIDE_MAX_SHARE)));
}
