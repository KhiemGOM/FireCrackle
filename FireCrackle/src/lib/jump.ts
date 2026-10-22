/** Typed jumps in the video status bar: a frame number or a timecode in the bar's own `HH:MM:SS|FF` format. */
import { failureMessage } from "./appErrors";
import { clampFrame } from "./frameMath";

export type JumpTarget = { kind: "frame"; frame: number } | { kind: "time"; seconds: number };
export type JumpError = { error: string };

const HOW = "Type a frame number or a time as HH:MM:SS|FF (MM:SS|FF, SS|FF and HH:MM:SS work too).";

export interface JumpOptions {
  /** What a bare number is: a frame (default), or time digits filled in from the right (`52158` = 5:21|58). */
  bare?: "frame" | "time";
}

/** The nominal rate `formatTimecode` counts FF in. */
const nominal = (fps: number) => (Number.isFinite(fps) && fps >= 1 ? Math.round(fps) : 1);

/**
 * Read what was typed. A whole number is a frame (0 … frameCount-1); anything with `:` or `|` is a time, units counted
 * from the right (the leftmost unit may exceed its usual range, the others may not), FF at the video's nominal rate.
 */
export function parseJump(text: string, fps: number, frameCount: number, opts: JumpOptions = {}): JumpTarget | JumpError {
  const t = text.trim();
  if (/^\d+$/.test(t) && opts.bare === "time") return fromDigits(t, nominal(fps));
  if (/^\d+$/.test(t)) {
    const frame = Number(t);
    if (!(frameCount >= 1)) return { error: "This video has no frames to jump to." };
    if (frame > frameCount - 1) return { error: `Frame must be 0–${frameCount - 1}.` };
    return { kind: "frame", frame };
  }
  const m = /^(\d+(?::\d+){0,2})(?:\|(\d+))?$/.exec(t);
  if (!m || (!t.includes(":") && m[2] === undefined)) return { error: HOW };
  const parts = m[1].split(":").map(Number);
  const rate = nominal(fps);
  const ff = m[2] === undefined ? 0 : Number(m[2]);
  if (ff >= rate) return { error: `The frame after "|" must be 00–${String(rate - 1).padStart(2, "0")} at this frame rate.` };
  // seconds and minutes under a larger unit stay below 60
  for (let i = 1; i < parts.length; i++) {
    if (parts[i] >= 60) return { error: `${i === parts.length - 1 ? "Seconds" : "Minutes"} must be 00–59. ${HOW}` };
  }
  const [h, mm, s] = [0, 0, 0, ...parts].slice(-3);
  return { kind: "time", seconds: h * 3600 + mm * 60 + s + ff / rate };
}

/** Digits typed for a time fill HH MM SS FF from the right; seconds and minutes stay below 60, hours may be any size. */
function fromDigits(d: string, rate: number): JumpTarget | JumpError {
  const ff = Number(d.slice(-2));
  const rest = d.slice(0, -2);
  const ss = Number(rest.slice(-2) || 0);
  const mm = Number(rest.slice(0, -2).slice(-2) || 0);
  const hh = Number(rest.slice(0, -4) || 0);
  if (ff >= rate) return { error: `The last two digits are the frame: 00–${String(rate - 1).padStart(2, "0")} at this frame rate.` };
  if (ss >= 60) return { error: `Seconds must be 00–59. ${HOW}` };
  if (mm >= 60) return { error: `Minutes must be 00–59. ${HOW}` };
  return { kind: "time", seconds: hh * 3600 + mm * 60 + ss + ff / rate };
}

export interface JumpContext {
  fps: number;
  frameCount: number;
  /** The frame shown now and its time, for estimating without the backend. */
  current: number;
  pts: number;
}

/**
 * The frame to jump to. A time goes to `locate` (the backend's nearest-timestamp lookup, the status bar's time base);
 * without it, it is estimated from the current frame at the nominal rate.
 */
export async function resolveJump(
  text: string,
  ctx: JumpContext,
  locate?: (seconds: number) => Promise<number>,
  opts: JumpOptions = {},
): Promise<{ frame: number } | JumpError> {
  const target = parseJump(text, ctx.fps, ctx.frameCount, opts);
  if ("error" in target) return target;
  if (target.kind === "frame") return { frame: target.frame };
  if (locate) {
    try {
      return { frame: await locate(target.seconds) };
    } catch (e) {
      return { error: `Could not find that time: ${failureMessage(e)}` };
    }
  }
  const rate = Number.isFinite(ctx.fps) && ctx.fps > 0 ? ctx.fps : 1;
  const guess = ctx.current + Math.round((target.seconds - ctx.pts) * rate);
  return { frame: clampFrame(guess, ctx.frameCount) };
}
