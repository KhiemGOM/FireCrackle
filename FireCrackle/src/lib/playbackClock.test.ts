import { describe, expect, it } from "vitest";
import { framesDue, startClock, type PlaybackClock } from "./playbackClock";

/** Drive the clock the way the play loop does: one call per timer tick, at the given times. */
function play(times: number[], fps: number, speed: number, cap = 30, from = startClock(0)): { total: number; per: number[]; clock: PlaybackClock } {
  let clock = from;
  const per: number[] = [];
  let total = 0;
  for (const t of times) {
    const due = framesDue(t, clock, fps, speed, cap);
    clock = due.clock;
    per.push(due.frames);
    total += due.frames;
  }
  return { total, per, clock };
}

const everyMs = (interval: number, seconds: number) => Array.from({ length: Math.floor((seconds * 1000) / interval) }, (_, i) => (i + 1) * interval);

describe("playback clock", () => {
  it("moves one frame per tick at 60 fps when the ticks arrive on time", () => {
    const { total, per } = play(everyMs(1000 / 60, 2), 60, 1);
    expect(total).toBeGreaterThanOrEqual(119);
    expect(total).toBeLessThanOrEqual(120);
    expect(Math.max(...per)).toBe(1);
  });

  it("makes up a tick that was skipped instead of losing its time", () => {
    // ticks at 16.7, then the next two are skipped (a busy step) and one arrives at 50 ms
    const { per } = play([16.7, 50.1], 60, 1);
    expect(per).toEqual([1, 2]);
  });

  it("never loses time however irregular the ticks are: total frames follow the wall clock", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    let t = 0;
    const times: number[] = [];
    while (t < 20000) { t += 5 + rnd() * 60; times.push(t); } // ticks 5 to 65 ms apart, many skipped
    const { total, clock } = play(times, 60, 1, 1000);
    const end = times[times.length - 1];
    expect(Math.abs(total - Math.floor((end / 1000) * 60))).toBeLessThanOrEqual(1);
    expect(clock.stepped).toBe(total);
  });

  it("follows the speed: 2x moves twice the frames, 4x four times", () => {
    const one = play(everyMs(16, 3), 60, 1).total;
    expect(play(everyMs(16, 3), 60, 2).total).toBeGreaterThanOrEqual(one * 2 - 2);
    expect(play(everyMs(16, 3), 60, 4).total).toBeGreaterThanOrEqual(one * 4 - 4);
    expect(play(everyMs(16, 3), 60, 4).total).toBeLessThanOrEqual(one * 4 + 4);
  });

  it("keeps the fraction of a frame between ticks (59.99 fps over 100 seconds)", () => {
    const { total } = play(everyMs(16, 100), 59.99, 1, 100);
    expect(Math.abs(total - Math.floor(100 * 59.99))).toBeLessThanOrEqual(1);
  });

  it("makes up at most the cap after a long stall, and forgives the rest", () => {
    const stalled = play([10_000], 60, 1, 30);
    expect(stalled.per).toEqual([30]);
    // the next tick, 16.7 ms later, is back to normal: it does not owe the 570 forgiven frames
    const next = framesDue(10_016.7, stalled.clock, 60, 1, 30);
    expect(next.frames).toBeLessThanOrEqual(2);
    expect(next.frames).toBeGreaterThanOrEqual(0);
  });

  it("moves nothing when no time has passed or the clock reads earlier", () => {
    const c = startClock(1000);
    expect(framesDue(1000, c, 60, 1, 30)).toEqual({ frames: 0, clock: c });
    expect(framesDue(900, c, 60, 1, 30)).toEqual({ frames: 0, clock: c });
    expect(framesDue(1005, c, 60, 1, 30).frames).toBe(0); // 5 ms: not yet a frame
  });

  it("does not change the clock it was given", () => {
    const c = startClock(0);
    const before = JSON.stringify(c);
    framesDue(500, c, 60, 1, 30);
    expect(JSON.stringify(c)).toBe(before);
  });

  it("moves nothing for a frame rate or speed that makes no sense, and never throws", () => {
    for (const [fps, speed] of [[0, 1], [-60, 1], [NaN, 1], [Infinity, 1], [60, 0], [60, -1], [60, NaN]] as const) {
      expect(framesDue(1000, startClock(0), fps, speed, 30).frames).toBe(0);
    }
    expect(framesDue(NaN, startClock(0), 60, 1, 30).frames).toBe(0);
  });

  it("a cap of zero or a broken cap still moves at least one frame when one is due", () => {
    for (const cap of [0, -3, NaN]) {
      expect(framesDue(100, startClock(0), 60, 1, cap).frames).toBeGreaterThanOrEqual(1);
    }
  });

  it("restarting the clock (a new speed or direction) starts counting from that moment", () => {
    const c = startClock(5000);
    expect(framesDue(5000 + 1000, c, 60, 2, 1000).frames).toBe(120);
  });
});

// Job175: consumer backpressure must stop media time, not accumulate catch-up debt.
describe("buffer underrun backpressure", () => {
  it("retains media time across brief frame delivery waits at 1x", () => {
    let clock = startClock(0), total = 0;
    // One frame presentation/IPC finishes every second 16 ms timer tick.
    for (let now = 16; now <= 10000; now += 16) {
      const due = framesDue(now, clock, 60, 1, 30, now % 32 === 0);
      total += due.frames; clock = due.clock;
    }
    expect(total).toBeGreaterThanOrEqual(598);
    expect(total).toBeLessThanOrEqual(600);
  });
  it("holds indefinitely until presentation is ready, then resumes without a catch-up jump", () => {
    let clock = startClock(0);
    for (const now of [17,100,1000,10_000]) {
      const due = framesDue(now,clock,60,1,30,false);
      expect(due.frames).toBe(0); clock=due.clock;
    }
    const due=framesDue(10_017,clock,60,1,30,true);
    expect(due.frames).toBe(1);
  });
  it("holds backward and fast playback equally (direction is applied by the caller)", () => {
    for (const speed of [0.5,1,2,4,1.5]) {
      const stopped=framesDue(5000,startClock(0),60,speed,30,false);
      expect(stopped.frames).toBe(0);
      expect(framesDue(5001,stopped.clock,60,speed,30,true).frames).toBe(0);
    }
  });
});
