import { expect, it } from "vitest";
import { readTimelineView, readVideoView, writeTimelineView, writeVideoView } from "./viewState";

function memory() { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } }; }
it("remembers video rotation without changing old saved view shapes", () => {
  const storage = memory();
  writeVideoView("rotated", { scale: 2, x: -35, y: 10, angle: 47 }, storage);
  expect(readVideoView("rotated", storage)).toEqual({ scale: 2, x: -35, y: 10, angle: 47 });
  expect(readVideoView("old", { getItem: () => '{"scale":2,"x":3,"y":4}' })).toEqual({ scale: 2, x: 3, y: 4 });
  expect(readVideoView("bad", { getItem: () => '{"scale":2,"x":3,"y":4,"angle":"bad"}' })).toEqual({ scale: 2, x: 3, y: 4 });
});
it("keeps video transforms separate by video and preserves off-image pan", () => {
  const storage = memory();
  writeVideoView("a.mkv", { scale: 3, x: -900, y: 700 }, storage);
  expect(readVideoView("a.mkv", storage)).toEqual({ scale: 3, x: -900, y: 700 });
  expect(readVideoView("b.mkv", storage)).toEqual({ scale: 1, x: 0, y: 0 });
  expect(readVideoView(undefined, storage)).toEqual({ scale: 1, x: 0, y: 0 });
});
it("restores timeline and shared phase-chart ranges across widths without mixing them", () => {
  const storage = memory();
  writeTimelineView("a", "timeline", 1000, 900, { start: 100, pxPerFrame: 9 }, storage);
  expect(readTimelineView("a", "timeline", 1000, 1800, storage)).toEqual({ start: 100, pxPerFrame: 18 });
  expect(readTimelineView("a", "phase", 1000, 1000, storage)).toEqual({ start: 0, pxPerFrame: 1 });
  expect(readTimelineView("a", "timeline", 2000, 1000, storage)).toEqual({ start: 0, pxPerFrame: 0.5 });
});
it("falls back safely for malformed storage and impossible ranges", () => {
  expect(readVideoView("a", { getItem: () => '{"scale":-1,"x":0,"y":0}' }).scale).toBe(1);
  expect(readTimelineView("a", "timeline", 1000, 900, { getItem: () => '{"total":1000,"span":0,"start":2}' })).toEqual({ start: 0, pxPerFrame: 0.9 });
  expect(readVideoView("a", { getItem: () => { throw Error("blocked"); } }).scale).toBe(1);
  expect(() => writeVideoView("a", { scale: 2, x: 0, y: 0 }, { setItem: () => { throw Error("full"); } })).not.toThrow();
});

// the view is kept with the size of the video area it was made in, so a window that opens at another size first can
// put the picture back where it was (hooks/useAnchoredView.ts)
import { readVideoViewBox } from "./viewState";
it("keeps the video area's size with the view; old saves and bad sizes have none", () => {
  const storage = memory();
  writeVideoView("a.mkv", { scale: 3, x: -900, y: 700 }, storage, { w: 1600, h: 900 });
  expect(readVideoView("a.mkv", storage)).toEqual({ scale: 3, x: -900, y: 700 });
  expect(readVideoViewBox("a.mkv", storage)).toEqual({ w: 1600, h: 900 });
  writeVideoView("b.mkv", { scale: 3, x: -900, y: 700 }, storage);
  expect(readVideoViewBox("b.mkv", storage)).toBeNull();
  expect(readVideoViewBox("old", { getItem: () => '{"scale":2,"x":3,"y":4}' })).toBeNull();
  expect(readVideoViewBox("bad", { getItem: () => '{"scale":2,"x":3,"y":4,"box":{"w":0,"h":900}}' })).toBeNull();
  expect(readVideoViewBox(undefined, storage)).toBeNull();
});
