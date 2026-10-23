import { useEffect, useRef, useState } from "react";
import type { Backend } from "../lib/api";
import { GUI_ASSUMPTION, maskStatus, overlayRgba, screenWorld, type GuiMaskReply } from "../lib/guiMask";
import "./GuiMaskControls.css";
import { failureMessage } from "../lib/appErrors";

export interface GuiMaskState {
  supported: boolean;
  reply: GuiMaskReply | null;
  /** The frame the mask belongs to (a mask is never drawn over another frame). */
  maskFrame: number | null;
  pixels: Uint8ClampedArray | null;
  /** 0 on open-screen pixels, 1 elsewhere: what unveil may change (lib/guiMask.ts screenWorld). */
  screen: Uint8Array | null;
  busy: boolean;
  error: string | null;
}

/** Detect the mask under the stated vanilla-GUI assumption while the tool is on. `settleMs`: ask only once the frame
 * has stayed that long (each mask decodes the native frame: frames passed by on the way are never analysed). */
export function useGuiMask(backend: Backend, frame: number, ready: boolean, on: boolean, settleMs = 0): GuiMaskState {
  const supported = !!(backend.guiMaskFrame || (backend.guiMask && backend.guiMaskPixels));
  const [reply, setReply] = useState<GuiMaskReply | null>(null);
  const [maskFrame, setMaskFrame] = useState<number | null>(null);
  const [pixels, setPixels] = useState<Uint8ClampedArray | null>(null);
  const [screen, setScreen] = useState<Uint8Array | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = useRef(0);

  useEffect(() => {
    const mine = ++token.current;
    if (!supported || !on || !ready) { setBusy(false); return; }
    setBusy(true);
    setError(null);
    const ask = async () => {
      try {
        let r: GuiMaskReply, raw: Uint8Array | null;
        if (backend.guiMaskFrame) {
          const result = await backend.guiMaskFrame(frame);
          r = result.reply; raw = result.packed;
        } else {
          r = await backend.guiMask!(frame);
          if (mine !== token.current) return;
          raw = (r.mask_available ?? r.reliable) ? new Uint8Array(await backend.guiMaskPixels!(frame)) : null;
        }
        if (mine !== token.current) return;
        setReply(r);
        setMaskFrame(frame);
        setPixels(raw ? overlayRgba(raw, r.width, r.height) : null);
        setScreen(raw ? screenWorld(raw) : null);
      } catch (e) {
        if (mine === token.current) setError(failureMessage(e));
      } finally {
        if (mine === token.current) setBusy(false);
      }
    };
    const timer = settleMs > 0 ? setTimeout(() => void ask(), settleMs) : (void ask(), undefined);
    return () => { ++token.current; clearTimeout(timer); };
  }, [backend, supported, on, ready, frame, settleMs]);

  return { supported, reply, maskFrame, pixels, screen, busy, error };
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
