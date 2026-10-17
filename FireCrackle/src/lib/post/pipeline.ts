// Runs the enabled enhancement effects, in the user's order, on a decoded picture. Pure: no frame, backend or detector access.
import { displayOrder } from "./order";
import { hasActiveEffect, type PostSettings } from "./settings";
import { STAGES } from "./stages";

export interface PostImage { data: Uint8ClampedArray; width: number; height: number }
export interface Enhanced { data: Uint8ClampedArray; applied: boolean }

/** True when at least one enhancement effect (not veil or portal) would change the picture. */
export function hasEnhancement(s: PostSettings): boolean {
  return s.enabled && hasActiveEffect(s);
}

export function enhance(image: PostImage, s: PostSettings): Enhanced {
  if (!hasEnhancement(s)) return { data: image.data, applied: false };
  if (image.data.length !== image.width * image.height * 4) throw new Error("Picture size does not match its pixel count");
  let data = image.data;
  for (const id of displayOrder(s.order, stage => s.stages[stage].on)) {
    const state = s.stages[id];
    if (!state.on || STAGES[id].isIdentity(state.params)) continue;
    data = STAGES[id].apply(data, image.width, image.height, state.params);
  }
  return { data, applied: data !== image.data };
}
