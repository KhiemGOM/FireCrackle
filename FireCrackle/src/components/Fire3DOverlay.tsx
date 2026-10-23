import { useRef, type PointerEvent } from "react";
import { screenToQuadPoint } from "../lib/quadMask";
import { addClick, groundGrid, usableClicks } from "../lib/fireTool";
import type { Fire3D } from "../lib/useFire3D";
import "./Fire3DOverlay.css";

const pts = (p: [number, number][], sx: number, sy: number) => p.map(([x, y]) => `${x * sx},${y * sy}`).join(" ");

/** Label's 3D quad mode on the video: the block grid, every fire plane (the one used as the manual quad
 * highlighted) and the clicked corners, all from the solved camera. While picking, a click adds a block corner.
 * `width` × `height` is the displayed picture; the camera works in the native frame (`fire.size`). */
export function Fire3DOverlay({ fire, width, height }: { fire: Fire3D; width: number; height: number }) {
  const svg = useRef<SVGSVGElement>(null);
  const native = fire.size;
  if (!native) return null;
  const sx = width / native.width, sy = height / native.height;
  const cam = fire.state.camera;
  const clicks = usableClicks(fire.state);
  const centre = fire.state.placements[0]
    ? (fire.state.placements[0].kind === "block" ? fire.state.placements[0].pos : fire.state.placements[0].feet)
    : clicks[0]?.world;
  const grid = cam && centre ? groundGrid(cam, native.width, native.height, [centre[0], centre[1], centre[2]], 6) : [];
  function down(e: PointerEvent<SVGSVGElement>) {
    if (!fire.picking || e.button !== 0) return;
    const m = svg.current?.getScreenCTM();
    const p = m ? screenToQuadPoint(m, e.clientX, e.clientY, width, height) : null;
    if (!p || p[0] < 0 || p[1] < 0 || p[0] > 1 || p[1] > 1) return;
    e.stopPropagation();
    e.preventDefault();
    fire.setState(s => addClick(s, [p[0] * native!.width, p[1] * native!.height]));
  }
  return <svg ref={svg} className={`fire3d-overlay${fire.picking ? " picking" : ""}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet"
    aria-label={fire.picking ? "Click a block corner" : "3D fire planes"} onPointerDown={down}>
    {grid.map((l, i) => <line key={i} className="fire3d-grid" x1={l[0][0] * sx} y1={l[0][1] * sy} x2={l[1][0] * sx} y2={l[1][1] * sy} />)}
    {fire.planes.map(({ placement, quads }) => quads.map((q, i) => q.px && <polygon key={`${placement}-${i}`}
      className={`fire3d-plane${fire.choice?.placement === placement && fire.choice.plane === i ? " chosen" : ""}`} points={pts(q.px, sx, sy)} />))}
    {fire.state.clicks.map((c, i) => <g key={c.id} className={`fire3d-click${c.world ? "" : " pending"}`}>
      <circle cx={c.px[0] * sx} cy={c.px[1] * sy} r={5} /><text x={c.px[0] * sx + 7} y={c.px[1] * sy - 6}>{i + 1}</text>
    </g>)}
  </svg>;
}
