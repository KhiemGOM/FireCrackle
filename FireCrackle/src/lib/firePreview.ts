import {validAtlasRow,type AnimationAtlas} from "./animationAtlases";
import type {Label} from "./grid";
import type { View } from "./api";
import { COLUMNS, isFire } from "./grid";

export interface PreviewSprite {
  atlas?: AnimationAtlas;
  sheet: 0 | 1;
  row: number;
  mirrored: boolean;
}
export type PreviewMode = "none" | "manual" | "firstPerson";

/** First-person geometry always uses the game's fixed appearance/orientation. */
export function previewSprite(mode: PreviewMode, sprite: PreviewSprite): PreviewSprite | null {
  if(sprite.atlas && (mode==="firstPerson" || !validAtlasRow(sprite.atlas,sprite.row)))return null;
  if (mode === "none" || !Number.isInteger(sprite.row) || sprite.row < 0 || sprite.row >= 32 || ![0, 1].includes(sprite.sheet)) return null;
  return { ...(sprite.atlas?{atlas:sprite.atlas}:{}), sheet: mode === "firstPerson" ? 1 : sprite.sheet, row: sprite.row, mirrored: mode === "firstPerson" ? false : sprite.mirrored };
}

export function atlasSprite(col: number, row: number): PreviewSprite | null {
  const column = Number.isInteger(col) ? COLUMNS[col] : null;
  return column ? previewSprite("manual", { ...column, row }) : null;
}

/** Clicks only choose or preview. Saving is an explicit, separate action. */
export function selectAtlasCell(ctrlKey: boolean, col: number, row: number, preview: (sprite: PreviewSprite) => boolean, select: (col: number, row: number) => void): void {
  const sprite = atlasSprite(col, row);
  if (!sprite) return;
  if (!ctrlKey) select(col, row);
  preview(sprite);
}

/** Prefer the destination prediction; an explicit label is a useful fallback. */
export function framePreview(view: Pick<View, "suggestion" | "label">): PreviewSprite | null {
  if(typeof view.label==='object'&&'texture' in view.label)return labelSprite(view.label);
  if (view.suggestion) {
    const sprite = previewSprite("manual", view.suggestion as PreviewSprite);
    if (sprite) return sprite;
  }
  return isFire(view.label) ? previewSprite("manual", view.label.fire as PreviewSprite) : null;
}

export function spriteLabel(sprite:PreviewSprite):Label {return sprite.atlas?{texture:{atlas:sprite.atlas,row:sprite.row,mirrored:sprite.mirrored}}:{fire:sprite};}

export function labelSprite(label:Label):PreviewSprite|null {
  if(isFire(label))return label.fire as PreviewSprite;
  if(typeof label==='object'&&'texture' in label)return {...label.texture,sheet:label.texture.atlas.endsWith('_0')||label.texture.atlas.endsWith('_still')?0:1};
  return null;
}
export function spriteWithSheet(sprite:PreviewSprite,sheet:0|1):PreviewSprite {
  if(!sprite.atlas)return {...sprite,sheet};
  const family=sprite.atlas.startsWith('soul_')?'soul_fire':sprite.atlas.startsWith('lava')?'lava':'water';
  const atlas=(family==='soul_fire'?`${family}_${sheet}`:`${family}_${sheet===0?'still':'flow'}`) as AnimationAtlas;
  let row=sprite.row;while(!validAtlasRow(atlas,row)&&row>0)row--;
  return {...sprite,atlas,sheet,row};
}
