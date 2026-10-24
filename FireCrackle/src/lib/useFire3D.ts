// State of Label's 3D quad tool: the camera (automatic guess for the shown picture + clicked block corners, solved
// whenever the corners change), the one fire and its planes. Pixels are the picture's native ones (the camera is
// solved in them); the overlay scales them to the displayed picture.
import { useEffect, useRef, useState } from "react";
import { useUndoState } from "../hooks/useUndoState";
import type { LabelUndo } from "./labelUndo";
import { readFire3D, remember3D, writeFire3D, type SavedTool } from "./fire3dMemory";
import { failureMessage } from "./appErrors";
import { initReversal, reversalReady, type FireQuad } from "./reversal";
import { pictureTask } from "./pictureWorker";
import { emptyTool, fireQuads, latestOnly, newFire, pictureState, solveKey, solveTool, usableClicks, type ToolState } from "./fireTool";

/** The guesses of the one 3D quad tool: only the newest picture's runs when frames are stepped quickly. */
const guesses = latestOnly();

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
  /** The block grid and the fire's block box on the picture (each can be switched off). */
  showGrid: boolean;
  showBox: boolean;
  setShowGrid: (on: boolean) => void;
  setShowBox: (on: boolean) => void;
}

/** `history`: Label's undo, which every edit joins. `video` + `storage`: where each frame's work is kept (fire3dMemory);
 * without a video (a still image) it is kept for the session only. */
export interface Fire3DOptions { history?: LabelUndo; video?: string; storage?: Pick<Storage, "getItem" | "setItem">; }

/** `pictureKey` names the shown picture (a frame number or an image URL) and `load` reads it at native size;
 * `active`: the tool is on. `soul`: the sprite is a soul fire atlas (soul fire is the floor shape only). */
export function useFire3D(pictureKey: string, load: () => Promise<Blob>, active: boolean, soul: boolean, { history, video, storage }: Fire3DOptions = {}): Fire3D {
  const [loaded, setReady] = useState(false), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  // the module can be reloaded under us (dev hot reload): ready only while it is really there
  const ready = loaded && reversalReady();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [state, setRaw] = useUndoState<ToolState>(() => emptyTool(0), history, "video.fire3d");
  const [click, setClick] = useState<ClickMode>("corner");
  const [selected, setSelected] = useState<number | null>(null);
  const [shown, setShown] = useState("");
  const [showGrid, setShowGrid] = useUndoState(true, history, "video.fire3dGrid");
  const [showBox, setShowBox] = useUndoState(true, history, "video.fire3dBox");
  // each picture's work, kept as it is edited; `carried` is a picture's state when it only took the last one's fire
  // and camera (not the user's work there, so it is not kept)
  const memory = useRef<Map<string, SavedTool> | null>(null), carried = useRef<ToolState | null>(null);
  if (!memory.current) memory.current = readFire3D(video, storage);
  const keep = (key: string, s: ToolState) => {
    const next = s === carried.current ? new Map(memory.current!) : remember3D(memory.current!, key, s);
    if (s === carried.current) next.delete(key);
    memory.current = next;
    if (video && /^\d+$/.test(key)) writeFire3D(video, next, storage);
  };
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
      // decoding a native frame and the guess take over a second at 1440p: off the UI thread (lib/pictureWorker.ts)
      const made = await guesses(async () => cancelled ? null : pictureTask("orientation", { bytes: await (await load()).arrayBuffer() }));
      if (made === null) return; // a newer picture's guess runs instead
      if (cancelled) return;
      const { width, height, guess } = made;
      setSize({ width, height });
      // a picture being shown is not an edit: no undo step
      const restore = (s: ToolState) => {
        const same = shown === pictureKey, saved = same ? undefined : memory.current!.get(pictureKey), next = pictureState(s, same, guess, saved);
        if (!same) carried.current = saved ? null : next;
        else if (carried.current === s) carried.current = next;
        return next;
      };
      if (history) history.ignore(() => setRaw(restore)); else setRaw(restore);
      setShown(pictureKey);
    })().catch(e => { if (!cancelled) setError(failureMessage(e)); }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [pictureKey, active, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  // an undo can take this picture back to what it was: keep (or forget) that too
  useEffect(() => { if (shown === pictureKey) keep(pictureKey, state); }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const w = size?.width ?? 0, h = size?.height ?? 0;
  const update = (f: (s: ToolState) => ToolState) => setRaw(s => {
    const made = solveEdit(s, f(s));
    keep(pictureKey, made);
    return made;
  });
  function solveEdit(s: ToolState, next: ToolState): ToolState {
    if (!ready || !w) return next;
    let solved = solveKey(next) !== solveKey(s) ? solveTool(next, w, h) : next;
    // the first camera puts a fire block on the first corner's block, so there is something to line up at once
    if (solved.camera && !solved.fire) {
      const at = usableClicks(solved)[0]?.world;
      if (at) solved = { ...solved, fire: newFire(solved.camera, at) };
    }
    return solved;
  }
  // a few WASM calls per render; no memo (VideoPane's tests mock React's hooks by call order)
  const quads = ready && state.camera && state.fire && w > 0 ? fireQuads(state.fire, soul, state.camera, w, h) : [];
  return { ready, error, busy, size, state, update, click, setClick, selected, setSelected, quads, soul, showGrid, showBox, setShowGrid, setShowBox };
}
