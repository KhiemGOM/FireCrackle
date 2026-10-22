import { expect, it, vi } from "vitest";
import { clamp, clampFrame, frameAtTime } from "./frameMath";

it("clamps numbers into a range", () => {
  expect([clamp(-1, 0, 5), clamp(3, 0, 5), clamp(9, 0, 5)]).toEqual([0, 3, 5]);
});

it("keeps a frame inside the video, whatever was passed", () => {
  expect(clampFrame(-3, 100)).toBe(0);
  expect(clampFrame(42.6, 100)).toBe(43);
  expect(clampFrame(500, 100)).toBe(99);
  expect(clampFrame(Number.NaN, 100)).toBe(0);
  expect(clampFrame(7, 0)).toBe(0); // no frames: frame 0, never -1
});

it("a time maps to the backend's exact timestamp lookup when there is one", async () => {
  const locate = vi.fn(async (t: number) => (t === 1.5 ? 91 : -1));
  await expect(frameAtTime(1.5, { fps: 60, frameCount: 1000, locate })).resolves.toBe(91);
  expect(locate).toHaveBeenCalledWith(1.5);
});

it("without a lookup a time maps by frame rate, clamped to the video", async () => {
  await expect(frameAtTime(1.5, { fps: 60, frameCount: 1000 })).resolves.toBe(90);
  await expect(frameAtTime(-2, { fps: 60, frameCount: 1000 })).resolves.toBe(0);
  await expect(frameAtTime(999, { fps: 60, frameCount: 1000 })).resolves.toBe(999);
  await expect(frameAtTime(Number.NaN, { fps: 60, frameCount: 1000 })).resolves.toBe(0);
});

it("a failed lookup is reported, not silently replaced", async () => {
  await expect(frameAtTime(1, { fps: 60, frameCount: 10, locate: async () => { throw new Error("index missing"); } })).rejects.toThrow("index missing");
});
