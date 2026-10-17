import { describe, expect, it, vi } from "vitest";
import { parseJump, resolveJump } from "./jump";
import { formatTimecode } from "./timecode";

const err = (r: unknown) => (r as { error?: string }).error;

describe("parseJump: frames", () => {
  it("reads a whole number as a frame", () => {
    expect(parseJump("1234", 60, 5000)).toEqual({ kind: "frame", frame: 1234 });
    expect(parseJump("0", 60, 5000)).toEqual({ kind: "frame", frame: 0 });
    expect(parseJump("4999", 60, 5000)).toEqual({ kind: "frame", frame: 4999 });
  });

  it("ignores surrounding spaces", () => {
    expect(parseJump("  42 ", 60, 5000)).toEqual({ kind: "frame", frame: 42 });
  });

  it("refuses a frame past the last one, naming the range", () => {
    const e = err(parseJump("5000", 60, 5000));
    expect(e).toMatch(/0.*4999/);
  });

  it("refuses when the video has no frames", () => {
    expect(err(parseJump("0", 60, 0))).toBeTruthy();
  });
});

describe("parseJump: timecodes", () => {
  it("reads the status bar's own HH:MM:SS|FF", () => {
    expect(parseJump("00:52:15|58", 60, 1e9)).toEqual({ kind: "time", seconds: 52 * 60 + 15 + 58 / 60 });
    expect(parseJump("00:00:00|00", 60, 1e9)).toEqual({ kind: "time", seconds: 0 });
    expect(parseJump("01:02:05|30", 60, 1e9)).toEqual({ kind: "time", seconds: 3725.5 });
  });

  it("accepts shorter forms counted from the right", () => {
    expect(parseJump("02:05|30", 60, 1e9)).toEqual({ kind: "time", seconds: 125.5 });
    expect(parseJump("05|30", 60, 1e9)).toEqual({ kind: "time", seconds: 5.5 });
    expect(parseJump("1:02:03", 60, 1e9)).toEqual({ kind: "time", seconds: 3723 });
    expect(parseJump("2:05", 60, 1e9)).toEqual({ kind: "time", seconds: 125 });
  });

  it("allows hours past 99 and a leading unit past its usual range", () => {
    expect(parseJump("100:00:00|00", 60, 1e9)).toEqual({ kind: "time", seconds: 360000 });
    expect(parseJump("75:00", 60, 1e9)).toEqual({ kind: "time", seconds: 4500 });
  });

  it("uses the nominal frame rate for FF, as the display does", () => {
    expect(parseJump("00:00:01|29", 29.97, 1e9)).toEqual({ kind: "time", seconds: 1 + 29 / 30 });
    expect(parseJump("00:00:01|59", 59.94, 1e9)).toEqual({ kind: "time", seconds: 1 + 59 / 60 });
  });

  it("is the exact inverse of formatTimecode", () => {
    for (const fps of [60, 30, 59.94, 24]) {
      const rate = Math.round(fps);
      for (const frame of [0, 1, 59, 60, 61, 3599, 216000 + 17, 1234567]) {
        const t = frame / rate;
        const r = parseJump(formatTimecode(t, fps), fps, 1e9) as { seconds: number };
        expect(Math.round(r.seconds * rate)).toBe(frame);
      }
    }
  });

  it("treats a missing or bad fps as 1 frame per second, like formatTimecode", () => {
    expect(parseJump("00:00:05|00", NaN, 1e9)).toEqual({ kind: "time", seconds: 5 });
    expect(err(parseJump("00:00:05|01", 0, 1e9))).toBeTruthy();
  });
});

describe("parseJump: refusals", () => {
  it.each([
    [""],
    ["   "],
    ["abc"],
    ["12.5"],
    ["-5"],
    ["1:2:3:4"],
    ["00:00:01|"],
    ["|30"],
    ["00::01"],
    ["00:00:01|5x"],
  ])("refuses %j with a message saying what to type", (text) => {
    expect(err(parseJump(text, 60, 1e9))).toMatch(/frame|HH:MM:SS\|FF/);
  });

  it("refuses FF at or past the nominal rate instead of wrapping", () => {
    expect(err(parseJump("00:00:01|60", 60, 1e9))).toBeTruthy();
    expect(err(parseJump("00:00:01|30", 29.97, 1e9))).toBeTruthy();
  });

  it("refuses seconds or minutes of 60 or more under a larger unit", () => {
    expect(err(parseJump("00:00:60|00", 60, 1e9))).toBeTruthy();
    expect(err(parseJump("00:61:00", 60, 1e9))).toBeTruthy();
  });
});

describe("resolveJump", () => {
  const ctx = { fps: 60, frameCount: 10000, current: 600, pts: 10 };

  it("jumps straight to a typed frame without asking the backend", async () => {
    const locate = vi.fn();
    expect(await resolveJump("1234", ctx, locate)).toEqual({ frame: 1234 });
    expect(locate).not.toHaveBeenCalled();
  });

  it("asks the backend for the frame nearest a typed time", async () => {
    const locate = vi.fn(async () => 777);
    expect(await resolveJump("00:00:12|57", ctx, locate)).toEqual({ frame: 777 });
    expect(locate).toHaveBeenCalledWith(12 + 57 / 60);
  });

  it("without a backend, estimates from the current frame and its time", async () => {
    expect(await resolveJump("00:00:12|00", ctx)).toEqual({ frame: 720 });
    expect(await resolveJump("00:00:00|00", ctx)).toEqual({ frame: 0 });
    expect(await resolveJump("10:00:00|00", ctx)).toEqual({ frame: 9999 });
  });

  it("reports a backend failure instead of jumping", async () => {
    const locate = vi.fn(async () => {
      throw new Error("Invalid Jolt video timestamp");
    });
    expect(err(await resolveJump("00:00:01|00", ctx, locate))).toMatch(/Invalid Jolt video timestamp/);
  });

  it("passes a parse error through", async () => {
    expect(err(await resolveJump("nope", ctx))).toBeTruthy();
  });
});
