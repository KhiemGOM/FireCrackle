import { useEffect, useRef, useState, type RefObject, type PointerEvent } from "react";
import { isEditableTarget } from "../lib/actions";
import { rotationDelta } from "../lib/zoom";
import "./VideoRotation.css";

interface Point { x: number; y: number }
interface Pivot extends Point { handleX: number; handleY: number }

/** Handles live in pane pixels, outside the rotated video, so their size stays constant. */
export function VideoRotation({ frameRef, onRotate }: {
  frameRef: RefObject<HTMLDivElement | null>;
  onRotate: (degrees: number, x: number, y: number) => void;
}) {
  const [pivot, setPivot] = useState<Pivot | null>(null);
  const mouse = useRef<Point | null>(null);
  const held = useRef(false);
  const drag = useRef<{ pivot: Pivot; angle: number } | null>(null);
  const rotate = useRef(onRotate);
  rotate.current = onRotate;

  useEffect(() => {
    const move = (event: globalThis.PointerEvent) => { mouse.current = { x: event.clientX, y: event.clientY }; };
    const clear = () => { held.current = false; drag.current = null; setPivot(null); };
    const down = (event: KeyboardEvent) => {
      if (event.key !== "Shift" || held.current || event.repeat || isEditableTarget(event.target as HTMLElement | null)) return;
      held.current = true;
      const rect = frameRef.current?.getBoundingClientRect(), point = mouse.current;
      if (!rect || !point) return;
      const x = point.x - rect.left, y = point.y - rect.top;
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;
      // Place the handle toward available space without moving the cursor's pivot.
      const handleX = Math.max(18, Math.min(rect.width - 18, x + (x < rect.width / 2 ? 64 : -64)));
      const handleY = Math.max(18, Math.min(rect.height - 18, y));
      setPivot({ x, y, handleX, handleY });
    };
    const up = (event: KeyboardEvent) => { if (event.key === "Shift") clear(); };
    const visibility = () => { if (document.hidden) clear(); };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [frameRef]);

  function begin(event: PointerEvent<SVGGElement>) {
    if (event.button !== 0 || !pivot) return;
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.stopPropagation(); event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pivot, angle: Math.atan2(event.clientY - rect.top - pivot.y, event.clientX - rect.left - pivot.x) };
  }
  function move(event: PointerEvent<SVGSVGElement>) {
    const active = drag.current, rect = frameRef.current?.getBoundingClientRect();
    if (!active || !rect) return;
    event.stopPropagation(); event.preventDefault();
    const x = event.clientX - rect.left - active.pivot.x, y = event.clientY - rect.top - active.pivot.y;
    if (Math.hypot(x, y) < 8) return; // Direction is unstable right on top of the pivot.
    const angle = Math.atan2(y, x);
    rotate.current(rotationDelta(active.angle, angle), active.pivot.x, active.pivot.y);
    active.angle = angle;
    setPivot({ ...active.pivot, handleX: active.pivot.x + Math.cos(angle) * 64, handleY: active.pivot.y + Math.sin(angle) * 64 });
  }
  function stop(event: PointerEvent<SVGSVGElement>) {
    if (drag.current) event.stopPropagation();
    drag.current = null;
  }
  if (!pivot) return null;
  return <svg className="video-rotation" aria-label="Video rotation controls" onPointerMove={move}
    onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop} onDoubleClick={event => event.stopPropagation()}>
    <line x1={pivot.x} y1={pivot.y} x2={pivot.handleX} y2={pivot.handleY} />
    <circle className="video-rotation-pivot" cx={pivot.x} cy={pivot.y} r="5"><title>Rotation anchor · set where you press Shift</title></circle>
    <g className="video-rotation-handle" transform={`translate(${pivot.handleX} ${pivot.handleY})`} onPointerDown={begin}>
      <circle r="15" />
      <path d="M-6-2a7 7 0 1 1 1 7M-7-7v6h6" />
      <title>Drag to rotate video around the anchor · release Shift to hide</title>
    </g>
  </svg>;
}
