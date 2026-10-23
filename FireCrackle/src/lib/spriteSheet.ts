// One loader for a fire / animation sprite sheet as RGBA (the quad mask and the 3D quad both texture with it).
import { getWaterTint, renderWaterAtlases, subscribeWaterTint } from "./waterTint";
import { ANIMATION_ATLASES, atlasSource, type AnimationAtlas } from "./animationAtlases";
import fire0 from "../assets/fire_0.png";
import fire1 from "../assets/fire_1.png";

/** The image a sprite selection is drawn from: an animation atlas, or fire_0 / fire_1. */
export function spriteSource(atlas: AnimationAtlas | undefined, sheet: 0 | 1): string {
  return atlas ? atlasSource(atlas) : sheet === 0 ? fire0 : fire1;
}
/** Texel size and row count of a sprite selection's sheet. */
export function spriteShape(atlas: AnimationAtlas | undefined): { side: number; rows: number } {
  return atlas ? { side: ANIMATION_ATLASES[atlas].side, rows: ANIMATION_ATLASES[atlas].rows } : { side: 16, rows: 32 };
}

/** Load the sheet as RGBA: `reset` when (re)starting, `ready` with the pixels, `failed` on a bad sheet. Water atlases
 * follow the water tint (ready again on every tint change). Returns the cancel function. */
export function loadSpriteSheet(atlas: AnimationAtlas | undefined, source: string,
  on: { reset: () => void; ready: (rgba: Uint8ClampedArray) => void; failed: () => void }): () => void {
  let cancelled = false;
  on.reset();
  if (atlas === "water_still" || atlas === "water_flow") {
    let generation = 0;
    const update = () => {
      const mine = ++generation;
      on.reset();
      void renderWaterAtlases(getWaterTint()).then(sheets => { if (!cancelled && mine === generation) on.ready(sheets[atlas].rgba); })
        .catch(() => { if (!cancelled && mine === generation) on.failed(); });
    };
    update();
    const unsubscribe = subscribeWaterTint(update);
    return () => { cancelled = true; unsubscribe(); };
  }
  const image = new Image();
  image.onload = () => {
    if (cancelled) return;
    try {
      const { side, rows } = spriteShape(atlas);
      if (image.naturalWidth !== side || image.naturalHeight !== side * rows) throw new Error("Invalid sprite sheet");
      const canvas = document.createElement("canvas");
      canvas.width = side;
      canvas.height = side * rows;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable");
      ctx.drawImage(image, 0, 0);
      on.ready(ctx.getImageData(0, 0, side, side * rows).data);
    } catch { on.failed(); }
  };
  image.onerror = () => { if (!cancelled) on.failed(); };
  image.src = source;
  return () => { cancelled = true; };
}
