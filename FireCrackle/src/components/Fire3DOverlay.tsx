import { useEffect, useRef, useState, type PointerEvent } from "react";
import { screenToQuadPoint } from "../lib/quadMask";
import { addClick, axisLines, cursorGround, fireOutline, fireTexels, groundGrid, isClick, moveClick, newFire, placeFire, removeClick, usableClicks, type Vec3 } from "../lib/fireTool";
import { blocksVideoToolKeys, type ShortcutTarget } from "../lib/shortcutFocus";
import { hitPlaneY, project, type CameraPose } from "../lib/reversal";
import { atlasTile, type AnimationAtlas } from "../lib/animationAtlases";
import { loadSpriteSheet, spriteShape, spriteSource } from "../lib/spriteSheet";
import { useSvgScreenScale } from "../hooks/useSvgScreenScale";
import type { Fire3D } from "../lib/useFire3D";
import { FireTexels } from "./FireTexels";
import { CompressedFire } from "./CompressedQuad";
import { compressionGeometry, type CompressionSettings } from "../lib/compressionPreview";
import { rasterizeTexels } from "../lib/quadRaster";
import { spriteAtPhase, spritePhase } from "../lib/phaseConsensus";
import "./Fire3DOverlay.css";

export interface SpriteChoice { atlas?: AnimationAtlas; sheet: 0 | 1; row: number; mirrored: boolean; opacity: number; pixelGrid: boolean; }

/** The height the grid and clicks work on: the fire's floor, else the first corner's. */
export function workingY(fire: Fire3D): number | null {
  const f = fire.state.fire;
  if (f) return f.mode === "entity" ? f.feet[1] : f.cell[1];
  return usableClicks(fire.state)[0]?.world[1] ?? null;
}

/** Delete removes the selected corner (not while typing in a box, not with a modifier). True when it did. */
export function cornerKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; target: unknown; preventDefault(): void }, fire: Fire3D): boolean {
  if (e.key !== "Delete" || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || fire.selected === null || blocksVideoToolKeys(e.target as ShortcutTarget | null)) return false;
  e.preventDefault();
  removeCorner(fire, fire.selected);
  return true;
}
function removeCorner(fire: Fire3D, id: number) {
  fire.update(s => removeClick(s, id));
  fire.setSelected(null);
}

/** The x and z on the grid's floor under the cursor (and that floor's y), next to the cursor, so a corner's position
 * is read off the picture rather than counted. Its own component: only it re-renders as the mouse moves. `at` (native
 * pixels) shows a fixed point instead of following the mouse; `nativeAt` turns a screen point into native pixels. */
export function CursorReadout({ camera, native, y, scaleX, scaleY, screenScale, at, nativeAt }: { camera: CameraPose; native: { width: number; height: number };
  y: number; scaleX: number; scaleY: number; screenScale: number; at?: [number, number] | null; nativeAt?: (x: number, y: number) => [number, number] | null }) {
  const [hover, setHover] = useState<[number, number] | null>(null);
  useEffect(() => {
    if (!nativeAt) return;
    const move = (e: globalThis.PointerEvent) => setHover(nativeAt(e.clientX, e.clientY));
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, [nativeAt]);
  const p = at ?? hover;
  const g = p ? cursorGround(camera, native.width, native.height, p, y) : null;
  if (!p || !g) return null;
  const n = (v: number) => String(Number(v.toFixed(1)));
  return <g className="fire3d-cursor" pointerEvents="none">
    <text x={p[0] * scaleX + 14 / screenScale} y={p[1] * scaleY - 12 / screenScale} fontSize={14 / screenScale} strokeWidth={3 / screenScale} pointerEvents="none">
      {`x ${n(g.x)} · z ${n(g.z)} (y ${n(y)})`}</text>
  </g>;
}

/** The 3D quad tool on the video: the fire's planes textured with the chosen sprite, the block grid and the fire's
 * cell (or hitbox) to judge the camera by, and the clicked corners. A click adds a corner or places the fire.
 * `width` × `height` is the displayed picture; the camera works in the native picture (`fire.size`). */
export function Fire3DOverlay({ fire, width, height, zoom, sprite, compression, frameUrl }: { fire: Fire3D; width: number; height: number; zoom: number; sprite: SpriteChoice;
  /** FFmpeg compression preview, as the quad mask's: every plane's texels, all 32 rows, through H.264. */
  compression?: CompressionSettings; frameUrl?: string }) {
  const svg = useRef<SVGSVGElement>(null);
  const screenScale = useSvgScreenScale(svg, width, height, zoom);
  const source = spriteSource(sprite.atlas, sprite.sheet);
  const [sheet, setSheet] = useState<{ source: string; rgba: Uint8ClampedArray } | null>(null);
  // the fire's other sheet, for the planes the model draws from it (an entity's alternate layers): fire sheets only
  const otherSheet = (1 - sprite.sheet) as 0 | 1, otherSource = sprite.atlas ? null : spriteSource(undefined, otherSheet);
  const [other, setOther] = useState<{ source: string; rgba: Uint8ClampedArray } | null>(null);
  // Delete removes the selected corner (Backspace stays Label's "remove this frame's label")
  const latest = useRef(fire); latest.current = fire;
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (!e.defaultPrevented) cornerKey(e, latest.current); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => loadSpriteSheet(sprite.atlas, source, { reset: () => setSheet(null), ready: rgba => setSheet({ source, rgba }), failed: () => setSheet(null) }), [sprite.atlas, source]);
  useEffect(() => otherSource ? loadSpriteSheet(undefined, otherSource, { reset: () => setOther(null), ready: rgba => setOther({ source: otherSource, rgba }), failed: () => setOther(null) }) : undefined, [otherSource]);
  const native = fire.size, cam = fire.state.camera;
  if (!native) return null;
  const sx = width / native.width, sy = height / native.height;
  const y = workingY(fire);
  const centre: Vec3 | null = fire.state.fire ? (fire.state.fire.mode === "entity" ? fire.state.fire.feet : fire.state.fire.cell) : usableClicks(fire.state)[0]?.world ?? null;
  const grid = fire.showGrid && cam && centre && y !== null ? groundGrid(cam, native.width, native.height, [centre[0], y, centre[2]], 8) : [];
  const outline = fire.showBox && cam && fire.state.fire ? fireOutline(fire.state.fire) : [];
  // which way + is: Minecraft's axes from the origin corner (else the fire)
  const origin = usableClicks(fire.state)[0]?.world ?? centre;
  const axes = cam && origin ? axisLines(cam, origin, native.width, native.height) : [];
  const outlinePx = cam ? project(cam, outline.flat(), native.width, native.height) : [];
  const { side, rows } = spriteShape(sprite.atlas);
  const row = sprite.atlas ? atlasTile(sprite.atlas, sprite.row) : sprite.row;
  // the other sheet's row showing the same animation phase (sheet 1 runs 16 frames ahead)
  const otherAt = (r: number) => otherSource && other?.source === otherSource ? { rgba: other.rgba, row: spriteAtPhase(otherSheet, spritePhase(sprite.sheet, r)) } : undefined;
  // the compression preview (fire sheets only, like the quad mask's): encoded at the delivery size, per geometry
  const compressed = compression && frameUrl && !sprite.atlas && sheet?.source === source
    ? { ...compressionGeometry(width, height, compression.height, [[0, 0], [1, 0], [1, 1], [0, 1]]),
        key: JSON.stringify(["3d", source, sprite.mirrored, fire.quads.map(q => q.px?.map(p => p.map(v => Math.round(v * 100) / 100)))]) }
    : null;
  // every texel of every plane, far to near (the game's depth buffer): the planes cross each other
  let texels: ReturnType<typeof fireTexels> = [];
  if (sheet?.source === source && cam) {
    try { texels = fireTexels(fire.quads, sheet.rgba, row, sprite.mirrored, native.width, native.height, [cam.x, cam.y, cam.z], side, rows, otherAt(row)); } catch { texels = []; }
  }
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
    {grid.map((l, i) => <line key={`g${i}`} className="fire3d-grid" strokeWidth={1 / screenScale} x1={l[0][0] * sx} y1={l[0][1] * sy} x2={l[1][0] * sx} y2={l[1][1] * sy} />)}
    {compressed && cam
      ? <CompressedFire cycleKey={compressed.key} row={sprite.row} width={compressed.width} height={compressed.height} displayWidth={width} displayHeight={height}
          opacity={sprite.opacity} quality={compression!.quality}
          raster={(r, white) => rasterizeTexels(fireTexels(fire.quads, sheet!.rgba, r, sprite.mirrored, native.width, native.height, [cam.x, cam.y, cam.z], side, rows, otherAt(r)), compressed.width, compressed.height, white)} />
      : <g opacity={sprite.opacity}><FireTexels texels={texels} pixelGrid={sprite.pixelGrid} scaleX={width} scaleY={height} screenScale={screenScale} /></g>}
    {outline.map((_, i) => {
      const a = outlinePx[2 * i], b = outlinePx[2 * i + 1];
      return a && b && <line key={`o${i}`} className="fire3d-cell" strokeWidth={1.5 / screenScale} x1={a[0] * sx} y1={a[1] * sy} x2={b[0] * sx} y2={b[1] * sy} />;
    })}
    {axes.map(a => <g key={a.axis} className={`fire3d-axis ${a.axis}`}>
      <line strokeWidth={2.5 / screenScale} x1={a.from[0] * sx} y1={a.from[1] * sy} x2={a.to[0] * sx} y2={a.to[1] * sy} />
      <text className="fire3d-axis-label" x={a.to[0] * sx + 4 / screenScale} y={a.to[1] * sy - 4 / screenScale} fontSize={13 / screenScale} strokeWidth={3 / screenScale}>{a.label}</text>
    </g>)}
    {fire.click !== "none" && <text className="fire3d-mode" x={width / 2} y={22 / screenScale} fontSize={15 / screenScale} strokeWidth={3 / screenScale} textAnchor="middle">
      {fire.click === "corner" ? "Click: add a block corner" : "Click: place the fire"}</text>}
    {cam && y !== null && <CursorReadout camera={cam} native={native} y={y} scaleX={sx} scaleY={sy} screenScale={screenScale} nativeAt={nativeAt} />}
    {fire.state.clicks.map((c, i) => <g key={c.id} className={`fire3d-click${c.world ? "" : " pending"}${fire.selected === c.id ? " selected" : ""}`}
      onPointerDown={e => grab(e, c.id)} onContextMenu={e => { e.preventDefault(); e.stopPropagation(); removeCorner(fire, c.id); }}>
      <title>{`Corner ${i + 1}: click to edit its position, drag to move it, right-click (or Delete when selected) to remove it`}</title>
      <circle cx={c.px[0] * sx} cy={c.px[1] * sy} r={6 / screenScale} strokeWidth={1.5 / screenScale} />
      <text x={c.px[0] * sx + 9 / screenScale} y={c.px[1] * sy - 8 / screenScale} fontSize={15 / screenScale} strokeWidth={3 / screenScale}>{i + 1}</text>
    </g>)}
  </svg>;
}
