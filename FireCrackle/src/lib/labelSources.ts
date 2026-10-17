import type { Bucket } from "./api";

export const AUTOMATIC_TOOLS = [
  { source: "first_person", name: "First-person fire", color: "#bd8bff", count: "auto_first_person" },
  { source: "no_fire", name: "No-fire checker", color: "#38d4bf", count: "auto_no_fire" },
] as const;

/** Tool bars at both edges leave the label colour clear in the middle.
 * Mixed zoomed-out buckets stack tool colours within each edge. */
export function paintAutomaticStrips(
  g: Pick<CanvasRenderingContext2D,"fillStyle"|"fillRect">,
  bucket: Bucket, x: number, y: number, width: number, height: number,
) {
  const tools = AUTOMATIC_TOOLS.filter(tool => (bucket[tool.count] ?? 0) > 0);
  const thickness = Math.min(4,height/(tools.length*4));
  tools.forEach((tool,i) => {
    g.fillStyle = tool.color;
    g.fillRect(x,y+i*thickness,width,thickness);
    g.fillRect(x,y+height-(i+1)*thickness,width,thickness);
  });
}
