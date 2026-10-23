import { describe, expect, it } from "vitest";
import { GUI_ASSUMPTION, maskStatus, overlayRgba, unpack, veilScreenEvidence, readGuiMaskFrame, screenWorld, type GuiMaskReply } from "./guiMask";

const reply = (over: Partial<GuiMaskReply> = {}): GuiMaskReply => ({
  width: 4, height: 1, reliable: true, scale: 4.5, scaled_width: 427, scaled_height: 240, notes: [],
  pieces: [{ piece: "Hotbar", count: 1 }, { piece: "Health", count: 10 }, { piece: "HotbarItem", count: 9 }], ...over,
});

function packet(metadata: GuiMaskReply, pixels: number[]) {
  const json = new TextEncoder().encode(JSON.stringify(metadata));
  const bytes = new Uint8Array(4 + json.length + pixels.length);
  new DataView(bytes.buffer).setUint32(0, json.length, true);
  bytes.set(json, 4); bytes.set(pixels, 4 + json.length);
  return bytes.buffer;
}

it("reads independent atomic masks without a latest-frame lookup", () => {
  const first = readGuiMaskFrame(packet(reply(), [0x11, 0x22, 0, 0]));
  const second = readGuiMaskFrame(packet(reply({width: 1}), [0x33]));
  expect([...first.packed!]).toEqual([0x11, 0x22, 0, 0]);
  expect([...second.packed!]).toEqual([0x33]);
  expect(first.reply.width).toBe(4);
  expect(readGuiMaskFrame(packet(reply({reliable:false,mask_available:false}), [])).packed).toBeNull();
});

it("rejects truncated or mismatched atomic mask packets", () => {
  for (const bytes of [new ArrayBuffer(2), new Uint8Array([99,0,0,0]).buffer,
    packet(reply(), [0x11]), packet(reply({width:-4}), []),
    packet(reply({reliable:false,mask_available:false}), [0])]) {
    expect(() => readGuiMaskFrame(bytes)).toThrow();
  }
});

describe("the GUI compatibility assumption", () => {
  it("uses only reliable, texture-confirmed menu/inventory pieces as veil evidence", () => {
    for (const piece of ["InventoryPanel", "MenuButton"]) {
      expect(veilScreenEvidence(reply({ pieces: [{ piece, count: 1 }] }))).toEqual(piece === "MenuButton" ? { width: 4, height: 1, menu: true } : { width: 4, height: 1 });
      expect(veilScreenEvidence(reply({ reliable: false, pieces: [{ piece, count: 1 }] }))).toBeUndefined();
      expect(veilScreenEvidence(reply({ pieces: [{ piece, count: 0 }] }))).toBeUndefined();
    }
    expect(veilScreenEvidence(reply())).toBeUndefined(); // ordinary HUD
    expect(veilScreenEvidence(reply({reliable:false,mask_available:true,pieces:[{piece:'InventoryPanel',count:1}]}))).toEqual({width:4,height:1});
    expect(veilScreenEvidence(null)).toBeUndefined();
  });
  it("says a screen is a menu only when no inventory is open (containers draw the flat veil in every version)", () => {
    expect(veilScreenEvidence(reply({ pieces: [{ piece: "MenuButton", count: 3 }] }))?.menu).toBe(true);
    expect(veilScreenEvidence(reply({ pieces: [{ piece: "MenuButton", count: 3 }, { piece: "InventoryPanel", count: 1 }] }))?.menu).toBeUndefined();
    expect(veilScreenEvidence(reply({ pieces: [{ piece: "InventoryPanel", count: 1 }, { piece: "MenuButton", count: 0 }] }))?.menu).toBeUndefined();
  });
  it("distinguishes the HUD reference from independently detected versioned panels", () => {
    expect(GUI_ASSUMPTION).toContain("1.16.5");
    expect(GUI_ASSUMPTION).toContain("1.21.11");
    expect(GUI_ASSUMPTION).toContain("neutral");
    expect(GUI_ASSUMPTION).not.toContain("?");
  });
});

describe("unpack", () => {
  it("splits the packed byte into piece and class", () => {
    expect(unpack(0x11)).toEqual({ piece: 1, cls: 1 });
    expect(unpack(0x37)).toEqual({ piece: 7, cls: 3 });
    expect(unpack(0)).toEqual({ piece: 0, cls: 0 });
  });
  it("reads the open-screen flag apart from the class", () => {
    // inventory (24) packs into the low nibble as 8, like Armor; the flag tells them apart
    expect(unpack(0x78)).toEqual({ piece: 8, cls: 3, screen: true });
    expect(unpack(0x38).screen).toBeFalsy();
  });
});

describe("screenWorld", () => {
  it("leaves only open-screen pixels out: the hotbar and HUD are world for unveil", () => {
    expect(screenWorld(new Uint8Array([0x00, 0x11, 0x38, 0x78, 0x79, 0x7a]))).toEqual(new Uint8Array([1, 1, 1, 0, 0, 0]));
  });
  it("is all world for a frame with no GUI", () => {
    expect(screenWorld(new Uint8Array(3))).toEqual(new Uint8Array([1, 1, 1]));
  });
});

describe("overlayRgba", () => {
  it("colours a flagged screen pixel by its class", () => {
    expect(Array.from(overlayRgba(new Uint8Array([0x78]), 1, 1))).toEqual(Array.from(overlayRgba(new Uint8Array([0x38]), 1, 1)));
  });
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
  it("identifies title and subtitle masks instead of hiding their source", () => {
    expect(maskStatus(reply({ pieces: [{ piece: "Title", count: 1 }, { piece: "Subtitle", count: 1 }] }))).toContain("Title · Subtitle");
  });
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
