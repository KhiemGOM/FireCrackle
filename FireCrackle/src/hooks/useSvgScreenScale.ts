import { useLayoutEffect, useState, type RefObject } from "react";

/** Includes the SVG viewBox fit and the viewer's outer CSS zoom/rotation. */
export function useSvgScreenScale(ref: RefObject<SVGSVGElement | null>, width: number, height: number, zoom: number): number {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const measure = () => {
      const matrix = svg.getScreenCTM();
      if (!matrix) return;
      const next = Math.hypot(matrix.a, matrix.b);
      if (Number.isFinite(next) && next > 0) setScale(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [ref, width, height, zoom]);
  return scale;
}
