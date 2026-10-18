import {ANIMATION_ATLASES,type AnimationAtlas} from "./animationAtlases";
import { DEFAULT_QUAD, validQuad, type ManualQuad } from "./quadMask";

export interface MaskState {
  manualAtlas?:AnimationAtlas;
  hudEnabled: boolean; hudRow: number; hudFov: number; hudOpacity: number;
  manualEnabled: boolean; manualQuad: ManualQuad; manualSheet: 0 | 1;
  manualRow: number; manualMirrored: boolean; manualOpacity: number; pixelGrid: boolean;
  compressionEnabled: boolean; compressionHeight: number; compressionQuality: number;
}
export const MASK_STATE_KEY = "firecrackle.masks.v1";
export const DEFAULT_MASK_STATE: MaskState = {
  hudEnabled: false, hudRow: 0, hudFov: 70, hudOpacity: 1, manualEnabled: false, manualQuad: DEFAULT_QUAD,
  manualSheet: 1, manualRow: 0, manualMirrored: false, manualOpacity: 0.6, pixelGrid: false,
  compressionEnabled: false, compressionHeight: 1080, compressionQuality: 0.45,
};
type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem">;
export function readMaskState(storage?: StorageReader): MaskState {
  const result = { ...DEFAULT_MASK_STATE };
  try {
    const saved = JSON.parse((storage ?? localStorage).getItem(MASK_STATE_KEY) ?? "null");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return result;
    for (const key of ["hudEnabled", "manualEnabled", "manualMirrored", "pixelGrid", "compressionEnabled"] as const)
      if (typeof saved[key] === "boolean") result[key] = saved[key];
    for (const key of ["hudRow", "manualRow"] as const)
      if (Number.isInteger(saved[key]) && saved[key] >= 0 && saved[key] < 32) result[key] = saved[key];
    if(typeof saved.manualAtlas==="string" && saved.manualAtlas in ANIMATION_ATLASES)result.manualAtlas=saved.manualAtlas;
    if(result.manualAtlas&&result.manualRow>=ANIMATION_ATLASES[result.manualAtlas].rows)result.manualRow=0;
    if ([60, 70].includes(saved.hudFov)) result.hudFov = saved.hudFov;
    if ([0, 1].includes(saved.manualSheet)) result.manualSheet = saved.manualSheet;
    for (const key of ["hudOpacity", "manualOpacity"] as const)
      if (Number.isFinite(saved[key]) && saved[key] >= 0 && saved[key] <= 1) result[key] = saved[key];
    if ([360, 480, 720, 1080, 1440, 2160].includes(saved.compressionHeight)) result.compressionHeight = saved.compressionHeight;
    if ([0.05, 0.15, 0.45, 0.8].includes(saved.compressionQuality)) result.compressionQuality = saved.compressionQuality;
    if (Array.isArray(saved.manualQuad) && saved.manualQuad.length === 4 && saved.manualQuad.every((p: unknown) => Array.isArray(p) && p.length === 2 && p.every(n => typeof n === "number" && Number.isFinite(n))) && validQuad(saved.manualQuad))
      result.manualQuad = saved.manualQuad;
    if (result.manualEnabled) result.hudEnabled = false;
  } catch { /* Missing or unavailable storage leaves usable defaults. */ }
  return result;
}
export function writeMaskState(state: MaskState, storage?: StorageWriter): boolean {
  try { (storage ?? localStorage).setItem(MASK_STATE_KEY, JSON.stringify(state)); return true; }
  catch { return false; }
}
