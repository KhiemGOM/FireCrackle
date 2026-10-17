import { describe, expect, it } from "vitest";
import { PlaybackStats, formatReadout, readoutLevel } from "./playbackStats";

const FRAME = 1000 / 60;
const PLAY = { playing: true, speed: 1 };

/** A clean playback: frame n needed at n * 16.7 ms and shown `wait` ms later. */
function steady(stats: PlaybackStats, frames: number, wait = 5, from = 0, hit = true) {
  for (let i = 0; i < frames; i++) {
    const t = (from + i) * FRAME;
    stats.needed(from + i, t, PLAY);
    stats.shown(from + i, t + wait, hit);
  }
}

describe("a clean playback", () => {
  it("shows the full rate with no drops and no late frames", () => {
    const s = new PlaybackStats();
    steady(s, 60);
    const sum = s.summary(60 * FRAME, 60);
    expect(sum.shownFps).toBeCloseTo(60, 0);
    expect(sum.lost).toBe(0);
    expect(sum.late).toBe(0);
    expect(sum.p50).toBeCloseTo(5, 5);
    expect(sum.p95).toBeCloseTo(5, 5);
    expect(sum.hitRate).toBe(1);
  });
});

describe("drops", () => {
  it("counts a frame that was replaced by a newer one before it was shown", () => {
    const s = new PlaybackStats();
    s.needed(10, 0, PLAY);
    s.needed(11, 16, PLAY);
    s.shown(11, 30, false);
    const sum = s.summary(100, 60);
    expect(sum.lost).toBe(1);
    expect(sum.frames).toBe(1);
  });

  it("counts the frames a catch-up step jumped over", () => {
    const s = new PlaybackStats();
    s.needed(10, 0, PLAY); s.shown(10, 5, true);
    s.needed(13, 50, PLAY); s.shown(13, 55, true); // 11 and 12 were never asked for
    expect(s.summary(100, 60).lost).toBe(2);
  });

  it("does not call a faster speed's stride a drop", () => {
    const s = new PlaybackStats();
    for (let i = 0; i < 10; i++) { s.needed(i * 4, i * FRAME, { playing: true, speed: 4 }); s.shown(i * 4, i * FRAME + 5, true); }
    const sum = s.summary(10 * FRAME, 60);
    expect(sum.lost).toBe(0);
  });

  it("does not count a jump while paused, or a long jump while playing (a seek), as drops", () => {
    const s = new PlaybackStats();
    s.needed(10, 0, { playing: false, speed: 1 }); s.shown(10, 5, false);
    s.needed(900, 100, { playing: false, speed: 1 }); s.shown(900, 800, false);
    s.needed(901, 900, PLAY); s.shown(901, 905, true);
    s.needed(5000, 1000, PLAY); s.shown(5000, 1500, false);
    const sum = s.summary(2000, 60);
    expect(sum.lost).toBe(0);
  });

  it("plays backwards without drops too", () => {
    const s = new PlaybackStats();
    for (let i = 0; i < 20; i++) { s.needed(100 - i, i * FRAME, PLAY); s.shown(100 - i, i * FRAME + 4, true); }
    const sum = s.summary(20 * FRAME, 60);
    expect(sum.lost).toBe(0);
  });
});

describe("waits", () => {
  it("calls a frame late when it was shown after one frame time", () => {
    const s = new PlaybackStats();
    s.needed(1, 0, PLAY); s.shown(1, 10, true);
    s.needed(2, 100, PLAY); s.shown(2, 100 + 40, false);
    const sum = s.summary(200, 60);
    expect(sum.late).toBe(1);
    expect(sum.p95).toBeGreaterThan(10);
  });

  it("reports percentiles of the wait", () => {
    const s = new PlaybackStats();
    const waits = [4, 4, 4, 4, 4, 4, 4, 4, 4, 100];
    waits.forEach((w, i) => { s.needed(i, i * 200, PLAY); s.shown(i, i * 200 + w, true); });
    const sum = s.summary(2000, 60);
    expect(sum.p50).toBe(4);
    expect(sum.p95).toBe(100);
  });

  it("reports how many frames came from the buffer", () => {
    const s = new PlaybackStats();
    [true, true, true, false].forEach((hit, i) => { s.needed(i, i * 20, PLAY); s.shown(i, i * 20 + 3, hit); });
    expect(s.summary(100, 60).hitRate).toBe(0.75);
  });
});

describe("the window", () => {
  it("forgets samples older than the window", () => {
    const s = new PlaybackStats(2000);
    steady(s, 60);
    expect(s.summary(60 * FRAME, 60).frames).toBe(60);
    const later = s.summary(60 * FRAME + 5000, 60);
    expect(later.frames).toBe(0);
    expect(later.shownFps).toBeNull();
  });

});

describe("bad input", () => {
  it("has nothing to report before any frame", () => {
    const sum = new PlaybackStats().summary(1000, 60);
    expect(sum).toMatchObject({ shownFps: null, p50: null, p95: null, hitRate: null, frames: 0, lost: 0, late: 0 });
  });

  it("never turns a bad frame rate into NaN or a late frame", () => {
    for (const fps of [0, NaN, -5, Infinity]) {
      const s = new PlaybackStats();
      s.needed(1, 0, PLAY); s.shown(1, 500, true);
      const sum = s.summary(1000, fps);
      expect(sum.late).toBe(0);
      expect(Number.isNaN(sum.p95)).toBe(false);
    }
  });

  it("ignores a frame shown that was never asked for", () => {
    const s = new PlaybackStats();
    expect(() => s.shown(5, 10, true)).not.toThrow();
    expect(s.summary(100, 60).frames).toBe(0);
  });
});

describe("formatReadout", () => {
  it("writes the rate, drops, late frames, the wait and the buffer", () => {
    const s = new PlaybackStats();
    s.needed(1, 0, PLAY); s.shown(1, 5, true);
    s.needed(2, 17, PLAY); s.needed(3, 33, PLAY); s.shown(3, 60, false); // 2 replaced; 3 late
    const text = formatReadout(s.summary(100, 60), 87, 60);
    expect(text).toMatch(/fps/);
    expect(text).toMatch(/1 dropped/);
    expect(text).toMatch(/1 late/);
    expect(text).toMatch(/p95 \d+ ms/);
    expect(text).toMatch(/buffer \+87/);
  });

  it("writes a dash, not NaN, when there is nothing to show", () => {
    const text = formatReadout(new PlaybackStats().summary(1000, 60), 0, 60);
    expect(text).not.toMatch(/NaN|undefined|null/);
    expect(text).toContain("—");
  });

  it("counts skipped frames with the dropped ones", () => {
    const s = new PlaybackStats();
    s.needed(10, 0, PLAY); s.shown(10, 4, true);
    s.needed(13, 50, PLAY); s.shown(13, 54, true);
    expect(formatReadout(s.summary(100, 60), 0, 60)).toMatch(/2 dropped/);
  });
});

describe("readoutLevel", () => {
  it("is idle with no frames, ok when clean", () => {
    expect(readoutLevel(new PlaybackStats().summary(1000, 60), 60)).toBe("idle");
    const s = new PlaybackStats(); steady(s, 60);
    expect(readoutLevel(s.summary(60 * FRAME, 60), 60)).toBe("ok");
  });

  it("warns on a drop or a late frame, and is bad once one frame in twenty is lost or the wait is long", () => {
    const one = new PlaybackStats(); steady(one, 59);
    one.needed(59, 59 * FRAME, PLAY); one.needed(60, 60 * FRAME, PLAY); one.shown(60, 60 * FRAME + 4, true);
    expect(readoutLevel(one.summary(61 * FRAME, 60), 60)).toBe("warn");

    const many = new PlaybackStats();
    for (let i = 0; i < 40; i++) { many.needed(i, i * FRAME, PLAY); if (i % 4) many.shown(i, i * FRAME + 4, true); }
    expect(readoutLevel(many.summary(40 * FRAME, 60), 60)).toBe("bad");

    const slow = new PlaybackStats();
    for (let i = 0; i < 20; i++) { slow.needed(i, i * FRAME, PLAY); slow.shown(i, i * FRAME + 60, false); }
    expect(readoutLevel(slow.summary(20 * FRAME + 60, 60), 60)).toBe("bad");
  });
});

describe("memory", () => {
  it("keeps a bounded number of samples even if nobody reads the summary", () => {
    const s = new PlaybackStats();
    for (let i = 0; i < 20000; i++) {
      s.needed(i, i * FRAME, PLAY);
      s.needed(i + 1000000, i * FRAME + 1, PLAY); // lost: replaced before it was shown
      s.shown(i + 1000000, i * FRAME + 2, true);
    }
    const sum = s.summary(20000 * FRAME, 60);
    expect(sum.frames).toBeLessThan(3000);
    expect(sum.lost).toBeLessThan(3000);
  });
});
