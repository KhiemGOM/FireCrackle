/** Presentation-gated media clock. Timer jitter may skip frames once a picture is ready;
 * buffering pauses media time and discards catch-up debt. */
export interface PlaybackClock {
  /** `performance.now()` when playback (at this speed and direction) started. */
  startMs: number;
  /** Frames moved since then. */
  stepped: number;
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
  // A missing picture pauses media time. Waiting never becomes catch-up debt.
  if (!ready) return { frames: 0, clock: startClock(nowMs) };
  const rate = (fps * speed) / 1000; // frames per millisecond
  if (!Number.isFinite(rate) || !(rate > 0) || !Number.isFinite(nowMs)) return { frames: 0, clock };
  const owed = Math.floor((nowMs - clock.startMs) * rate) - clock.stepped;
  if (!(owed > 0)) return { frames: 0, clock };
  const cap = Number.isFinite(maxCatchUp) && maxCatchUp >= 1 ? Math.floor(maxCatchUp) : 1;
  if (owed <= cap) return { frames: owed, clock: { startMs: clock.startMs, stepped: clock.stepped + owed } };
  const forgiven = owed - cap;
  return { frames: cap, clock: { startMs: clock.startMs + forgiven / rate, stepped: clock.stepped + cap } };
}
