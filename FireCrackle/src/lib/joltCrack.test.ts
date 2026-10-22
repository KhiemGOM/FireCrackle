import { expect, it } from "vitest";
import { crackImport, crackLabel, type JoltCrackStatus } from "./joltCrack";

const base: JoltCrackStatus = { id: 4, video_path: "D:/v/run.mkv", state: "running", message: "reading frames", percent: 40, version: "2.5", result: null, error: null };

it("says what JoltCracker is doing, with its progress", () => {
  expect(crackLabel({ ...base, state: "preparing", message: "Finding JoltCracker…", percent: null })).toBe("Finding JoltCracker…");
  expect(crackLabel(base)).toBe("JoltCracker v2.5 · reading frames · 40%");
  expect(crackLabel({ ...base, percent: null })).toBe("JoltCracker v2.5 · reading frames");
  expect(crackLabel({ ...base, state: "done", percent: 100 })).toBe("JoltCracker v2.5 finished · imported as this video's Jolt clock");
  expect(crackLabel({ ...base, state: "cancelled" })).toBe("JoltCracker stopped");
  expect(crackLabel({ ...base, state: "failed", error: "Jolt found no hunger bar in the video (Jolt error J07)" })).toBe("Jolt found no hunger bar in the video (Jolt error J07)");
});

it("imports a finished result once, and only into the video it was run on", () => {
  const done: JoltCrackStatus = { ...base, state: "done", result: '{"version":"2.5","runs":[]}' };
  expect(crackImport(done, String.raw`d:\v\run.mkv`, null)).toEqual({ id: 4, text: done.result, name: "JoltCracker v2.5 · run.mkv" });
  expect(crackImport(done, "D:/v/run.mkv", 4)).toBeNull(); // already imported
  expect(crackImport(done, "D:/v/other.mkv", null)).toBeNull(); // another video is open now
  expect(crackImport(base, "D:/v/run.mkv", null)).toBeNull(); // not finished
  expect(crackImport({ ...done, result: null }, "D:/v/run.mkv", null)).toBeNull();
  expect(crackImport(null, "D:/v/run.mkv", null)).toBeNull();
});
