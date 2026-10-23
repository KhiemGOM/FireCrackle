// The one image viewer: every picture in the app opens here (the Label/Images video viewer is its own tool).
// It shows the picture source it is given, exactly as displayed; its only logic is swapping in the same picture at
// native resolution when the displayed one is a reduced copy (`native`).
import { createContext, useContext, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useWheel } from "../hooks/useWheel";
import { failureMessage } from "../lib/appErrors";
import { canvasBlob } from "../lib/canvas";
import { centredView, fitScale, imagePixel, nativePercent, pictureFilename, scaleForPercent, stepZoom, viewerAction, zoomViewAt, type ViewerAction } from "../lib/imageViewer";
import { copyPicture, savePicture } from "../lib/proofExport";
import { panView, wheelFactor, type Box, type ViewXform } from "../lib/zoom";
import { Icon, IconButton } from "./Icon";
import "./ImageViewer.css";

/** `src` is the displayed picture's URL, or makes one from a displayed canvas; a blob: URL made that way is revoked by the viewer. */
export interface ViewerImage {
  src: string | (() => Promise<string>); title: string; detail?: string;
  /** The same picture at native resolution, when `src` is a reduced copy (a thumbnail, the scaled display frame). */
  native?: () => Promise<string>;
}
type Open = (images: ViewerImage[], index?: number) => void;

const ViewerContext = createContext<Open | null>(null);

export function ImageViewerProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<{ images: ViewerImage[]; index: number } | null>(null);
  const open: Open = (images, index = 0) => { if (images.length) setShown({ images, index: Math.min(Math.max(0, index), images.length - 1) }); };
  return <ViewerContext.Provider value={open}>
    {children}
    {shown && createPortal(<ImageViewerDialog images={shown.images} index={shown.index} onIndex={index => setShown(s => s && { ...s, index })} onClose={() => setShown(null)} />, document.body)}
  </ViewerContext.Provider>;
}

export const useImageViewer = (): Open => useContext(ViewerContext) ?? (() => {});

const pictures = (images: ViewerImage[] | (() => ViewerImage[])) => typeof images === "function" ? images() : images;

/** Click (or Enter) on the children opens the viewer. `images` may be made at click time. */
export function Viewable({ images, index = 0, className = "", children }: { images: ViewerImage[] | (() => ViewerImage[]); index?: number; className?: string; children: ReactNode }) {
  const open = useImageViewer();
  const show = () => open(pictures(images), index);
  return <div className={`viewable ${className}`} role="button" tabIndex={0} title="Click to enlarge"
    onClick={show} onKeyDown={(e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); show(); } }}>
    {children}
    <span className="viewable-hint" aria-hidden="true"><Icon name="expand" /></span>
  </div>;
}

/** A small enlarge button, for pictures whose own click already does something else. */
export function ViewButton({ images, index = 0, label = "Enlarge image", className = "" }: { images: ViewerImage[] | (() => ViewerImage[]); index?: number; label?: string; className?: string }) {
  const open = useImageViewer();
  return <IconButton icon="expand" label={label} className={`view-button ${className}`} onClick={e => { e.stopPropagation(); open(pictures(images), index); }} />;
}

const percentText = (p: number) => `${p < 10 ? p.toFixed(1) : Math.round(p)}%`;
const hex = (rgb: number[]) => `#${rgb.map(v => v.toString(16).padStart(2, "0")).join("")}`;

export function ImageViewerDialog({ images, index, onIndex, onClose }: { images: ViewerImage[]; index: number; onIndex: (index: number) => void; onClose: () => void }) {
  const image = images[index];
  const [picture, setPicture] = useState<{ src: string | null; error: string | null }>(() => ({ src: typeof image.src === "string" ? image.src : null, error: null }));
  const [size, setSize] = useState<Box | null>(null);
  const [view, setView] = useState<ViewXform | null>(null);
  const [fit, setFit] = useState(1);
  const [hover, setHover] = useState<{ x: number; y: number; rgb?: number[] } | null>(null);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [full, setFull] = useState<{ src: string | null; state: "none" | "loading" | "ready" | "failed" }>(() => ({ src: null, state: image.native ? "loading" : "none" }));
  const stage = useRef<HTMLDivElement | null>(null), dialog = useRef<HTMLDivElement | null>(null), img = useRef<HTMLImageElement | null>(null);
  const drag = useRef<{ x: number; y: number; moved: number } | null>(null);
  const fitted = useRef(true), sampler = useRef<CanvasRenderingContext2D | null | false>(null);
  const dpr = window.devicePixelRatio || 1;
  const multiple = images.length > 1;

  const pane = (): Box => { const r = stage.current?.getBoundingClientRect(); return { w: r?.width ?? 0, h: r?.height ?? 0 }; };
  const toFit = (s: Box) => { const f = fitScale(s, pane()); fitted.current = true; setFit(f); setView(centredView(s, pane(), f)); };

  // the picture of this index: a URL now, or one made on demand
  useEffect(() => {
    // a URL made by `src()` belongs to the viewer
    let cancelled = false, made: string | null = null;
    const release = () => { if (made?.startsWith("blob:")) URL.revokeObjectURL(made); made = null; };
    setSize(null); setView(null); setHover(null); sampler.current = null;
    if (typeof image.src === "string") setPicture({ src: image.src, error: null });
    else {
      setPicture({ src: null, error: null });
      image.src().then(src => { made = src; if (cancelled) release(); else setPicture({ src, error: null }); }, e => { if (!cancelled) setPicture({ src: null, error: failureMessage(e) }); });
    }
    return () => { cancelled = true; release(); };
  }, [image]);

  // the same picture at native resolution, swapped in when it is ready; the displayed one stays when it fails
  useEffect(() => {
    let cancelled = false, made: string | null = null;
    const release = () => { if (made?.startsWith("blob:")) URL.revokeObjectURL(made); made = null; };
    if (!image.native) { setFull({ src: null, state: "none" }); return; }
    setFull({ src: null, state: "loading" });
    image.native().then(src => { made = src; if (cancelled) release(); else setFull({ src, state: "ready" }); }, () => { if (!cancelled) setFull({ src: null, state: "failed" }); });
    return () => { cancelled = true; release(); };
  }, [image]);

  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(null), 1800); return () => clearTimeout(t); }, [note]);

  // keep the fit (and a fitted picture) right when the window changes size
  useEffect(() => {
    const el = stage.current;
    if (!el || !size || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { const f = fitScale(size, pane()); setFit(f); if (fitted.current) setView(centredView(size, pane(), f)); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [size]); // eslint-disable-line react-hooks/exhaustive-deps

  // the viewer is modal: focus it, and give focus back when it closes
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    dialog.current?.focus({ preventScroll: true });
    return () => before?.focus?.({ preventScroll: true });
  }, []);

  const zoomTo = (scale: number, px?: number, py?: number) => {
    if (!view) return;
    const p = pane();
    fitted.current = false;
    setView(zoomViewAt(view, px ?? p.w / 2, py ?? p.h / 2, scale / view.scale, fit, dpr));
  };

  async function pictureBlob(): Promise<Blob> {
    const el = img.current;
    if (!shownSrc || !el || !size) throw Error("The picture is not loaded yet.");
    const fetched = await fetch(shownSrc).then(r => r.blob()).catch(() => null);
    if (fetched?.type === "image/png") return fetched;
    const canvas = document.createElement("canvas");
    canvas.width = size.w; canvas.height = size.h;
    canvas.getContext("2d")!.drawImage(el, 0, 0);
    return canvasBlob(canvas);
  }
  async function exportPicture(kind: "copy" | "save") {
    try {
      if (kind === "copy") { await copyPicture(pictureBlob()); setNote({ text: "Copied to clipboard" }); }
      else if (await savePicture(pictureBlob(), pictureFilename(image.title))) setNote({ text: "Saved" });
    } catch (e) { setNote({ text: `Could not ${kind} the picture: ${failureMessage(e)}`, error: true }); }
  }

  const shownSrc = full.src ?? picture.src;
  const loaded = !!size && !!shownSrc && !picture.error;
  function act(action: ViewerAction) {
    switch (action) {
      case "close": onClose(); break;
      case "zoomIn": if (view) zoomTo(stepZoom(view.scale, 1, dpr)); break;
      case "zoomOut": if (view) zoomTo(stepZoom(view.scale, -1, dpr)); break;
      case "fit": if (size) toFit(size); break;
      case "actual": zoomTo(scaleForPercent(100, dpr)); break;
      case "previous": if (index > 0) onIndex(index - 1); break;
      case "next": if (index < images.length - 1) onIndex(index + 1); break;
      case "copy": if (loaded) void exportPicture("copy"); break;
      case "save": if (loaded) void exportPicture("save"); break;
    }
  }
  const latest = useRef(act);
  latest.current = act;
  useEffect(() => {
    // capture, so the tab's own shortcuts never see a key the viewer used
    const key = (e: globalThis.KeyboardEvent) => {
      const action = viewerAction(e);
      if (!action) return;
      e.preventDefault(); e.stopImmediatePropagation();
      latest.current(action);
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, []);

  useWheel(stage, e => {
    const r = stage.current?.getBoundingClientRect();
    if (!r || !view) return true;
    fitted.current = false;
    setView(zoomViewAt(view, e.clientX - r.left, e.clientY - r.top, wheelFactor(e.deltaY), fit, dpr));
    return true;
  });

  function sample(x: number, y: number): number[] | undefined {
    if (sampler.current === false || !img.current || !size) return undefined;
    try {
      if (!sampler.current) {
        const canvas = document.createElement("canvas");
        canvas.width = size.w; canvas.height = size.h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) { sampler.current = false; return undefined; }
        ctx.drawImage(img.current, 0, 0);
        sampler.current = ctx;
      }
      const d = sampler.current.getImageData(x, y, 1, 1).data;
      return [d[0], d[1], d[2]];
    } catch { sampler.current = false; return undefined; } // a picture from another site cannot be read
  }
  const point = (e: PointerEvent) => { const r = stage.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function down(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, moved: 0 };
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (d && view) {
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      d.x = e.clientX; d.y = e.clientY; d.moved += Math.abs(dx) + Math.abs(dy);
      fitted.current = false;
      setView(panView(view, dx, dy, pane()));
    }
    if (!view || !size) return;
    const p = point(e), px = imagePixel(view, p.x, p.y, size);
    setHover(px ? { ...px, rgb: sample(px.x, px.y) } : null);
  }
  function up(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    drag.current = null;
    // a click on the backdrop, not on the picture and not the end of a drag, closes
    if (d && d.moved < 4 && view && size) {
      const p = point(e);
      if (!imagePixel(view, p.x, p.y, size)) onClose();
    }
  }
  function doubleClick(e: MouseEvent<HTMLDivElement>) {
    if (!view || !size) return;
    const r = stage.current!.getBoundingClientRect();
    if (Math.abs(view.scale - fit) < 1e-6 || view.scale < fit) zoomTo(Math.max(scaleForPercent(100, dpr), fit * 2), e.clientX - r.left, e.clientY - r.top);
    else toFit(size);
  }

  const percent = view ? nativePercent(view.scale, dpr) : null;
  const pixelated = !!view && view.scale * dpr >= 1;
  return <div ref={dialog} className="image-viewer" role="dialog" aria-modal={true} aria-label={`Image viewer: ${image.title}`} tabIndex={-1}>
    <header className="image-viewer-bar">
      <div className="image-viewer-title">
        <strong>{image.title}</strong>
        {image.detail && <span className="dim">{image.detail}</span>}
        {size && <span className="image-viewer-chip" title={full.state === "ready" || full.state === "none" ? "Resolution" : "Displayed size"}>{size.w} × {size.h}</span>}
        {full.state === "loading" && <span className="image-viewer-chip loading">Loading full resolution…</span>}
        {full.state === "failed" && <span className="image-viewer-chip" title="The native-resolution picture could not be loaded">displayed size · native unavailable</span>}
        {multiple && <span className="image-viewer-chip">{index + 1} / {images.length}</span>}
      </div>
      <div className="image-viewer-tools" role="toolbar" aria-label="Image viewer tools">
        <div className="image-viewer-group">
          <IconButton icon="zoomOut" label="Zoom out" title="Zoom out (−)" disabled={!view} onClick={() => act("zoomOut")} />
          <button type="button" className="image-viewer-percent" aria-label="Zoom level" title="Click: fit ↔ actual size" disabled={!view} onClick={() => act(percent !== null && Math.abs(percent - 100) < .5 ? "fit" : "actual")}>{percent === null ? "—" : percentText(percent)}</button>
          <IconButton icon="zoomIn" label="Zoom in" title="Zoom in (+)" disabled={!view} onClick={() => act("zoomIn")} />
        </div>
        <div className="image-viewer-group">
          <IconButton icon="fit" label="Fit to window" title="Fit to window (0)" disabled={!view} onClick={() => act("fit")} />
          <IconButton icon="actual" label="Actual size" title="Actual size, 1 picture pixel per screen pixel (1)" disabled={!view} onClick={() => act("actual")} />
        </div>
        <div className="image-viewer-group">
          <IconButton icon="copy" label="Copy image" title="Copy image (Ctrl+C)" disabled={!loaded} onClick={() => act("copy")} />
          <IconButton icon="import" label="Save image" title="Save as PNG (Ctrl+S)" disabled={!loaded} onClick={() => act("save")} />
        </div>
        <IconButton icon="close" label="Close viewer" title="Close (Esc)" className="image-viewer-close" onClick={onClose} />
      </div>
    </header>
    <div ref={stage} className={`image-viewer-stage${drag.current ? " dragging" : ""}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; }} onPointerLeave={() => setHover(null)} onDoubleClick={doubleClick}>
      {picture.error ? <div className="image-viewer-message" role="alert">Could not load the picture: {picture.error}</div>
        : !shownSrc ? <div className="image-viewer-message" role="status">Preparing picture…</div>
          : <img ref={img} key={shownSrc} src={shownSrc} alt={image.title} draggable={false}
            className={pixelated ? "pixelated" : undefined}
            style={view && size ? { width: size.w, height: size.h, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` } : { visibility: "hidden" }}
            onLoad={e => { const s = { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight }; if (!(s.w > 0 && s.h > 0)) { setPicture(p => ({ ...p, error: "the picture is empty" })); return; } if (size && view && !fitted.current && size.w > 0) { const ratio = size.w / s.w; setFit(fitScale(s, pane())); setView({ ...view, scale: view.scale * ratio }); setSize(s); sampler.current = null; return; } setSize(s); sampler.current = null; toFit(s); }}
            onError={() => setPicture(p => ({ ...p, error: "the file is missing or not a picture" }))} />}
      {!size && shownSrc && !picture.error && <div className="image-viewer-message" role="status">Loading…</div>}
      {multiple && <>
        <IconButton icon="left" label="Previous image" title="Previous (←)" className="image-viewer-nav previous" disabled={index === 0} onClick={() => act("previous")} />
        <IconButton icon="right" label="Next image" title="Next (→)" className="image-viewer-nav next" disabled={index === images.length - 1} onClick={() => act("next")} />
      </>}
    </div>
    <footer className="image-viewer-foot">
      <span className="image-viewer-pixel" aria-live="off">
        {hover ? <>
          <span>x <b>{hover.x}</b> · y <b>{hover.y}</b></span>
          {hover.rgb && <><span className="image-viewer-swatch" style={{ background: hex(hover.rgb) }} /><span>{hex(hover.rgb)} · rgb({hover.rgb.join(", ")})</span></>}
        </> : <span className="dim">Scroll to zoom · drag to pan · double-click to zoom · Esc to close</span>}
      </span>
      {multiple && <div className="image-viewer-strip" role="group" aria-label="Pictures">
        {images.map((p, i) => <button key={i} type="button" aria-pressed={i === index} aria-label={`Show ${p.title}`} onClick={() => onIndex(i)}>
          {typeof p.src === "string" && <img src={p.src} alt="" draggable={false} />}<span>{p.title}</span>
        </button>)}
      </div>}
    </footer>
    {note && <div className={`image-viewer-note${note.error ? " error" : ""}`} role={note.error ? "alert" : "status"}>{note.error ? <Icon name="alert" /> : <Icon name="check" />}{note.text}</div>}
  </div>;
}
