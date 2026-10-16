import { describe, expect, it } from "vitest";
import { formatTimecode } from "./timecode";

describe("formatTimecode", () => {
  it("writes hours, minutes, seconds and the frame within the second", () => {
    expect(formatTimecode(52 * 60 + 15 + 58 / 60, 60)).toBe("00:52:15|58");
  });

  it("starts at zero", () => {
    expect(formatTimecode(0, 60)).toBe("00:00:00|00");
  });

  it("counts frames from 00 up to fps-1 within a second", () => {
    expect(formatTimecode(1, 60)).toBe("00:00:01|00");
    expect(formatTimecode(1 + 59 / 60, 60)).toBe("00:00:01|59");
    expect(formatTimecode(1 + 14 / 30, 30)).toBe("00:00:01|14");
  });

  it("carries into the next second instead of showing a frame number equal to fps", () => {
    expect(formatTimecode(15.9999, 60)).toBe("00:00:16|00");
    expect(formatTimecode(59.999, 60)).toBe("00:01:00|00");
    expect(formatTimecode(3599.9999, 60)).toBe("01:00:00|00");
  });

  it("handles hours, padding to two digits and beyond", () => {
    expect(formatTimecode(3725.5, 60)).toBe("01:02:05|30");
    expect(formatTimecode(360000, 60)).toBe("100:00:00|00");
  });

  it("rounds fractional rates up to a whole frame rate (59.94 -> 60, 29.97 -> 30)", () => {
    expect(formatTimecode(1 + 59 / 60, 59.94)).toBe("00:00:01|59");
    expect(formatTimecode(1 + 29 / 30, 29.97)).toBe("00:00:01|29");
  });

  it("keeps neighbouring frames apart when the average rate is below the capture rate", () => {
    expect(formatTimecode(30 / 60, 59.4)).not.toBe(formatTimecode(31 / 60, 59.4));
    expect(formatTimecode(15 / 30, 30.4)).not.toBe(formatTimecode(16 / 30, 30.4));
  });

  it("never prints a negative or non-numeric time", () => {
    expect(formatTimecode(-5, 60)).toBe("00:00:00|00");
    expect(formatTimecode(NaN, 60)).toBe("00:00:00|00");
    expect(formatTimecode(Infinity, 60)).toBe("00:00:00|00");
  });

  it("has a single frame slot for an unusable frame rate rather than crashing", () => {
    expect(formatTimecode(5, 0)).toBe("00:00:05|00");
    expect(formatTimecode(5, NaN)).toBe("00:00:05|00");
    expect(formatTimecode(5, -30)).toBe("00:00:05|00");
  });

  it("two frames one apart differ only in the last field", () => {
    expect(formatTimecode(100 / 60, 60)).toBe("00:00:01|40");
    expect(formatTimecode(101 / 60, 60)).toBe("00:00:01|41");
  });
});
