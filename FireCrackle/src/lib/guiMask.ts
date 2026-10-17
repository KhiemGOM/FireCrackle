// The GUI mask in the app (PLAN-GUI-MASK.md 3.2): the per-video "is this vanilla?" answer, the overlay colouring and
// the status line. Pure functions (tested in guiMask.test.ts); the panel is components/GuiMaskControls.tsx.

export type GuiAnswer = "yes" | "no" | "not_sure";

export interface GuiMaskReply {
  width: number;
  height: number;
  reliable: boolean;
  /** Video pixels per GUI pixel. */
  scale: number | null;
  scaled_width: number | null;
  scaled_height: number | null;
  notes: string[];
  pieces: Array<{ piece: string; count: number }>;
}

/** Ask while the user has not answered for this video. */
export function needsQuestion(answer: GuiAnswer | null): boolean {
  return answer === null;
}

/** The mask runs only after a "yes" (the backend enforces the same). */
export function answerAllowsMask(answer: GuiAnswer | null): boolean {
  return answer === "yes";
}

/** Piece id (low nibble) and pixel class (high nibble: 0 none, 1 opaque, 2 translucent, 3 unknown). */
export function unpack(b: number): { piece: number; cls: number } {
  return { piece: b & 0x0f, cls: b >> 4 };
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
    const t = TINT[packed[i] >> 4];
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
};

/** One line for the panel: the scale and the pieces found, or why nothing was found. */
export function maskStatus(r: GuiMaskReply): string {
  if (!r.reliable || r.scale === null) {
    return r.notes[0] ?? "No vanilla HUD was found on this frame, so nothing is masked.";
  }
  const parts = r.pieces
    .filter((p) => NAMES[p.piece])
    .map((p) => (p.count > 1 ? `${p.count} ${NAMES[p.piece]}` : NAMES[p.piece]));
  return `GUI scale ${r.scale.toFixed(2)} px per GUI px · ${parts.join(" · ")}`;
}
