import { useEffect, useRef, type RefObject } from "react";
import { anchorView, type Box, type ViewXform } from "../lib/zoom";

/**
 * Keep the picture on the same screen pixels when the video area changes size (the 3D overview opening, closing,
 * collapsing or being dragged, or the window resizing): each new size re-anchors the view (lib/zoom.ts anchorView).
 * The first size only records; nothing moves before the picture's own size is known.
 */
export function useAnchoredView(frame: RefObject<HTMLElement | null>, image: { width: number; height: number }, setView: (f: (v: ViewXform) => ViewXform) => void) {
  const latest = useRef({ image, setView });
  latest.current = { image, setView };
  const last = useRef<Box | null>(null);
  useEffect(() => {
    const el = frame.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const r = el.getBoundingClientRect(), box = { w: r.width, h: r.height }, before = last.current;
      last.current = box;
      const { image: picture, setView: set } = latest.current;
      if (before && picture.width > 0 && picture.height > 0) set(v => anchorView(v, before, box, { w: picture.width, h: picture.height }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [frame]);
}
