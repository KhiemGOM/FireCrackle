import { useEffect, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import "./ComparisonProofButton.css";
import "./FrameMenu.css";

/** The video viewer's right-click menu, at the pointer and kept on screen. Escape, a click elsewhere or leaving the
 * window closes it. On `document.body`, so the viewer's own zoom and drag handlers never see its clicks. */
export function FrameMenu({ x, y, onCopy, onSave, onClose }: { x: number; y: number; onCopy: () => void; onSave: () => void; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null), items = useRef<(HTMLButtonElement | null)[]>([]);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    items.current[0]?.focus({ preventScroll: true });
    const close = () => closeRef.current();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(); };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, []);
  function key(event: KeyboardEvent, index: number) {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); onClose(); }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); items.current[1 - index]?.focus(); }
  }
  const left = Math.max(4, Math.min(x, window.innerWidth - 220)), top = Math.max(4, Math.min(y, window.innerHeight - 96));
  return createPortal(<div className="comparison-proof-menu frame-menu" ref={root} role="menu" aria-label="Frame" style={{ left, top }}
    onContextMenu={event => event.preventDefault()}>
    <div className="comparison-proof-option" role="none">
      <button type="button" role="menuitem" data-owns-keys="true" ref={element => { items.current[0] = element; }} onKeyDown={event => key(event, 0)}
        title="Copy this frame at the video's own resolution, without overlays" onClick={onCopy}>Copy frame <kbd>Ctrl+Shift+C</kbd></button>
    </div>
    <div className="comparison-proof-option" role="none">
      <button type="button" role="menuitem" data-owns-keys="true" ref={element => { items.current[1] = element; }} onKeyDown={event => key(event, 1)}
        title="Save this frame as a PNG file, without overlays" onClick={onSave}>Save frame…</button>
    </div>
  </div>, document.body);
}
