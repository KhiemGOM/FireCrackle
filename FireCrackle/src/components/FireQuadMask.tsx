import {ANIMATION_ATLASES,atlasTile,type AnimationAtlas} from "../lib/animationAtlases";
import { loadSpriteSheet, spriteSource } from "../lib/spriteSheet";
import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from "react";
import { manualTexels, moveQuadCorner, screenToQuadPoint, translateQuad, type ManualQuad, type QuadPoint } from "../lib/quadMask";
import "./FireQuadMask.css";
import { FireTexels } from "./FireTexels";
import { CompressedQuad } from "./CompressedQuad";
import { compressionGeometry, type CompressionSettings } from "../lib/compressionPreview";
import { BOX_HANDLES, boxPoint, quadBounds, resizeQuad, rotateQuad, type BoxHandle } from "../lib/quadTransform";

interface Props {
  atlas?:AnimationAtlas;
  width: number;
  height: number;
  sheet: 0 | 1;
  row: number;
  mirrored: boolean;
  opacity: number;
  pixelGrid?: boolean;
  zoom?: number;
  compression?: CompressionSettings;
  frameUrl?: string;
  placementEnabled?: boolean;
  quad: ManualQuad;
  onQuad: (quad: ManualQuad) => void;
}

/** Independent manual reference: dragging it never edits a frame label. */
export function FireQuadMask({ atlas, width, height, sheet, row, mirrored, opacity, quad, onQuad, pixelGrid = false, zoom = 1, compression, frameUrl, placementEnabled = true }: Props) {
  const clipId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef<{ corner: number; pointerId: number; last: QuadPoint; offset: QuadPoint; matrix: DOMMatrix; width: number; height: number } | null>(null);
  const [selectedCorner, setSelectedCorner] = useState<number | null>(null);
  const latestQuad = useRef(quad);
  latestQuad.current = quad;
  const source=spriteSource(atlas,sheet);
  const [loaded, setRgba] = useState<{source:string;rgba:Uint8ClampedArray} | null>(null);
  const rgba=loaded?.source===source?loaded.rgba:null;
  const [error, setError] = useState(false);
  const [screenScale, setScreenScale] = useState(1);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [transformActive, setTransformActive] = useState(false);
  const transformDrag = useRef<{ quad: ManualQuad; pointerId: number; start: QuadPoint; handle: BoxHandle | null; matrix: DOMMatrix; width: number; height: number } | null>(null);
  useEffect(() => loadSpriteSheet(atlas, source, {
    reset: () => { setRgba(null); setError(false); },
    ready: rgba => setRgba({ source, rgba }),
    failed: () => setError(true),
  }), [sheet,atlas,source]);
  const texels = useMemo(() => rgba ? manualTexels(rgba, atlas?atlasTile(atlas,row):row, mirrored, quad,atlas?ANIMATION_ATLASES[atlas].side:16,atlas?ANIMATION_ATLASES[atlas].rows:32) : [], [rgba, row, mirrored, quad,atlas]);
  const delivery = compression ? compressionGeometry(width,height,compression.height,quad) : null;
  const points = (p: Array<[number, number]>) => p.map(([x, y]) => `${x * width},${y * height}`).join(" ");

  function begin(e: PointerEvent<SVGElement>, corner: number, select: boolean) {
    if (e.button !== 0) return;
    const matrix = svgRef.current?.getScreenCTM();
    const point = matrix ? screenToQuadPoint(matrix, e.clientX, e.clientY, width, height) : null;
    if (!point || !matrix) return;
    e.stopPropagation();
    e.preventDefault();
    if (select) setSelectedCorner(corner);
    const anchor = latestQuad.current[corner];
    dragging.current = { corner, pointerId: e.pointerId, last: point, offset: [anchor[0] - point[0], anchor[1] - point[1]], matrix, width, height };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent<SVGSVGElement>) {
    const transform = transformDrag.current;
    if (transform) {
      if (e.pointerId !== transform.pointerId) return;
      e.stopPropagation();
      e.preventDefault();
      const point = screenToQuadPoint(transform.matrix, e.clientX, e.clientY, transform.width, transform.height);
      if (!point) return;
      const next = transform.handle
        ? resizeQuad(transform.quad, transform.handle, transform.start, point, width, height)
        : rotateQuad(transform.quad, transform.start, point, width, height);
      latestQuad.current = next;
      onQuad(next);
      return;
    }
    const drag = dragging.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.stopPropagation();
    const point = screenToQuadPoint(drag.matrix, e.clientX, e.clientY, drag.width, drag.height);
    if (!point || (point[0] === drag.last[0] && point[1] === drag.last[1])) return;
    const next = e.ctrlKey
      ? translateQuad(latestQuad.current, [point[0] - drag.last[0], point[1] - drag.last[1]])
      : moveQuadCorner(latestQuad.current, drag.corner, [point[0] + drag.offset[0], point[1] + drag.offset[1]]);
    drag.last = point;
    latestQuad.current = next;
    onQuad(next);
  }
  function stop(e: PointerEvent<SVGSVGElement>) {
    const active = dragging.current ?? transformDrag.current;
    if (active && e.pointerId !== active.pointerId) return;
    if (active) e.stopPropagation();
    dragging.current = null;
    transformDrag.current = null;
    setTransformActive(false);
  }
  function beginTransform(e: PointerEvent<SVGElement>, handle: BoxHandle | null) {
    if (e.button !== 0) return;
    const matrix = svgRef.current?.getScreenCTM();
    const start = matrix ? screenToQuadPoint(matrix, e.clientX, e.clientY, width, height) : null;
    if (!start || !matrix) return;
    e.preventDefault();
    e.stopPropagation();
    setSelectedCorner(null);
    transformDrag.current = { quad: latestQuad.current, pointerId: e.pointerId, start, handle, matrix, width, height };
    setTransformActive(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  // Alt+click places the selected corner once, including outside the image.
  useEffect(() => {
    const snap = (x: number, y: number) => {
      if (selectedCorner === null || dragging.current || transformDrag.current) return;
      const matrix = svgRef.current?.getScreenCTM();
      const point = matrix ? screenToQuadPoint(matrix, x, y, width, height) : null;
      if (point) {
        const next = moveQuadCorner(latestQuad.current, selectedCorner, point);
        latestQuad.current = next;
        onQuad(next);
      }
    };
    const click = (e: MouseEvent) => {
      if (!placementEnabled || !e.altKey || e.shiftKey || e.button !== 0 || selectedCorner === null || dragging.current || transformDrag.current) return;
      e.preventDefault();
      e.stopPropagation();
      snap(e.clientX, e.clientY);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedCorner(null);
      if (e.key === "Shift") setShiftHeld(true);
    };
    const keyUp = (e: KeyboardEvent) => { if (e.key === "Shift" || !e.shiftKey) setShiftHeld(false); };
    // A frame decode can remount this overlay while Shift is already held.
    const modifiers = (e: MouseEvent) => setShiftHeld(!!e.shiftKey);
    const blur = () => { setShiftHeld(false); setTransformActive(false); dragging.current = null; transformDrag.current = null; };
    window.addEventListener("click", click, true);
    // Capture before the mask toolbar suppresses key bubbling from focused controls.
    window.addEventListener("keydown", key, true);
    window.addEventListener("keyup", keyUp, true);
    window.addEventListener("pointermove", modifiers, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("click", click, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("keyup", keyUp, true);
      window.removeEventListener("pointermove", modifiers, true);
      window.removeEventListener("blur", blur);
    };
  }, [width, height, selectedCorner, onQuad, placementEnabled]);

  // Convert a screen-pixel handle size into SVG units, including image fit and zoom.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const measure = () => {
      const matrix = svg.getScreenCTM();
      if (!matrix) return;
      const scale = Math.hypot(matrix.a, matrix.b);
      if (Number.isFinite(scale) && scale > 0) setScreenScale(scale);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [width, height, zoom]);
  const transformMode = shiftHeld || transformActive;
  const bounds = quadBounds(quad);
  const rotationX = bounds.cx * width, rotationY = bounds.top * height - 28 / screenScale;
  return <>
    {error && <div className="hud-error" role="alert">Could not load the manual fire sprite.</div>}
    <svg ref={svgRef} className="fire-quad-mask" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet"
      aria-label="Manual fire matching mask: drag the four corner handles" onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop}>
      <defs><clipPath id={clipId}><rect width={width} height={height} /></clipPath></defs>
      <g opacity={compression ? 1 : opacity} clipPath={`url(#${clipId})`}>
        {compression && frameUrl && delivery ? rgba && <CompressedQuad rgba={rgba} quad={quad} row={row} mirrored={mirrored}
          width={delivery.width} height={delivery.height} displayWidth={width} displayHeight={height} opacity={opacity} quality={compression.quality} />
          : <FireTexels texels={texels} pixelGrid={pixelGrid} scaleX={width} scaleY={height} screenScale={screenScale} />}
        {compression && pixelGrid && <g fill="none">{texels.map((p,i)=><polygon key={i} points={points(p.points)} fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth={0.7 / screenScale} />)}</g>}
      </g>
      <polygon className="fire-quad-guide" points={points(quad)} strokeWidth={2 / screenScale} onPointerDown={(e) => { if (e.ctrlKey) begin(e, selectedCorner ?? 0, false); }} />
      {!transformMode && quad.map(([x, y], i) => <circle key={i} className={`fire-quad-handle${selectedCorner === i ? " selected" : ""}`} cx={x * width} cy={y * height}
        r={8 / screenScale} fill="#61e9ff" stroke="#10202a" strokeWidth={2 / screenScale}
        onPointerDown={(e) => begin(e, i, true)}>
        <title>{`Corner ${i + 1}: drag to move; Ctrl+drag moves all; select then Alt+click to place`}</title>
      </circle>)}
      {transformMode && <g className="quad-transform">
        <rect className="quad-transform-box" x={bounds.left * width} y={bounds.top * height} width={(bounds.right - bounds.left) * width} height={(bounds.bottom - bounds.top) * height} strokeWidth={1.5 / screenScale} strokeDasharray={`${4 / screenScale} ${3 / screenScale}`} />
        {BOX_HANDLES.map((handle, i) => {
          const [x, y] = boxPoint(quad, handle);
          const corner = !!(handle.x && handle.y);
          const cursor = corner ? (handle.x === handle.y ? "nwse-resize" : "nesw-resize") : handle.x ? "ew-resize" : "ns-resize";
          return <rect key={i} className="quad-transform-handle" x={x * width - 5 / screenScale} y={y * height - 5 / screenScale} width={10 / screenScale} height={10 / screenScale} strokeWidth={1.5 / screenScale} style={{ cursor }} onPointerDown={(e) => beginTransform(e, handle)}>
            <title>{corner ? "Resize proportionally from opposite corner" : handle.x ? "Resize width" : "Resize height"}</title>
          </rect>;
        })}
        <line className="quad-transform-box" x1={rotationX} y1={bounds.top * height} x2={rotationX} y2={rotationY} strokeWidth={1.5 / screenScale} />
        <g className="quad-rotate-handle" transform={`translate(${rotationX} ${rotationY}) scale(${1 / screenScale})`} onPointerDown={(e) => beginTransform(e, null)}>
          <circle r={11} strokeWidth={1.5} />
          <path d="M-5 0a5 5 0 1 1 4 5M-5-5v5h5" fill="none" strokeWidth={1.5} />
          <title>Rotate around the mask center</title>
        </g>
      </g>}
    </svg>
  </>;
}
