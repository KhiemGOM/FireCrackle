import { useEffect, useRef, useState, type PointerEvent } from "react";
import { manualTexels, screenToQuadPoint } from "../lib/quadMask";
import { addClick, fireOutline, groundGrid, isClick, moveClick, newFire, placeFire, planeToManualQuad, usableClicks, type Vec3 } from "../lib/fireTool";
import { hitPlaneY, project } from "../lib/reversal";
import { atlasTile, type AnimationAtlas } from "../lib/animationAtlases";
import { loadSpriteSheet, spriteShape, spriteSource } from "../lib/spriteSheet";
import { useSvgScreenScale } from "../hooks/useSvgScreenScale";
import type { Fire3D } from "../lib/useFire3D";
import { FireTexels } from "./FireTexels";
import "./Fire3DOverlay.css";

export interface SpriteChoice { atlas?: AnimationAtlas; sheet: 0 | 1; row: number; mirrored: boolean; opacity: number; pixelGrid: boolean; }

/** The height the grid and clicks work on: the fire's floor, else the first corner's. */
export function workingY(fire: Fire3D): number | null {
  const f = fire.state.fire;
  if (f) return f.mode === "entity" ? f.feet[1] : f.cell[1];
  return usableClicks(fire.state)[0]?.world[1] ?? null;
}

/** The 3D quad tool on the video: the fire's planes textured with the chosen sprite, the block grid and the fire's
 * cell (or hitbox) to judge the camera by, and the clicked corners. A click adds a corner or places the fire.
 * `width` × `height` is the displayed picture; the camera works in the native picture (`fire.size`). */
export function Fire3DOverlay({ fire, width, height, zoom, sprite }: { fire: Fire3D; width: number; height: number; zoom: number; sprite: SpriteChoice }) {
  const svg = useRef<SVGSVGElement>(null);
  const screenScale = useSvgScreenScale(svg, width, height, zoom);
  const source = spriteSource(sprite.atlas, sprite.sheet);
  const [sheet, setSheet] = useState<{ source: string; rgba: Uint8ClampedArray } | null>(null);
  useEffect(() => loadSpriteSheet(sprite.atlas, source, { reset: () => setSheet(null), ready: rgba => setSheet({ source, rgba }), failed: () => setSheet(null) }), [sprite.atlas, source]);
  const native = fire.size, cam = fire.state.camera;
  if (!native) return null;
  const sx = width / native.width, sy = height / native.height;
  const y = workingY(fire);
  const centre: Vec3 | null = fire.state.fire ? (fire.state.fire.mode === "entity" ? fire.state.fire.feet : fire.state.fire.cell) : usableClicks(fire.state)[0]?.world ?? null;
  const grid = cam && centre && y !== null ? groundGrid(cam, native.width, native.height, [centre[0], y, centre[2]], 8) : [];
  const outline = cam && fire.state.fire ? fireOutline(fire.state.fire) : [];
  const outlinePx = cam ? project(cam, outline.flat(), native.width, native.height) : [];
  const { side, rows } = spriteShape(sprite.atlas);
  const row = sprite.atlas ? atlasTile(sprite.atlas, sprite.row) : sprite.row;
  const planes = sheet?.source === source ? fire.quads.flatMap(q => {
    const m = planeToManualQuad(q, native.width, native.height);
    if (!m) return [];
    try { return [manualTexels(sheet.rgba, row, m.mirrored !== sprite.mirrored, m.quad, side, rows)]; } catch { return []; }
  }) : [];
  /** Native pixel under a screen point, or null outside the picture. */
  const nativeAt = (x: number, y: number): [number, number] | null => {
    const m = svg.current?.getScreenCTM();
    const p = m ? screenToQuadPoint(m, x, y, width, height) : null;
    return p && p[0] >= 0 && p[1] >= 0 && p[0] <= 1 && p[1] <= 1 ? [p[0] * native!.width, p[1] * native!.height] : null;
  };
  function act(px: [number, number]) {
    if (fire.click === "corner") { fire.update(s => addClick(s, px)); return; }
    if (!cam || y === null) return;
    const at = hitPlaneY(cam, native!.width, native!.height, px[0], px[1], y);
    if (at) fire.update(s => ({ ...s, fire: s.fire ? placeFire(s.fire, at) : newFire(cam, at) }));
  }
  // a click adds a corner or places the fire; a drag is left to the picture (pan), so nothing is stopped here
  function down(e: PointerEvent<SVGSVGElement>) {
    if (fire.click === "none" || e.button !== 0) return;
    const start: [number, number] = [e.clientX, e.clientY], px = nativeAt(e.clientX, e.clientY);
    if (!px) return;
    const up = (u: globalThis.PointerEvent) => { window.removeEventListener("pointerup", up, true); if (isClick(start, [u.clientX, u.clientY])) act(px); };
    window.addEventListener("pointerup", up, true);
  }
  // a corner marker: click to edit it, drag to move it
  function grab(e: PointerEvent<SVGGElement>, id: number) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    fire.setSelected(id);
    const target = e.currentTarget;
    try { target.setPointerCapture(e.pointerId); } catch { /* moves still arrive while over it */ }
    const move = (m: globalThis.PointerEvent) => { const px = nativeAt(m.clientX, m.clientY); if (px) fire.update(s => moveClick(s, id, px)); };
    const up = () => { target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", up); target.removeEventListener("pointercancel", up); };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  }
  return <svg ref={svg} className={`fire3d-overlay${fire.click !== "none" ? " picking" : ""}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet"
    aria-label="3D quad on the picture" onPointerDown={down}>
    {grid.map((l, i) => <line key={`g${i}`} className="fire3d-grid" x1={l[0][0] * sx} y1={l[0][1] * sy} x2={l[1][0] * sx} y2={l[1][1] * sy} />)}
    <g opacity={sprite.opacity}>{planes.map((t, i) => <FireTexels key={i} texels={t} pixelGrid={sprite.pixelGrid} scaleX={width} scaleY={height} screenScale={screenScale} />)}</g>
    {outline.map((_, i) => {
      const a = outlinePx[2 * i], b = outlinePx[2 * i + 1];
      return a && b && <line key={`o${i}`} className="fire3d-cell" x1={a[0] * sx} y1={a[1] * sy} x2={b[0] * sx} y2={b[1] * sy} />;
    })}
    {fire.state.clicks.map((c, i) => <g key={c.id} className={`fire3d-click${c.world ? "" : " pending"}${fire.selected === c.id ? " selected" : ""}`}
      onPointerDown={e => grab(e, c.id)}>
      <title>{`Corner ${i + 1}: click to edit its position, drag to move it`}</title>
      <circle cx={c.px[0] * sx} cy={c.px[1] * sy} r={6 / screenScale} />
      <text x={c.px[0] * sx + 9 / screenScale} y={c.px[1] * sy - 8 / screenScale} fontSize={15 / screenScale} strokeWidth={3 / screenScale}>{i + 1}</text>
    </g>)}
  </svg>;
}
