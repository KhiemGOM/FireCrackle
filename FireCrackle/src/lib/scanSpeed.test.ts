import { expect, it } from "vitest";
import type { PovStatus } from "./api";
import { ScanSpeedTracker, scanRemainingTime } from "./scanSpeed";

const status: PovStatus = { id: 1, video_path: "v.mkv", state: "running", processed: 5000, total: 10000, accepted: 0, applied: 0, error: null };

it("measures newly observed work rather than cached frames and waits for a baseline", () => {
  const tracker = new ScanSpeedTracker();
  expect(tracker.update(status, 100)).toBeNull();
  expect(tracker.update({ ...status, processed: 5100 }, 1100)).toBeNull();
  expect(tracker.update({ ...status, processed: 5200 }, 2100)).toEqual({ fps: 100, remainingSeconds: 48 });
});

it("uses recent speed and loses its ETA when work stalls", () => {
  const tracker = new ScanSpeedTracker();
  tracker.update(status, 0);
  tracker.update({ ...status, processed: 6000 }, 10000);
  expect(tracker.update({ ...status, processed: 6200 }, 20000)?.fps).toBe(60);
  expect(tracker.update({ ...status, processed: 6400 }, 30000)?.fps).toBe(20);
  tracker.update({ ...status, processed: 6400 }, 40000);
  expect(tracker.update({ ...status, processed: 6400 }, 50000)).toEqual({ fps: 0, remainingSeconds: null });
});

it("excludes paused time on resume", () => {
  const tracker = new ScanSpeedTracker();
  tracker.update(status, 0);
  tracker.update({ ...status, processed: 5200 }, 2000);
  expect(tracker.update({ ...status, state: "cancelled", processed: 5200 }, 3000)).toBeNull();
  expect(tracker.update({ ...status, processed: 5200 }, 100000)).toBeNull();
  expect(tracker.update({ ...status, processed: 5300 }, 102000)).toEqual({ fps: 50, remainingSeconds: 94 });
});

it("resets for a new job, video, total, regressed progress or clock", () => {
  for (const [next, now] of [
    [{ ...status, id: 2 }, 3000], [{ ...status, video_path: "other.mkv" }, 3000],
    [{ ...status, total: 20000 }, 3000], [status, 3000],
    [{ ...status, processed: 5300 }, 1000],
  ] as [PovStatus, number][]) {
    const tracker = new ScanSpeedTracker();
    tracker.update(status, 0);
    tracker.update({ ...status, processed: 5200 }, 2000);
    expect(tracker.update(next, now)).toBeNull();
  }
});

it("clamps remaining work at zero and formats readable estimates", () => {
  const tracker = new ScanSpeedTracker();
  tracker.update(status, 0);
  expect(tracker.update({ ...status, processed: 10001 }, 2000)?.remainingSeconds).toBe(0);
  expect([0, 4.2, 60, 61, 3599, 14500].map(scanRemainingTime)).toEqual(["0 s", "5 s", "1 min", "2 min", "1 h", "4 h 2 min"]);
});
