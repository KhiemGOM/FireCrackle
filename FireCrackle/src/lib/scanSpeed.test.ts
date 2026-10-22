import { expect, it } from "vitest";
import type { PovStatus } from "./api";
import type { GuiScanStatus } from "./guiScan";
import { ScanSpeedTracker, guiScanProgress, povScanProgress, scanRemainingTime, type ScanProgress } from "./scanSpeed";

const pov: PovStatus = { id: 1, video_path: "v.mkv", state: "running", processed: 5000, total: 10000, accepted: 0, applied: 0, error: null };
// The tracker sees only neutral progress, so every CV job (first-person, no-fire, GUI detector...) shares it.
type Status = PovStatus;
const status = pov;
class Tracker { private t = new ScanSpeedTracker(); update(s: Status, now: number) { return this.t.update(povScanProgress(s), now); } }

it("measures newly observed work rather than cached frames and waits for a baseline", () => {
  const tracker = new Tracker();
  expect(tracker.update(status, 100)).toBeNull();
  expect(tracker.update({ ...status, processed: 5100 }, 1100)).toBeNull();
  expect(tracker.update({ ...status, processed: 5200 }, 2100)).toEqual({ fps: 100, remainingSeconds: 48 });
});

it("uses recent speed and loses its ETA when work stalls", () => {
  const tracker = new Tracker();
  tracker.update(status, 0);
  tracker.update({ ...status, processed: 6000 }, 10000);
  expect(tracker.update({ ...status, processed: 6200 }, 20000)?.fps).toBe(60);
  expect(tracker.update({ ...status, processed: 6400 }, 30000)?.fps).toBe(20);
  tracker.update({ ...status, processed: 6400 }, 40000);
  expect(tracker.update({ ...status, processed: 6400 }, 50000)).toEqual({ fps: 0, remainingSeconds: null });
});

it("excludes paused time on resume", () => {
  const tracker = new Tracker();
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
  ] as [Status, number][]) {
    const tracker = new Tracker();
    tracker.update(status, 0);
    tracker.update({ ...status, processed: 5200 }, 2000);
    expect(tracker.update(next, now)).toBeNull();
  }
});

it("clamps remaining work at zero and formats readable estimates", () => {
  const tracker = new Tracker();
  tracker.update(status, 0);
  expect(tracker.update({ ...status, processed: 10001 }, 2000)?.remainingSeconds).toBe(0);
  expect([0, 4.2, 60, 61, 3599, 14500].map(scanRemainingTime)).toEqual(["0 s", "5 s", "1 min", "2 min", "1 h", "4 h 2 min"]);
});

it("a job with no known total has a speed but no ETA, instead of claiming 0 s remaining", () => {
  const tracker = new ScanSpeedTracker();
  const job = (processed: number): ScanProgress => ({ identity: "gui|v.mkv", running: true, processed, total: 0 });
  tracker.update(job(0), 0);
  expect(tracker.update(job(300), 3000)).toEqual({ fps: 100, remainingSeconds: null });
});

it("maps first-person/no-fire and GUI detector statuses to the same progress shape", () => {
  expect(povScanProgress(pov)).toEqual({ identity: JSON.stringify([1, "v.mkv", 10000]), running: true, processed: 5000, total: 10000 });
  expect(povScanProgress({ ...pov, state: "saving" }).running).toBe(false);
  const gui: GuiScanStatus = { video_path: "v.mkv", state: "running", processed: 40, total: 100, detected: 3, ranges: [], error: null };
  expect(guiScanProgress(gui)).toEqual({ identity: JSON.stringify(["gui", "v.mkv", 100]), running: true, processed: 40, total: 100 });
  for (const state of ["ready", "paused", "done", "error"] as const) expect(guiScanProgress({ ...gui, state }).running).toBe(false);
  expect(guiScanProgress(gui).identity).not.toBe(guiScanProgress({ ...gui, video_path: "other.mkv" }).identity);
});

it("measures a GUI detector scan from the frames it actually scans, not the resumed checkpoint", () => {
  const tracker = new ScanSpeedTracker();
  const gui: GuiScanStatus = { video_path: "v.mkv", state: "running", processed: 90_000, total: 100_000, detected: 0, ranges: [], error: null };
  tracker.update(guiScanProgress(gui), 0);
  expect(tracker.update(guiScanProgress({ ...gui, processed: 90_600 }), 2000)).toEqual({ fps: 300, remainingSeconds: 9400 / 300 });
});
