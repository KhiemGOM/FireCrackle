/** Wall-clock playback. The play loop used to move one step for every timer tick that ran and to skip a tick that fired
 *  while the previous step was still in flight, so every skipped tick was lost time: any hiccup slowed the video for
 *  good (a 60 fps video leaves only 16.7 ms per tick). Here the frame the video should be at follows the clock; a late
 *  or skipped tick moves several frames at once, so the speed stays right and a slow moment drops frames instead of
 *  slowing everything down. */
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
): { frames: number; clock: PlaybackClock } {
  const rate = (fps * speed) / 1000; // frames per millisecond
  if (!Number.isFinite(rate) || !(rate > 0) || !Number.isFinite(nowMs)) return { frames: 0, clock };
  const owed = Math.floor((nowMs - clock.startMs) * rate) - clock.stepped;
  if (!(owed > 0)) return { frames: 0, clock };
  const cap = Number.isFinite(maxCatchUp) && maxCatchUp >= 1 ? Math.floor(maxCatchUp) : 1;
  if (owed <= cap) return { frames: owed, clock: { startMs: clock.startMs, stepped: clock.stepped + owed } };
  const forgiven = owed - cap;
  return { frames: cap, clock: { startMs: clock.startMs + forgiven / rate, stepped: clock.stepped + cap } };
}
