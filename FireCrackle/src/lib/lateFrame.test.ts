import { describe, expect, it } from "vitest";
import { shouldShowLate } from "./lateFrame";

const base = { frame: 100, shown: 90, current: 105, dir: 1 as const, maxLag: 30 };

describe("a frame that arrived after the playhead moved on", () => {
  it("is shown when it is newer than the picture on screen and close to the playhead", () => {
    expect(shouldShowLate(base)).toBe(true);
  });

  it("is shown while playing backwards when it is newer in that direction", () => {
    expect(shouldShowLate({ frame: 100, shown: 110, current: 95, dir: -1, maxLag: 30 })).toBe(true);
  });

  it("is shown when nothing is on screen yet", () => {
    expect(shouldShowLate({ ...base, shown: null })).toBe(true);
  });

  it("is not shown when it is older than, or the same as, what is on screen", () => {
    expect(shouldShowLate({ ...base, frame: 89 })).toBe(false);
    expect(shouldShowLate({ ...base, frame: 90 })).toBe(false);
    expect(shouldShowLate({ frame: 100, shown: 95, current: 90, dir: -1, maxLag: 30 })).toBe(false);
  });

  it("is not shown when it lies further behind the playhead than the allowed lag", () => {
    expect(shouldShowLate({ ...base, frame: 70, shown: 60, current: 105 })).toBe(false);
    expect(shouldShowLate({ ...base, frame: 75, shown: 60, current: 105 })).toBe(true); // exactly the lag
    expect(shouldShowLate({ ...base, frame: 74, shown: 60, current: 105 })).toBe(false);
  });

  it("is not shown when the playhead has jumped to somewhere else", () => {
    expect(shouldShowLate({ ...base, frame: 100, shown: 90, current: 5000 })).toBe(false);
    expect(shouldShowLate({ ...base, frame: 100, shown: 90, current: 3 })).toBe(false);
  });

  it("is not shown while paused: a step or a seek wants exactly its own frame", () => {
    expect(shouldShowLate({ ...base, dir: 0 })).toBe(false);
  });

  it("is never shown with a lag of 0, NaN or a negative number (the feature is off)", () => {
    for (const maxLag of [0, NaN, -5]) expect(shouldShowLate({ ...base, maxLag })).toBe(false);
  });

  it("ignores a frame ahead of the playhead (it is not late)", () => {
    expect(shouldShowLate({ ...base, frame: 110, current: 105 })).toBe(false);
  });

  it("copes with odd numbers without throwing", () => {
    expect(() => shouldShowLate({ frame: NaN, shown: Infinity, current: -1, dir: 1, maxLag: Infinity })).not.toThrow();
    expect(shouldShowLate({ frame: NaN, shown: null, current: 5, dir: 1, maxLag: 30 })).toBe(false);
  });
});
