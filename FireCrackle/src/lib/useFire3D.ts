// State of Label's 3D quad tool: the camera (automatic guess for the shown picture + clicked block corners, solved
// whenever the corners change), the one fire and its planes. Pixels are the picture's native ones (the camera is
// solved in them); the overlay scales them to the displayed picture.
import { useEffect, useState } from "react";
import { canvasFrameIo } from "./veilFrame";
import { failureMessage } from "./appErrors";
import { initReversal, orientation, reversalReady, type FireQuad } from "./reversal";
import { emptyTool, fireQuads, newFire, solveTool, usableClicks, type ToolState } from "./fireTool";

/** What a click on the picture does: add a block corner, place the fire, or nothing (pan and zoom as usual). */
export type ClickMode = "none" | "corner" | "fire";
export interface Fire3D {
  ready: boolean;
  error: string;
  busy: boolean;
  /** Native picture size the camera is solved in (null until the picture is read). */
  size: { width: number; height: number } | null;
  state: ToolState;
  /** Change the state; the camera is solved again when the corners changed. */
  update: (f: (s: ToolState) => ToolState) => void;
  click: ClickMode;
  setClick: (m: ClickMode) => void;
  /** The corner being edited (its coordinates in the bar). */
  selected: number | null;
  setSelected: (id: number | null) => void;
  /** The fire's planes under the camera (native pixels). */
  quads: FireQuad[];
  soul: boolean;
}

/** `pictureKey` names the shown picture (a frame number or an image URL) and `load` reads it at native size;
 * `active`: the tool is on. `soul`: the sprite is a soul fire atlas (soul fire is the floor shape only). */
export function useFire3D(pictureKey: string, load: () => Promise<Blob>, active: boolean, soul: boolean): Fire3D {
  const [loaded, setReady] = useState(false), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  // the module can be reloaded under us (dev hot reload): ready only while it is really there
  const ready = loaded && reversalReady();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [state, setRaw] = useState<ToolState>(() => emptyTool(0));
  const [click, setClick] = useState<ClickMode>("corner");
  const [selected, setSelected] = useState<number | null>(null);
  const [shown, setShown] = useState("");
  useEffect(() => {
    if (!active || ready) return;
    setReady(false);
    void initReversal().then(() => setReady(true)).catch(e => setError(failureMessage(e)));
  }, [active, ready]);
  // a new picture: its own guess and corners (the camera moves between frames); the fire and the camera are kept so
  // stepping frames shows the same fire under the last camera until it is solved again
  useEffect(() => {
    if (!active || !ready) return;
    let cancelled = false;
    setBusy(true); setError("");
    void (async () => {
      const img = await canvasFrameIo.decode(await (await load()).arrayBuffer());
      if (cancelled) return;
      setSize({ width: img.width, height: img.height });
      const guess = orientation(img.data, img.width, img.height);
      setRaw(s => shown === pictureKey ? { ...s, guess } : { ...emptyTool(0), fire: s.fire, eyeY: s.eyeY, camera: s.camera, guess });
      setShown(pictureKey);
    })().catch(e => { if (!cancelled) setError(failureMessage(e)); }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [pictureKey, active, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const w = size?.width ?? 0, h = size?.height ?? 0;
  const update = (f: (s: ToolState) => ToolState) => setRaw(s => {
    const next = f(s);
    if (!ready || !w) return next;
    const corners = (t: ToolState) => JSON.stringify([usableClicks(t), t.eyeY, !!t.guess]);
    let solved = corners(next) !== corners(s) ? solveTool(next, w, h) : next;
    // the first camera puts a fire block on the first corner's block, so there is something to line up at once
    if (solved.camera && !solved.fire) {
      const at = usableClicks(solved)[0]?.world;
      if (at) solved = { ...solved, fire: newFire(solved.camera, at) };
    }
    return solved;
  });
  // a few WASM calls per render; no memo (VideoPane's tests mock React's hooks by call order)
  const quads = ready && state.camera && state.fire && w > 0 ? fireQuads(state.fire, soul, state.camera, w, h) : [];
  return { ready, error, busy, size, state, update, click, setClick, selected, setSelected, quads, soul };
}
