// Toolbar strips scroll sideways with the mouse wheel: they have no scrollbar (it covered their controls).

/** Scroll `el` sideways by the wheel's delta (either axis). A strip that overflows keeps the wheel even at its ends, so
 * the page never scrolls when the strip is done; false (the page scrolls) only when it fits, or Ctrl is held (zoom). */
export function scrollSideways(el: { scrollLeft: number; scrollWidth: number; clientWidth: number }, e: { deltaX: number; deltaY: number; ctrlKey: boolean }): boolean {
  if (e.ctrlKey) return false;
  const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  const max = el.scrollWidth - el.clientWidth;
  if (max <= 0) return false;
  el.scrollLeft = Math.max(0, Math.min(max, el.scrollLeft + delta));
  return true;
}
