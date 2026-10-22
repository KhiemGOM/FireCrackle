import { expect, it } from "vitest";
import { readJson, readVideoJson, videoStorageKey, writeJson } from "./videoStorage";

const memory = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };

it("one video gets one key whatever its slash style or Windows letter case", () => {
  expect(videoStorageKey("quads.v1", String.raw`D:\Clips\Fire.mkv`)).toBe(videoStorageKey("quads.v1", "d:/clips/fire.mkv"));
  expect(videoStorageKey("quads.v1", "/home/a/Fire.mkv")).not.toBe(videoStorageKey("quads.v1", "/home/a/fire.mkv"));
  expect(videoStorageKey("view.v1", "d:/a.mkv", "phase")).toBe(`firecrackle.view.v1:${encodeURIComponent("d:/a.mkv")}:phase`);
});

it("state saved under the old raw-path key is still found", () => {
  const s = memory();
  const raw = String.raw`D:\Clips\Fire.mkv`;
  s.setItem(`firecrackle.quads.v1:${encodeURIComponent(raw)}`, JSON.stringify({ "3": [1] }));
  expect(readVideoJson("quads.v1", raw, s)).toEqual({ "3": [1] });
  // The normalised key wins once it exists.
  s.setItem(videoStorageKey("quads.v1", raw), JSON.stringify({ "4": [2] }));
  expect(readVideoJson("quads.v1", raw, s)).toEqual({ "4": [2] });
});

it("reading never throws: missing, corrupt or unavailable storage is null", () => {
  const s = memory();
  expect(readJson("nope", s)).toBeNull();
  s.setItem("bad", "{not json");
  expect(readJson("bad", s)).toBeNull();
  expect(readJson("x", { getItem: () => { throw new Error("denied"); } })).toBeNull();
  expect(readVideoJson("quads.v1", undefined, s)).toBeNull();
});

it("writing reports failure instead of throwing", () => {
  const s = memory();
  expect(writeJson("k", { a: 1 }, s)).toBe(true);
  expect(s.m.get("k")).toBe('{"a":1}');
  expect(writeJson("k", 1, { setItem: () => { throw new Error("quota"); } })).toBe(false);
});
