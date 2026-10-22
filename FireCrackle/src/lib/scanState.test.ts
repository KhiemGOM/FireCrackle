import { expect, it } from "vitest";
import { sameVideo, scanStateLabel } from "./scanState";

it("names every scan state the same way for first-person, no-fire and GUI scans", () => {
  expect(scanStateLabel("running", 10)).toBe("Scanning");
  expect(scanStateLabel("saving", 10)).toBe("Saving labels");
  expect(scanStateLabel("done", 10)).toBe("Scan complete");
  expect(scanStateLabel("cancelled", 10)).toBe("Paused · progress saved");
  expect(scanStateLabel("paused", 10)).toBe("Paused · progress saved");
  expect(scanStateLabel("ready", 0)).toBe("Ready");
});

it("a failed scan never reads as Ready, whichever word the backend uses", () => {
  expect(scanStateLabel("failed", 10)).toBe("Scan failed · progress saved");
  expect(scanStateLabel("error", 10)).toBe("Scan failed · progress saved");
});

it("says what it is doing before the first frame when a model has to load", () => {
  expect(scanStateLabel("running", 0, { warmup: "Preparing AI" })).toBe("Preparing AI");
  expect(scanStateLabel("running", 1, { warmup: "Preparing AI" })).toBe("Scanning");
  expect(scanStateLabel("running", 0)).toBe("Scanning");
});

it("an unknown state is shown as itself, not guessed", () => {
  expect(scanStateLabel("verifying" as never, 3)).toBe("verifying");
});

it("a status belongs to the open video whatever its slash style or Windows letter case", () => {
  expect(sameVideo(String.raw`D:\Videos\fire.mkv`,"d:/videos/fire.mkv")).toBe(true);
  expect(sameVideo("/home/a/Fire.mkv", "/home/a/fire.mkv")).toBe(false);
  expect(sameVideo("D:/a.mkv", undefined)).toBe(false);
  expect(sameVideo(undefined, undefined)).toBe(false);
});
