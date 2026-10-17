import type { Bucket } from "./api";

export const AUTOMATIC_TOOLS = [
  { source: "first_person", name: "First-person fire", color: "#bd8bff", count: "auto_first_person" },
  { source: "no_fire", name: "No-fire checker", color: "#38d4bf", count: "auto_no_fire" },
  { source: "time_guess", name: "Time guess", color: "#ffd166", count: "auto_time_guess" },
] as const;

/** Keep every tool visible in mixed zoomed-out buckets rather than hiding minority sources. */
export function paintAutomaticStrips(
  g: Pick<CanvasRenderingContext2D,"fillStyle"|"fillRect">,
  bucket: Bucket, x: number, y: number, width: number, height = 7,
) {
  const tools = AUTOMATIC_TOOLS.filter(tool => (bucket[tool.count] ?? 0) > 0);
  tools.forEach((tool,i) => {
    g.fillStyle = tool.color;
    g.fillRect(x, y + i*height/tools.length, width, height/tools.length);
  });
}
