/** Presentation-gated media clock. Short delivery delays retain elapsed media time;
 * sustained buffering pauses it instead of accumulating a large catch-up jump. */
export interface PlaybackClock {
  /** `performance.now()` when playback (at this speed and direction) started. */
  startMs: number;
  /** Frames moved since then. */
  stepped: number;
  /** Once genuinely stalled, keep pausing until presentation resumes. */
  stalled?: true;
}

export function startClock(nowMs: number): PlaybackClock {
  return { startMs: nowMs, stepped: 0 };
}

/**
 * How many frames playback owes at `nowMs`, and the clock after paying them. At most `maxCatchUp` are paid at once; if
 * playback is further behind than that (a long stall), the rest is forgiven, so the video does not race ahead to catch up.
 * The count is a size: the caller applies the direction.
 */
export function framesDue(
  nowMs: number,
  clock: PlaybackClock,
  fps: number,
  speed: number,
  maxCatchUp: number,
  ready = true,
): { frames: number; clock: PlaybackClock } {
  const rate = (fps * speed) / 1000; // frames per millisecond
  if (!Number.isFinite(rate) || !(rate > 0) || !Number.isFinite(nowMs)) return { frames: 0, clock };
  if (!ready) {
    // An IPC/image-load taking one timer tick is normal, even for cached frames.
    // Resetting the clock on every such tick makes 1x playback run at about 0.6x.
    const waitingMs = nowMs - clock.startMs - clock.stepped / rate;
    return { frames: 0, clock: clock.stalled || waitingMs >= 250
      ? { ...startClock(nowMs), stalled: true } : clock };
  }
  const owed = Math.floor((nowMs - clock.startMs) * rate) - clock.stepped;
  if (!(owed > 0)) return { frames: 0, clock };
  const cap = Number.isFinite(maxCatchUp) && maxCatchUp >= 1 ? Math.floor(maxCatchUp) : 1;
  if (owed <= cap) return { frames: owed, clock: { startMs: clock.startMs, stepped: clock.stepped + owed } };
  const forgiven = owed - cap;
  return { frames: cap, clock: { startMs: clock.startMs + forgiven / rate, stepped: clock.stepped + cap } };
}
