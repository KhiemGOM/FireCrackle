import { useEffect, useRef, useState } from "react";
import type { Backend } from "../lib/api";
import { GUI_ASSUMPTION, maskStatus, overlayRgba, type GuiMaskReply } from "../lib/guiMask";
import "./GuiMaskControls.css";

export interface GuiMaskState {
  supported: boolean;
  reply: GuiMaskReply | null;
  /** The frame the mask belongs to (a mask is never drawn over another frame). */
  maskFrame: number | null;
  pixels: Uint8ClampedArray | null;
  busy: boolean;
  error: string | null;
}

/** Detect the mask under the stated vanilla-GUI assumption while the tool is on. */
export function useGuiMask(backend: Backend, frame: number, ready: boolean, on: boolean): GuiMaskState {
  const supported = !!(backend.guiMask && backend.guiMaskPixels);
  const [reply, setReply] = useState<GuiMaskReply | null>(null);
  const [maskFrame, setMaskFrame] = useState<number | null>(null);
  const [pixels, setPixels] = useState<Uint8ClampedArray | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = useRef(0);

  useEffect(() => {
    const mine = ++token.current;
    if (!supported || !on || !ready) return;
    setBusy(true);
    setError(null);
    (async () => {
      try {
        const r = await backend.guiMask!(frame);
        const raw = (r.mask_available ?? r.reliable) ? new Uint8Array(await backend.guiMaskPixels!(frame)) : null;
        if (mine !== token.current) return;
        setReply(r);
        setMaskFrame(frame);
        setPixels(raw ? overlayRgba(raw, r.width, r.height) : null);
      } catch (e) {
        if (mine === token.current) setError(String(e));
      } finally {
        if (mine === token.current) setBusy(false);
      }
    })();
  }, [backend, supported, on, ready, frame]);

  return { supported, reply, maskFrame, pixels, busy, error };
}

/** Detection status; compatibility is an assumption in the tooltip, not a confirmation. */
export function GuiMaskPanel({ state, frame }: { state: GuiMaskState; frame: number }) {
  const { supported, reply, maskFrame, busy, error } = state;
  if (!supported) return <span className="hud-hint">The GUI mask is available in the desktop app.</span>;
  const status = error ? `GUI mask failed: ${error}` : busy || maskFrame !== frame || !reply ? "Finding the GUI…" : maskStatus(reply);
  return <span className="gui-mask-status" role="status" title={GUI_ASSUMPTION}>
    <span>{status}</span>
    <span className="hud-hint">red opaque · blue translucent · yellow unknown</span>
  </span>;
}

/** The mask drawn over the frame (same box as the picture), only for the frame it was computed for. */
export function GuiMaskOverlay({ state, frame }: { state: GuiMaskState; frame: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const { reply, pixels, maskFrame } = state;
  const show = !!reply && !!pixels && maskFrame === frame;
  useEffect(() => {
    const c = ref.current;
    if (!c || !show || !reply || !pixels) return;
    c.width = reply.width;
    c.height = reply.height;
    c.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(pixels), reply.width, reply.height), 0, 0);
  }, [show, reply, pixels]);
  if (!show) return null;
  return <canvas ref={ref} className="gui-mask-overlay" aria-label="GUI mask overlay" />;
}
