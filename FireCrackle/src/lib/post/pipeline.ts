// Runs the enabled enhancement effects, in the user's order, on a decoded picture. Pure: no frame, backend or detector access.
import { applyTone, isToneIdentity } from "./tone";
import { displayOrder } from "./order";
import type { PostSettings } from "./settings";

export interface PostImage { data: Uint8ClampedArray; width: number; height: number }
export interface Enhanced { data: Uint8ClampedArray; applied: boolean }

/** True when at least one enhancement effect (not veil or portal) would change the picture. */
export function hasEnhancement(s: PostSettings): boolean {
  return s.enabled && s.stages.tone.on && !isToneIdentity(s.stages.tone.params);
}

export function enhance(image: PostImage, s: PostSettings): Enhanced {
  if (!hasEnhancement(s)) return { data: image.data, applied: false };
  if (image.data.length !== image.width * image.height * 4) throw new Error("Picture size does not match its pixel count");
  let data = image.data;
  for (const id of displayOrder(s.order, stage => s.stages[stage].on)) {
    if (!s.stages[id].on) continue;
    if (id === "tone") data = applyTone(data, s.stages.tone.params);
  }
  return { data, applied: data !== image.data };
}
