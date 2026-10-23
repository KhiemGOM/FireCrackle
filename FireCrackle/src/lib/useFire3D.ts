// State of Label's 3D quad mode: the camera (automatic guess for the shown frame + clicked block corners), the fire
// placements and which of their planes is Label's manual quad. Pixels are the video's native ones (the camera is
// solved in them); the overlay scales them to the displayed picture.
import { useEffect, useState } from "react";
import type { Backend } from "./api";
import { nativeFrame } from "./exactFrame";
import { canvasFrameIo } from "./veilFrame";
import { failureMessage } from "./appErrors";
import { initReversal, orientation, type FireQuad } from "./reversal";
import { emptyTool, placementQuads, planeToManualQuad, type ToolState } from "./fireTool";
import type { ManualQuad } from "./quadMask";

/** Which plane is the manual quad: a placement and the index of its plane. */
export interface PlaneChoice { placement: number; plane: number; }
export interface Fire3D {
  ready: boolean;
  error: string;
  busy: boolean;
  /** Native frame size the camera is solved in (null until the frame is read). */
  size: { width: number; height: number } | null;
  state: ToolState;
  setState: (f: (s: ToolState) => ToolState) => void;
  picking: boolean;
  setPicking: (on: boolean) => void;
  choice: PlaneChoice | null;
  setChoice: (c: PlaneChoice | null) => void;
  /** Every placement's planes under the current camera (native pixels). */
  planes: { placement: number; quads: FireQuad[] }[];
  /** The chosen plane as Label's manual quad, when it is in front of the camera. */
  manual: { quad: ManualQuad; mirrored: boolean } | null;
}

/** `active`: 3D mode is on and the frame shown is the current one (only then is the frame read and guessed). */
export function useFire3D(backend: Backend, frame: number, active: boolean): Fire3D {
  const [ready, setReady] = useState(false), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [state, setRaw] = useState<ToolState>(() => emptyTool(frame));
  const [picking, setPicking] = useState(false);
  const [choice, setChoice] = useState<PlaneChoice | null>(null);
  useEffect(() => {
    if (!active || ready) return;
    void initReversal().then(() => setReady(true)).catch(e => setError(failureMessage(e)));
  }, [active, ready]);
  // a new frame: its own guess and clicks (the camera moves between frames); placements and the camera are kept so
  // stepping frames shows the same fire under the last camera until it is solved again
  useEffect(() => {
    if (!active || !ready) return;
    let cancelled = false;
    setBusy(true); setError("");
    void (async () => {
      const img = await canvasFrameIo.decode(await (await nativeFrame(backend, frame)).arrayBuffer());
      if (cancelled) return;
      setSize({ width: img.width, height: img.height });
      const guess = orientation(img.data, img.width, img.height);
      setRaw(s => s.frame === frame ? { ...s, guess } : { ...emptyTool(frame), placements: s.placements, eyeY: s.eyeY, camera: s.camera, guess });
    })().catch(e => { if (!cancelled) setError(failureMessage(e)); }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [backend, frame, active, ready]);
  const w = size?.width ?? 0, h = size?.height ?? 0;
  // a few WASM calls per render; no memo (VideoPane's tests mock React's hooks by call order)
  const planes = ready && state.camera && w > 0
    ? state.placements.map(p => ({ placement: p.id, quads: placementQuads(p, state.camera!, w, h) }))
    : [];
  const chosen = choice ? planes.find(p => p.placement === choice.placement)?.quads[choice.plane] : undefined;
  const manual = chosen ? planeToManualQuad(chosen, w, h) : null;
  return { ready, error, busy, size, state, setState: f => setRaw(s => f(s)), picking, setPicking, choice, setChoice, planes, manual };
}
