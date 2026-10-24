import { useEffect, useRef, type RefObject } from "react";
import { IDENTITY, anchorView, pictureOnScreen, type Box, type ViewXform } from "../lib/zoom";

/**
 * Keep the picture on the same screen pixels when the video area changes size (the 3D overview opening, closing,
 * collapsing or being dragged, or the window resizing): each new size re-anchors the view (lib/zoom.ts anchorView).
 *
 * The view is always in terms of one area size, the one returned (to be saved with it). `saved` is the size a restored
 * view was made in: opening the app passes through other sizes (a small window first, minimised is 0 × 0), and each is
 * converted from it, so the view comes back as it was. Without a saved size the first real size is taken as the
 * view's. Nothing moves before the picture's own size is known (the view's size is then left as it is), and a 0 × 0
 * area is passed over. Once, when the picture is first known: a view that shows none of it (saved before sizes were
 * kept) starts fitted. Panning by hand is never limited.
 */
export function useAnchoredView(frame: RefObject<HTMLElement | null>, image: { width: number; height: number }, setView: (f: (v: ViewXform) => ViewXform) => void, saved?: Box | null) {
  const latest = useRef({ image, setView });
  latest.current = { image, setView };
  const last = useRef<Box | null>(saved ?? null), checked = useRef(false);
  const sync = () => {
    const el = frame.current;
    if (!el) return;
    const r = el.getBoundingClientRect(), box = { w: r.width, h: r.height };
    if (!(box.w > 0 && box.h > 0)) return;
    const { image: picture, setView: set } = latest.current, before = last.current;
    if (!(picture.width > 0 && picture.height > 0)) {
      if (!before) last.current = box;
      return;
    }
    const pic = { w: picture.width, h: picture.height }, first = !checked.current;
    last.current = box;
    checked.current = true;
    set(v => {
      const moved = before ? anchorView(v, before, box, pic) : v;
      return first && !pictureOnScreen(moved, box, pic) ? IDENTITY : moved;
    });
  };
  useEffect(() => {
    const el = frame.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, [frame]); // eslint-disable-line react-hooks/exhaustive-deps
  // the picture's size arriving after the area settled: move the view to the area's size once it is known
  useEffect(sync, [image.width, image.height]); // eslint-disable-line react-hooks/exhaustive-deps
  return last;
}
