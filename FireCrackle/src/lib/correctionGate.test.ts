import { describe, expect, it } from "vitest";
import { correctsNow } from "./correctionGate";

describe("when the picture correction (veil, portal) runs", () => {
  it("never runs with both off", () => {
    expect(correctsNow({ playing: false, veilMode: "off", portalMode: "off" })).toBe(false);
    expect(correctsNow({ playing: true, veilMode: "off", portalMode: "off" })).toBe(false);
  });

  it("runs on a paused picture when veil is on or auto, or portal is auto", () => {
    expect(correctsNow({ playing: false, veilMode: "on", portalMode: "off" })).toBe(true);
    expect(correctsNow({ playing: false, veilMode: "auto", portalMode: "off" })).toBe(true);
    expect(correctsNow({ playing: false, veilMode: "off", portalMode: "auto" })).toBe(true);
    expect(correctsNow({ playing: false, veilMode: "on", portalMode: "auto" })).toBe(true);
  });

  it("does not run while playing, whatever is switched on: the pictures would never keep up and none would be shown", () => {
    for (const veilMode of ["off", "auto", "on"] as const)
      for (const portalMode of ["off", "auto"] as const)
        expect(correctsNow({ playing: true, veilMode, portalMode })).toBe(false);
  });

  it("covers the Enhance stage too: it runs on a paused picture and never while playing", () => {
    expect(correctsNow({ playing: false, veilMode: "off", portalMode: "off", enhance: true })).toBe(true);
    expect(correctsNow({ playing: true, veilMode: "off", portalMode: "off", enhance: true })).toBe(false);
    expect(correctsNow({ playing: true, veilMode: "on", portalMode: "auto", enhance: true })).toBe(false);
    expect(correctsNow({ playing: false, veilMode: "off", portalMode: "off", enhance: false })).toBe(false);
  });
});
