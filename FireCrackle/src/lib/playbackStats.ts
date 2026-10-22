/** What playback actually did, for the small readout in the status bar (docs/PLAN-BUFFER.md): the achieved frame rate, frames
 *  lost, frames that arrived late and how long the picture took to follow the playhead.
 *
 *  A frame is *needed* when the playhead lands on it and *shown* when its picture is on screen. A frame replaced by a
 *  newer one before it was shown, or jumped over by a catch-up step, is *lost*. Both only count while playing: a seek
 *  or a paused step is not a loss. */

export interface Motion {
  playing: boolean;
  /** A multiple of the frame rate; a step is this many frames at speeds over 1. */
  speed: number;
}

/** The longest catch-up step the play loop takes (`maxCatchUp` in App.tsx); a bigger jump is a seek. */
const MAX_CATCH_UP = 30;
/** Samples kept at most, whether or not anyone reads them (5 s of 60 fps is 300). */
const KEEP = 2048;

export interface StatsSummary {
  /** Frames shown per second over the window; null with fewer than two frames. */
  shownFps: number | null;
  /** Frames lost (replaced before they were shown, or jumped over). */
  lost: number;
  /** Frames shown later than one frame time after they were needed. */
  late: number;
  p50: number | null;
  p95: number | null;
  /** The share of shown frames that came from the buffer. */
  hitRate: number | null;
  /** Frames shown in the window. */
  frames: number;
}

const budgetMs = (fps: number) => (Number.isFinite(fps) && fps > 0 ? 1000 / fps : Infinity);

export class PlaybackStats {
  /** Shown frames: when, how long after they were needed, and whether the buffer had them. */
  private seen: { at: number; wait: number; hit: boolean }[] = [];
  /** When each lost frame was lost. */
  private lost: number[] = [];
  private open: { frame: number; at: number; playing: boolean } | null = null;
  private last: { frame: number; playing: boolean } | null = null;

  constructor(private readonly windowMs = 5000) {}

  needed(frame: number, atMs: number, { playing, speed }: Motion): void {
    if (this.open?.playing && playing) this.lose(atMs, 1);
    if (this.last?.playing && playing) {
      const gap = Math.abs(frame - this.last.frame);
      const stride = Math.max(1, Math.round(speed) || 1);
      if (gap > stride && gap <= MAX_CATCH_UP + stride) this.lose(atMs, gap - stride);
    }
    this.open = { frame, at: atMs, playing };
    this.last = { frame, playing };
  }

  shown(frame: number, atMs: number, fromBuffer: boolean): void {
    if (this.open?.frame !== frame) return;
    this.push(this.seen, { at: atMs, wait: Math.max(0, atMs - this.open.at), hit: fromBuffer });
    this.open = null;
  }

  summary(nowMs: number, fps: number): StatsSummary {
    const from = nowMs - this.windowMs;
    const shown = this.seen.filter((s) => s.at >= from);
    const waits = shown.map((s) => s.wait).sort((a, b) => a - b);
    const rank = (p: number) => (waits.length ? waits[Math.max(0, Math.ceil(p * waits.length) - 1)] : null);
    const span = shown.length > 1 ? shown[shown.length - 1].at - shown[0].at : 0;
    const budget = budgetMs(fps);
    return {
      shownFps: span > 0 ? (shown.length - 1) / (span / 1000) : null,
      lost: this.lost.filter((at) => at >= from).length,
      late: waits.filter((w) => w > budget).length,
      p50: rank(0.5),
      p95: rank(0.95),
      hitRate: shown.length ? shown.filter((s) => s.hit).length / shown.length : null,
      frames: shown.length,
    };
  }

  private lose(at: number, n: number): void {
    for (let i = 0; i < n; i++) this.push(this.lost, at);
  }

  private push<T>(list: T[], item: T): void {
    list.push(item);
    if (list.length > KEEP) list.splice(0, KEEP / 2);
  }
}

/** One line for the status bar. */
export function formatReadout(s: StatsSummary, bufferedAhead: number, fps: number): string {
  if (s.frames === 0) return "—";
  const rate = s.shownFps === null ? "—" : s.shownFps.toFixed(1);
  const nominal = Number.isFinite(fps) && fps > 0 ? `/${Math.round(fps)}` : "";
  const wait = s.p95 === null ? "—" : `${Math.round(s.p95)}`;
  return `${rate}${nominal} fps · ${s.lost} dropped · ${s.late} late · p95 ${wait} ms · buffer +${Math.max(0, Math.floor(bufferedAhead))}`;
}

export type ReadoutLevel = "idle" | "ok" | "warn" | "bad";

/** How worried to look: ok when clean, warn at the first loss or late frame, bad at one frame in twenty lost or a long wait. */
export function readoutLevel(s: StatsSummary, fps: number): ReadoutLevel {
  if (s.frames === 0) return "idle";
  const budget = budgetMs(fps);
  if (s.lost / (s.frames + s.lost) >= 0.05 || (s.p95 !== null && s.p95 > 2 * budget)) return "bad";
  return s.lost > 0 || s.late > 0 ? "warn" : "ok";
}
