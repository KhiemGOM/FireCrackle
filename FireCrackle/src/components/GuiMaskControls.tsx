import { useEffect, useRef, useState } from "react";
import type { Backend } from "../lib/api";
import { answerAllowsMask, maskStatus, needsQuestion, overlayRgba, type GuiAnswer, type GuiMaskReply } from "../lib/guiMask";
import "./GuiMaskControls.css";

export interface GuiMaskState {
  supported: boolean;
  answer: GuiAnswer | null;
  /** The answer has been read from the project (null until then). */
  loaded: boolean;
  reply: GuiMaskReply | null;
  /** The frame the mask belongs to (a mask is never drawn over another frame). */
  maskFrame: number | null;
  pixels: Uint8ClampedArray | null;
  busy: boolean;
  error: string | null;
  setAnswer: (a: GuiAnswer) => Promise<void>;
}

/** The answer for the open video, and the mask of `frame` while `on` and allowed. */
export function useGuiMask(backend: Backend, frame: number, ready: boolean, on: boolean): GuiMaskState {
  const supported = !!(backend.guiAnswerGet && backend.guiAnswerSet && backend.guiMask && backend.guiMaskPixels);
  const [answer, setAnswerState] = useState<GuiAnswer | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [reply, setReply] = useState<GuiMaskReply | null>(null);
  const [maskFrame, setMaskFrame] = useState<number | null>(null);
  const [pixels, setPixels] = useState<Uint8ClampedArray | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = useRef(0);

  useEffect(() => {
    if (!supported || !on || loaded) return;
    backend.guiAnswerGet!().then((a) => { setAnswerState(a); setLoaded(true); }).catch((e) => setError(String(e)));
  }, [backend, supported, on, loaded]);

  useEffect(() => {
    const mine = ++token.current;
    if (!supported || !on || !ready || !answerAllowsMask(answer)) return;
    setBusy(true);
    setError(null);
    (async () => {
      try {
        const r = await backend.guiMask!(frame);
        const raw = r.reliable ? new Uint8Array(await backend.guiMaskPixels!(frame)) : null;
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
  }, [backend, supported, on, ready, answer, frame]);

  async function setAnswer(a: GuiAnswer) {
    try {
      await backend.guiAnswerSet!(a);
      setAnswerState(a);
      setLoaded(true);
      if (!answerAllowsMask(a)) { setReply(null); setPixels(null); setMaskFrame(null); }
    } catch (e) {
      setError(String(e));
    }
  }

  return { supported, answer, loaded, reply, maskFrame, pixels, busy, error, setAnswer };
}

/** The settings row: the vanilla question (once per video), then the status of the mask. */
export function GuiMaskPanel({ state, frame }: { state: GuiMaskState; frame: number }) {
  const { supported, answer, loaded, reply, maskFrame, busy, error, setAnswer } = state;
  const [asking, setAsking] = useState(false);
  if (!supported) return <span className="hud-hint">The GUI mask is available in the desktop app.</span>;
  if (!loaded) return <span className="hud-hint">Reading this video's GUI answer…</span>;
  const question = (
    <span className="gui-question" role="group" aria-label="Vanilla GUI question">
      <span>Is this footage <b>vanilla Minecraft 1.16.5 GUI</b>: no resource pack, no HUD mods, not cropped?</span>
      <button onClick={() => { void setAnswer("yes"); setAsking(false); }}>Yes</button>
      <button onClick={() => { void setAnswer("no"); setAsking(false); }}>No</button>
      <button onClick={() => { void setAnswer("not_sure"); setAsking(false); }}>Not sure</button>
    </span>
  );
  if (needsQuestion(answer) || asking) return question;
  if (!answerAllowsMask(answer)) {
    return <span className="hud-hint">GUI mask off: this video is marked {answer === "no" ? "not vanilla" : "not known to be vanilla"}. <button onClick={() => setAsking(true)}>Change answer</button></span>;
  }
  const status = error ? `GUI mask failed: ${error}` : busy || maskFrame !== frame || !reply ? "Finding the HUD…" : maskStatus(reply);
  return <span className="gui-mask-status" role="status">
    <span>{status}</span>
    <span className="hud-hint">red opaque · blue translucent · yellow unknown</span>
    <button onClick={() => setAsking(true)} title="Change the vanilla answer for this video">Vanilla: yes</button>
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
