interface Texel {
  points: Array<[number, number]>;
  colour: string;
  alpha: number;
}

interface Props {
  texels: Texel[];
  pixelGrid: boolean;
  scaleX?: number;
  scaleY?: number;
  screenScale?: number;
}

/** Disable edge blending so adjacent sprite pixels do not acquire hairline seams. */
export function FireTexels({ texels, pixelGrid, scaleX = 1, scaleY = 1, screenScale = 1 }: Props) {
  return <g shapeRendering="crispEdges">
    {texels.map((p, i) => <polygon key={i}
      points={p.points.map(([x, y]) => `${x * scaleX},${y * scaleY}`).join(" ")}
      fill={p.colour} fillOpacity={p.alpha}
      stroke={pixelGrid ? "rgba(255,255,255,0.45)" : "none"}
      strokeWidth={0.7 / (Number.isFinite(screenScale) && screenScale > 0 ? screenScale : 1)} />)}
  </g>;
}
