import { describe, expect, it } from "vitest";
import { GUI_ASSUMPTION, maskStatus, overlayRgba, unpack, type GuiMaskReply } from "./guiMask";

const reply = (over: Partial<GuiMaskReply> = {}): GuiMaskReply => ({
  width: 4, height: 1, reliable: true, scale: 4.5, scaled_width: 427, scaled_height: 240, notes: [],
  pieces: [{ piece: "Hotbar", count: 1 }, { piece: "Health", count: 10 }, { piece: "HotbarItem", count: 9 }], ...over,
});

describe("the GUI compatibility assumption", () => {
  it("states the reference GUI and reliable-fit requirement without asking a question", () => {
    expect(GUI_ASSUMPTION).toContain("Assumes");
    expect(GUI_ASSUMPTION).toContain("1.16.5");
    expect(GUI_ASSUMPTION).toContain("reliable");
    expect(GUI_ASSUMPTION).not.toContain("?");
  });
});

describe("unpack", () => {
  it("splits the packed byte into piece and class", () => {
    expect(unpack(0x11)).toEqual({ piece: 1, cls: 1 });
    expect(unpack(0x37)).toEqual({ piece: 7, cls: 3 });
    expect(unpack(0)).toEqual({ piece: 0, cls: 0 });
  });
});

describe("overlayRgba", () => {
  it("colours opaque red, translucent blue, unknown yellow and leaves the rest clear", () => {
    const px = overlayRgba(new Uint8Array([0x00, 0x11, 0x21, 0x31]), 4, 1);
    expect(px).toHaveLength(16);
    expect(Array.from(px.slice(0, 4))).toEqual([0, 0, 0, 0]);
    expect(px[4]).toBeGreaterThan(200);
    expect(px[7]).toBeGreaterThan(0);
    expect(px[10]).toBeGreaterThan(200);
    expect(px[8]).toBeLessThan(100);
    expect(px[12]).toBeGreaterThan(200);
    expect(px[13]).toBeGreaterThan(180);
    expect(px[14]).toBeLessThan(100);
  });
  it("keeps the overlay see-through so the frame stays visible", () => {
    const px = overlayRgba(new Uint8Array([0x11]), 1, 1);
    expect(px[3]).toBeLessThan(200);
  });
  it("rejects a buffer of the wrong size", () => {
    expect(() => overlayRgba(new Uint8Array(3), 2, 2)).toThrow();
    expect(() => overlayRgba(new Uint8Array(0), 0, 0)).toThrow();
  });
});

describe("maskStatus", () => {
  it("states the scale and the pieces found, without the unknown-content boxes", () => {
    const s = maskStatus(reply());
    expect(s).toContain("4.50");
    expect(s).toContain("Hotbar");
    expect(s).toContain("10 Health");
    expect(s).not.toContain("HotbarItem");
  });
  it("gives the reason when no vanilla HUD was found", () => {
    const s = maskStatus(reply({ reliable: false, scale: null, scaled_width: null, scaled_height: null, pieces: [], notes: ["no vanilla hotbar found at any scale"] }));
    expect(s).toContain("no vanilla hotbar found");
  });
  it("still says something when there is no note", () => {
    expect(maskStatus(reply({ reliable: false, scale: null, pieces: [], notes: [] })).length).toBeGreaterThan(10);
  });
});
