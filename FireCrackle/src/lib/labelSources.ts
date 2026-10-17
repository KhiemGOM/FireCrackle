import type { Bucket } from "./api";

export const AUTOMATIC_TOOLS = [
  { source: "first_person", name: "First-person fire", color: "#bd8bff", count: "auto_first_person" },
  { source: "no_fire", name: "No-fire checker", color: "#38d4bf", count: "auto_no_fire" },
  { source: "time_guess", name: "Time guess", color: "#ffd166", count: "auto_time_guess" },
] as const;

const patterns = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern>>();

function stripePattern(g: CanvasRenderingContext2D, color: string): CanvasPattern | null {
  let cache = patterns.get(g);
  if (!cache) { cache = new Map(); patterns.set(g,cache); }
  const cached = cache.get(color);
  if (cached) return cached;
  const tile = document.createElement("canvas");
  tile.width = tile.height = 8;
  const ink = tile.getContext("2d");
  if (!ink) return null;
  ink.fillStyle = color;
  ink.globalAlpha = 0.85;
  ink.fillRect(0,0,8,4);
  const pattern = g.createPattern(tile,"repeat");
  if (pattern) cache.set(color,pattern);
  return pattern;
}

/** Repeating horizontal bars leave the base label colour visible between stripes.
 * Mixed zoomed-out buckets keep each tool in its own horizontal band. */
export function paintAutomaticStrips(
  g: CanvasRenderingContext2D,
  bucket: Bucket, x: number, y: number, width: number, height: number,
) {
  const tools = AUTOMATIC_TOOLS.filter(tool => (bucket[tool.count] ?? 0) > 0);
  tools.forEach((tool,i) => {
    const pattern = stripePattern(g,tool.color);
    if (!pattern) return;
    g.fillStyle = pattern;
    g.fillRect(x, y + i*height/tools.length, width, height/tools.length);
  });
}
