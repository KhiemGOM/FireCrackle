import {ANIMATION_ATLASES} from "./animationAtlases";
import type { View } from "./api";
import type { UiAction } from "./actions";
import { atlasSprite, spriteLabel, type PreviewSprite } from "./firePreview";
import { isFire, isTexture, labelToCell, labelsEqual, fireLabel, type Label } from "./grid";

export interface CandidateDraft { frame: number; label: Label; origin: "picked" | "typed"; digits?: string; atlas?:import('./animationAtlases').AnimationAtlas }
export interface Candidate { label: Label; origin: "picked" | "typed" | "guess" | "saved" }
export function currentCandidate(view: Pick<View, "current" | "label" | "suggestion">, draft: CandidateDraft | null): Candidate | null {
  if (draft?.frame === view.current) return draft.label === "unset" ? null : { label: draft.label, origin: draft.origin };
  if (view.label !== "unset") return { label: view.label, origin: "saved" };
  const s = view.suggestion;
  if (s && labelToCell({ fire: s })) return { label: { fire: { sheet: s.sheet, row: s.row, mirrored: s.mirrored } }, origin: "guess" };
  return null;
}
export function candidateConfirmation(candidate: Candidate | null): UiAction | null {
  if (!candidate) return null;
  if (candidate.origin === "guess") return { type: "acceptSuggestion" };
  const label = candidate.label;
  if(typeof label==='object'&&'fire_pair' in label)return {type:'setLabel',label};
  if (label === "no_fire") return { type: "noFire" };
  if (label === "skip") return { type: "skip" };
  if(isTexture(label)||typeof label==='object'&&'no_texture' in label)return {type:"setLabel",label};
  const cell = labelToCell(label);
  return cell ? { type: "clickCell", ...cell } : null;
}
/**
 * The saved label that Confirm/Enter would overwrite, or null when it overwrites nothing: the frame has no saved label
 * (a time guess is not one), there is nothing to confirm, or the candidate is the saved label itself.
 */
export function replacedLabel(view: Pick<View, "label">, candidate: Candidate | null): Label | null {
  if (view.label === "unset" || !candidate || candidate.label === "unset") return null;
  const soul=!!fireLabel(candidate.label,true),incoming=fireLabel(candidate.label,soul);
  if(incoming){const existing=fireLabel(view.label,soul);if(existing)return !labelsEqual(existing,incoming)?existing:null;if(fireLabel(view.label,!soul))return null;}
  return labelsEqual(view.label, candidate.label) ? null : view.label;
}
export function candidateDigit(frame: number, draft: CandidateDraft | null, digit: number, pick: { sheet: number; mirrored: boolean; atlas?:import('./animationAtlases').AnimationAtlas }): CandidateDraft {
  const pending = draft?.frame === frame && draft.digits?.length === 1 && Number(draft.digits) <= 3;
  const digits = pending ? draft!.digits + String(digit) : String(digit);
  const row = Number(digits);
  const col = (pick.mirrored ? 2 : 0) + pick.sheet;
  const sprite = atlasSprite(col, row);
  const atlas=pick.atlas??(draft?.frame===frame?draft.atlas:undefined);
  const next=sprite?{...sprite,...(atlas?{atlas}:{})}:null;
  return { frame, origin: "typed", label: next&&(!next.atlas||row<ANIMATION_ATLASES[next.atlas].rows) ? spriteLabel(next) : "unset", digits,...(atlas?{atlas}:{}) };
}
export function spriteText(sprite: PreviewSprite | { sheet: number; row: number; mirrored: boolean }): string {
  if("atlas" in sprite && sprite.atlas)return `${ANIMATION_ATLASES[sprite.atlas].name} · row ${sprite.row} · ${sprite.mirrored?"mirrored":"normal"}`;
  return `row ${sprite.row} · sheet ${sprite.sheet} · ${sprite.mirrored ? "mirrored" : "normal"}`;
}
export function candidateText(label: Label | null): string {
  if(label&&typeof label==='object'&&'fire_pair' in label){const {normal,soul}=label.fire_pair;return normal.row===soul.row?`Fire + Soul fire · row ${normal.row}`:`Fire row ${normal.row} / Soul fire row ${soul.row} · CONFLICT`;}
  if(label&&typeof label==='object'&&'no_texture' in label)return `No ${ANIMATION_ATLASES[label.no_texture.atlas].name.toLowerCase()}`;
  if(label&&isTexture(label))return spriteText({...label.texture,sheet:label.texture.atlas.endsWith("_0")?0:1});
  return label && isFire(label) ? spriteText(label.fire) : label === "no_fire" ? "No fire" : label === "skip" ? "Skip" : "None selected";
}
