// The GUI mask in the app: the documented compatibility assumption, the overlay colouring and
// the status line. Pure functions (tested in guiMask.test.ts); the panel is components/GuiMaskControls.tsx.

export type GuiAnswer = "yes" | "no" | "not_sure";

export const GUI_ASSUMPTION = "Vanilla GUI textures only. HUD fitting uses 1.16.5; known interaction panels include audited artwork variants through 1.21.11. Panel masks are neutral regions and do not require a visible hotbar.";

export interface GuiMaskReply {
  width: number;
  height: number;
  reliable: boolean;
  mask_available?: boolean;
  /** Video pixels per GUI pixel. */
  scale: number | null;
  scaled_width: number | null;
  scaled_height: number | null;
  notes: string[];
  pieces: Array<{ piece: string; count: number }>;
}

export interface GuiMaskFrame { reply: GuiMaskReply; packed: Uint8Array | null }

/** One binary IPC reply: little-endian JSON length, JSON metadata, packed mask. */
export function readGuiMaskFrame(bytes: ArrayBuffer): GuiMaskFrame {
  if (bytes.byteLength < 4) throw new Error("GUI mask response is truncated");
  const size = new DataView(bytes).getUint32(0, true);
  if (size > bytes.byteLength - 4) throw new Error("GUI mask metadata is truncated");
  const reply: GuiMaskReply = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 4, size)));
  const count = reply.width * reply.height;
  if (!Number.isSafeInteger(count) || !Number.isInteger(reply.width) || !Number.isInteger(reply.height) || reply.width <= 0 || reply.height <= 0) throw new Error("Invalid GUI mask dimensions");
  const available = reply.mask_available ?? reply.reliable;
  const packed = new Uint8Array(bytes, 4 + size);
  if (packed.length !== (available ? count : 0)) throw new Error("GUI mask pixels do not match their metadata");
  return { reply, packed: available ? packed : null };
}

/** A texture-confirmed open screen, not merely the always-visible HUD. */
export function veilScreenEvidence(reply: GuiMaskReply | null): ScreenEvidence | undefined {
  if (!reply || !(reply.mask_available ?? reply.reliable) || !(reply.width > 0) || !(reply.height > 0)) return undefined;
  const has = (piece: string) => !!reply.pieces?.some(p => p.count > 0 && p.piece === piece);
  if (has("InventoryPanel")) return { width: reply.width, height: reply.height };
  // menu buttons and no inventory: a menu, which 1.21+ veils its own way (the Enhance panel's menu veil)
  return has("MenuButton") ? { width: reply.width, height: reply.height, menu: true } : undefined;
}
/** An open screen the GUI detector found on a picture of this size; `menu` when it is a menu, not an inventory. */
export interface ScreenEvidence { width: number; height: number; menu?: true }

/** Set on pixels of an open screen (inventory, menu buttons, recipe book): studio_core::gui::SCREEN_FLAG. */
const SCREEN_FLAG = 0x40;
const classOf = (b: number) => (b >> 4) & 0x03;

/** Piece id (low nibble), pixel class (bits 4-5: 0 none, 1 opaque, 2 translucent, 3 unknown), open-screen flag. */
export function unpack(b: number): { piece: number; cls: number; screen?: true } {
  return b & SCREEN_FLAG ? { piece: b & 0x0f, cls: classOf(b), screen: true } : { piece: b & 0x0f, cls: classOf(b) };
}

/** What unveil may change: 0 on an open screen, 1 everywhere else (the hotbar and HUD are drawn over the veil too). */
export function screenWorld(packed: Uint8Array): Uint8Array {
  const world = new Uint8Array(packed.length);
  for (let i = 0; i < packed.length; i++) world[i] = packed[i] & SCREEN_FLAG ? 0 : 1;
  return world;
}

const TINT: Record<number, [number, number, number, number]> = {
  1: [255, 40, 40, 120], // opaque: red
  2: [40, 110, 255, 120], // translucent (world still visible): blue
  3: [255, 215, 0, 110], // unknown: yellow
};

/** RGBA overlay for the packed mask: see-through tints, clear where there is no GUI. */
export function overlayRgba(packed: Uint8Array, width: number, height: number): Uint8ClampedArray {
  if (!(width > 0) || !(height > 0) || packed.length !== width * height) {
    throw new Error(`the mask must be ${width}x${height} (${width * height} bytes), got ${packed.length}`);
  }
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < packed.length; i++) {
    const t = TINT[classOf(packed[i])];
    if (!t) continue;
    out.set(t, i * 4);
  }
  return out;
}

/** Names as the user reads them. */
const NAMES: Record<string, string> = {
  Hotbar: "Hotbar",
  SelectedSlot: "Selected slot",
  Offhand: "Offhand",
  XpBar: "XP bar",
  Health: "Health",
  Armor: "Armor",
  Food: "Food",
  Air: "Air",
  EffectIcon: "Effect icon",
  Title: "Title",
  Subtitle: "Subtitle",
  InventoryPanel: "Inventory",
  MenuButton: "Menu buttons",
  RecipeBookPanel: "Recipe book",
  ItemTooltip: "Item tooltip",
};

/** One line for the panel: the scale and the pieces found, or why nothing was found. */
export function maskStatus(r: GuiMaskReply): string {
  if (!r.reliable && r.mask_available) return "GUI panel found · neutral mask · HUD not fitted";
  if (!r.reliable || r.scale === null) {
    return r.notes[0] ?? "No vanilla HUD was found on this frame, so nothing is masked.";
  }
  const parts = r.pieces
    .filter((p) => NAMES[p.piece])
    .map((p) => (p.count > 1 ? `${p.count} ${NAMES[p.piece]}` : NAMES[p.piece]));
  return `GUI scale ${r.scale.toFixed(2)} px per GUI px · ${parts.join(" · ")}`;
}
