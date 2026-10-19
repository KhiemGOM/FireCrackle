import type { AnimationAtlas, TextureSprite } from "./animationAtlases";
// The sprite picker grid: 4 columns x 32 rows, like the reference image
// (Normal: sheet 0, sheet 1 | Mirrored: sheet 0, sheet 1).

/** A frame label, in the JSON shape the Rust `Label` serialises to. */
export type Label =
  | { fire_pair: { normal: FireReading; soul: FireReading } }
  | "unset"
  | "no_fire"
  | "skip"
  | { fire: { sheet: number; row: number; mirrored: boolean } }
  | { texture: TextureSprite }
  | { no_texture: { atlas: AnimationAtlas } };

export interface FireReading {sheet:number;row:number;mirrored:boolean;sources:number}
/** Original appearance per family; a paired frame is still one labelled frame. */
export function fireLabel(label:Label,soul=false):Label|null {
  if(typeof label==='object'&&'fire_pair' in label){const r=soul?label.fire_pair.soul:label.fire_pair.normal;return soul?{texture:{atlas:r.sheet===0?'soul_fire_0':'soul_fire_1',row:r.row,mirrored:r.mirrored}}:{fire:{sheet:r.sheet,row:r.row,mirrored:r.mirrored}};}
  return soul?isTexture(label)&&label.texture.atlas.startsWith('soul_fire')?label:null:isFire(label)?label:null;
}
export function mergeFireLabels(previous:Label,incoming:Label):Label {
  const normal=fireLabel(incoming)??fireLabel(previous),soul=fireLabel(incoming,true)??fireLabel(previous,true);
  if(!normal||!soul||(!fireLabel(incoming)&&!fireLabel(incoming,true)))return incoming;
  const n=(normal as {fire:FireReading}).fire,s=(soul as {texture:{atlas:string;row:number;mirrored:boolean}}).texture;
  return {fire_pair:{normal:{sheet:n.sheet,row:n.row,mirrored:n.mirrored,sources:1},soul:{sheet:s.atlas.endsWith('_0')?0:1,row:s.row,mirrored:s.mirrored,sources:1}}};
}

export interface Cell {
  col: number;
  row: number;
}

export interface ColumnSpec {
  sheet: 0 | 1;
  mirrored: boolean;
}

/** Column order of the picker, left to right. */
export const COLUMNS: ReadonlyArray<ColumnSpec> = [
  { sheet: 0, mirrored: false },
  { sheet: 1, mirrored: false },
  { sheet: 0, mirrored: true },
  { sheet: 1, mirrored: true },
];

export const ROWS = 32;

function validRow(row: number): boolean {
  return Number.isInteger(row) && row >= 0 && row < ROWS;
}

function cellOf(sheet: number, mirrored: boolean, row: number): Cell | null {
  if (!validRow(row)) return null;
  const col = COLUMNS.findIndex((c) => c.sheet === sheet && c.mirrored === mirrored);
  return col < 0 ? null : { col, row };
}

/** The fire label of a picker cell, or null for a cell outside the grid. */
export function cellToLabel(col: number, row: number): Label | null {
  if (!Number.isInteger(col) || col < 0 || col >= COLUMNS.length || !validRow(row)) return null;
  const c = COLUMNS[col];
  return { fire: { sheet: c.sheet, row, mirrored: c.mirrored } };
}

/** The picker cell of a fire label, or null for any other label or an invalid fire label. */
export function labelToCell(label: Label): Cell | null {
  if (!isFire(label)) return null;
  const { sheet, row, mirrored } = label.fire;
  return cellOf(sheet, mirrored, row);
}

export function isFire(label: Label): label is { fire: { sheet: number; row: number; mirrored: boolean } } {
  return typeof label === "object" && label !== null && "fire" in label;
}

export function isTexture(label: Label): label is {texture:TextureSprite} {return typeof label === "object" && label !== null && "texture" in label;}
export function labelsEqual(a: Label, b: Label): boolean {
  if(typeof a==='object'&&'fire_pair' in a||typeof b==='object'&&'fire_pair' in b)return JSON.stringify(a)===JSON.stringify(b);
  if(typeof a==='object'&&'no_texture' in a)return typeof b==='object'&&'no_texture' in b&&a.no_texture.atlas===b.no_texture.atlas;
  if(typeof b==='object'&&'no_texture' in b)return false;
  if(isTexture(a)&&isTexture(b))return a.texture.atlas===b.texture.atlas&&a.texture.row===b.texture.row&&a.texture.mirrored===b.texture.mirrored;
  if(isTexture(a)||isTexture(b))return false;
  if (isFire(a) && isFire(b)) {
    return a.fire.sheet === b.fire.sheet && a.fire.row === b.fire.row && a.fire.mirrored === b.fire.mirrored;
  }
  if (isFire(a) || isFire(b)) return false;
  return a === b;
}

/** Header of a column: group ("Normal" / "Mirrored") and the sheet number. */
export function columnHeader(col: number): { group: string; sheet: string } | null {
  if (!Number.isInteger(col) || col < 0 || col >= COLUMNS.length) return null;
  const c = COLUMNS[col];
  return { group: c.mirrored ? "Mirrored" : "Normal", sheet: String(c.sheet) };
}

export interface SuggestionLike {
  sheet: number;
  mirrored: boolean;
  row: number;
  alt_row: number | null;
}

/** The cells to highlight for a suggestion: the likely one and, if any, the alternative. */
export function suggestionCells(s: SuggestionLike): { primary: Cell | null; alt: Cell | null } {
  return {
    primary: cellOf(s.sheet, s.mirrored, s.row),
    alt: s.alt_row === null ? null : cellOf(s.sheet, s.mirrored, s.alt_row),
  };
}
