import {ANIMATION_ATLASES} from "../lib/animationAtlases";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { Backend } from "../lib/api";
import { atlasSprite, spriteLabel, spriteWithSheet, type PreviewSprite } from "../lib/firePreview";
import { isFire, type Label } from "../lib/grid";
import { spriteText, candidateText } from "../lib/labelCandidate";
import { appendImages, clipboardPhotos, IMAGE_ACCEPT, imageIndex, imageView, type GalleryImage } from "../lib/imageGallery";
import { pickerCellSize, SIDE_LIMITS, VIDEO_LIMITS, upperBound } from "../lib/layout";
import { scopedStorage } from "../lib/scopedStorage";
import { loadGallery, saveGallery } from "../lib/galleryStore";
import { readPreferences, writePreferences } from "../lib/preferences";
import { zoomPanel } from "../lib/zoom";
import type { AtlasEdges } from "../lib/atlasFilter";
import { useWheel } from "../hooks/useWheel";
import { VideoPane, type VideoPreviewHandle } from "./VideoPane";
import { Picker } from "./Picker";
import { Splitter } from "./Splitter";
import { IconButton } from "./Icon";
import "./ImagesTab.css";

/** Own files and selections; the viewer, fire tools and atlas are shared with video. */
export function ImagesTab({ active, backend }: { active: boolean; backend: Backend }) {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [stateStorage] = useState(() => scopedStorage("image-gallery"));
  const currentImages = useRef(images); currentImages.current = images;
  const [index, setIndex] = useState(0);
  const [checks, setChecks] = useState<Record<string, Label>>({});
  const [preview, setPreview] = useState<PreviewSprite | null>(null);
  const [edges, setEdges] = useState<AtlasEdges | null>(null);
  const [filter, setFilter] = useState(() => readPreferences(scopedStorage("images")).atlasFilter);
  const [sideWidth, setSideWidth] = useState(400);
  const [videoHeight, setVideoHeight] = useState(520);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(typeof indexedDB !== "undefined");
  // The paste listener outlives the render that attached it, so it reads this rather than `restoring`.
  const restoringNow = useRef(restoring); restoringNow.current = restoring;
  const [storageError, setStorageError] = useState<string | null>(null);
  const galleryLoaded = useRef(false);
  useEffect(() => {
    let cancelled = false;
    loadGallery().then(saved => {
      if (cancelled) { for (const image of saved.images) URL.revokeObjectURL(image.url); return; }
      setImages(saved.images); currentImages.current = saved.images;
      setIndex(saved.index); setChecks(saved.checks); galleryLoaded.current = true; setRestoring(false);
    }).catch(error => {
      if (!cancelled) { setRestoring(false); setStorageError(`Could not restore saved photos: ${String(error)}. New photos will be temporary.`); }
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!galleryLoaded.current || restoring) return;
    let cancelled = false;
    saveGallery(images, index, checks).then(() => { if (!cancelled) setStorageError(null); })
      .catch(error => { if (!cancelled) setStorageError(`Photos could not be saved locally: ${String(error)}`); });
    return () => { cancelled = true; };
  }, [images, index, checks, restoring]);
  const input = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const selectedThumb = useRef<HTMLButtonElement>(null);
  const viewer = useRef<VideoPreviewHandle>(null);
  const item = images[imageIndex(index, images.length)];
  const selected = item ? checks[item.id] ?? null : null;
  const sprite:PreviewSprite|null = selected && isFire(selected) ? selected.fire as PreviewSprite : selected&&typeof selected==="object"&&"texture" in selected?{...selected.texture,sheet:selected.texture.atlas.endsWith("_0")?0:1}:null;
  const view = imageView(index, images.length, sprite);
  useEffect(() => { writePreferences({ atlasFilter: filter }, scopedStorage("images")); }, [filter]);
  useEffect(() => () => { for (const image of currentImages.current) URL.revokeObjectURL(image.url); }, []);
  useEffect(() => { if (active) selectedThumb.current?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [item?.id, active]);
  useWheel(picker, event => event.ctrlKey ? (setZoom(value => zoomPanel(value, event.deltaY)), true) : false);

  const stage = useCallback((next: PreviewSprite) => {
    if (!item) return;
    setChecks(values => ({ ...values, [item.id]: spriteLabel(next) }));
    viewer.current?.selectSprite(next);
  }, [item?.id]);
  const step = (delta: number) => setIndex(value => imageIndex(value + delta, images.length));
  useEffect(() => {
    if (!active || !item) return;
    const key = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || (event.target as HTMLElement | null)?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test((event.target as HTMLElement | null)?.tagName ?? "")) return;
      const current = sprite ?? preview ?? { sheet: 1 as const, row: 0, mirrored: false };
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); step((event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 10 : 1)); }
      else if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); stage({ ...current, row: (current.row + (event.key === "ArrowUp" ? -1 : 1) + (current.atlas?ANIMATION_ATLASES[current.atlas].rows:32)) % (current.atlas?ANIMATION_ATLASES[current.atlas].rows:32) }); }
      else if (event.key.toLowerCase() === "r") { event.preventDefault(); stage({ ...current, mirrored: !current.mirrored }); }
      else if (event.key.toLowerCase() === "t") { event.preventDefault(); stage(spriteWithSheet(current,(1-current.sheet) as 0|1)); }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [active, item?.id, images.length, sprite, preview, stage]);

  useEffect(() => {
    if (!active) return;
    const paste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || /^(INPUT|TEXTAREA)$/.test(target?.tagName ?? "")) return;
      const files = clipboardPhotos(event.clipboardData);
      if (files.length) { event.preventDefault(); add(files); }
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  }, [active]);

  async function pasteImage() {
    try {
      if (!navigator.clipboard?.read) throw Error("Clipboard read unavailable");
      const items = await navigator.clipboard.read();
      const files: File[] = [];
      for (const [i, item] of items.entries()) {
        const type = item.types.find(value => /^image\/(png|jpeg|webp|bmp|avif)$/.test(value));
        if (type) files.push(new File([await item.getType(type)], `Clipboard-${Date.now()}-${i}.${type.split("/")[1]}`, { type }));
      }
      if (!files.length) { setError("No image found in the clipboard. Copy an image or screenshot first."); return; }
      add(files);
    } catch { setError("Clipboard access is unavailable. Copy an image, then press Ctrl+V in the Images tab."); }
  }

  function add(files: File[]) {
    if (restoringNow.current) return;
    try {
      const previousCount = currentImages.current.length;
      const result = appendImages(currentImages.current, files);
      setImages(result.images); currentImages.current = result.images;
      if (result.images.length > previousCount) setIndex(previousCount);
      setError(result.rejected ? `${result.rejected} unsupported file(s). Use PNG, JPEG, WebP, BMP or AVIF.` : null);
    } catch (error) { setError(`Could not open photos: ${String(error)}`); }
  }
  function remove() {
    if (!item) return;
    const next = images.filter(image => image.id !== item.id);
    URL.revokeObjectURL(item.url); setImages(next); currentImages.current = next;
    setIndex(imageIndex(index, next.length));
    setChecks(values => { const result = { ...values }; delete result[item.id]; return result; });
    setError(null);
  }
  function clear() {
    for (const image of images) URL.revokeObjectURL(image.url);
    currentImages.current = []; setImages([]); setIndex(0); setChecks({}); setError(null);
  }
  if (!active) return null; // Keep photos in this component; stop viewer hotkeys/animation while hidden.
  return <section className="images-workspace" aria-label="Image fire checks" onDragOver={event => event.preventDefault()}
    onDrop={event => { event.preventDefault(); add(Array.from(event.dataTransfer.files)); }}>
    <div className="images-toolbar">
      <input ref={input} type="file" accept={IMAGE_ACCEPT} multiple hidden aria-label="Choose photos" onChange={event => { add(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
      <IconButton icon="folder" label="Add photos" disabled={restoring} onClick={() => input.current?.click()}>Add photos</IconButton>
      <IconButton icon="copy" label="Paste image" disabled={restoring} title="Paste a copied image · Ctrl+V" onClick={() => void pasteImage()}>Paste image</IconButton>
      <span className="dim">{images.length ? `${images.length} photo${images.length === 1 ? "" : "s"}` : "PNG · JPEG · WebP · BMP · AVIF"} · one-off checks · no video labels are changed</span>
      {item && <><IconButton icon="erase" label="Remove selected photo" onClick={remove} /><button onClick={clear}>Clear gallery</button></>}
    </div>
    {error && <div className="banner error" role="alert">{error}<button onClick={() => setError(null)}>Dismiss</button></div>}
    {storageError && <div className="banner error" role="alert">{storageError}</div>}
    {restoring ? <div className="images-empty" role="status">Restoring saved photos…</div> : !item ? <div className="images-empty"><h2>Check fire in a photo</h2><p>Add several photos, drop them here, or paste a screenshot with Ctrl+V. Photos and their mask settings are saved locally on this device.</p><button className="big" onClick={() => input.current?.click()}>Add photos…</button></div>
      : <main className="workarea" ref={area} style={{ "--side-w": `${sideWidth}px`, "--video-h": `${videoHeight}px` } as CSSProperties}>
        <section className="left">
          <VideoPane key={item.id} videoKey={`image:${item.id}`} storageScope={`image:${item.id}`} stateStorage={stateStorage} stillImage={item}
            backend={backend} view={view} atlasFilter={filter} atlasEdges={edges} previewRef={viewer}
            onPreviewChange={setPreview} onMatchCandidate={stage} onStep={step} onError={setError} />
          <Splitter direction="row" label="Image height" value={videoHeight} min={VIDEO_LIMITS.min} getMax={() => upperBound(area.current?.clientHeight ?? 0, 170, VIDEO_LIMITS.max)} onChange={setVideoHeight} onReset={() => setVideoHeight(520)} />
          <div className="image-gallery" aria-label="Photo gallery">
            {images.map((image, i) => <button key={image.id} ref={image.id === item.id ? selectedThumb : undefined} aria-pressed={image.id === item.id} onClick={() => { setIndex(i); setError(null); }} title={image.name}>
              <img src={image.url} alt="" loading="lazy" /><span>{i + 1}. {image.name}</span>
            </button>)}
          </div>
        </section>
        <Splitter direction="col" label="Image picker width" sign={-1} value={sideWidth} min={SIDE_LIMITS.min} getMax={() => upperBound(area.current?.clientWidth ?? 0, 360, SIDE_LIMITS.max)} onChange={setSideWidth} onReset={() => setSideWidth(400)} />
        <aside className="right">
          <div className="pick-state">
            <IconButton icon="layers" label="Switch image preview sheet" onClick={() => stage(spriteWithSheet(sprite??{sheet:1,row:0,mirrored:false},(1-(sprite?.sheet??1)) as 0|1))}>{sprite?.sheet ?? 1}</IconButton>
            <IconButton icon="mirror" label="Mirror image preview" aria-pressed={sprite?.mirrored ?? false} onClick={() => stage({...sprite,sheet:sprite?.sheet??1,row:sprite?.row??0,mirrored:!sprite?.mirrored})}>{sprite?.mirrored ? "mirrored" : "normal"}</IconButton>
          </div>
          <div className="candidate-panel"><strong>Image check</strong><div className="candidate-value">{sprite ? spriteText(sprite) : selected ? candidateText(selected) : "Choose a sprite to compare"}</div>
            <div className="atlas-state preview-state"><b>Preview</b><span>{preview ? spriteText(preview) : "Mask off"}</span></div>
            <div className="candidate-help">Click a sprite to compare · no confirmation needed<br />← → photos · ↑ ↓ sprite row · R mirror · T sheet</div>
          </div>
          <div className="picker-box" ref={picker} onDoubleClick={event => event.ctrlKey && setZoom(1)}>
            <Picker onAlternative={next=>stage(next)} previewOnly view={view} candidate={selected} preview={preview} cell={pickerCellSize(sideWidth) * zoom} filter={filter} onFilterChange={setFilter} onEdgesChange={setEdges}
              onNoFire={label => setChecks(values => ({ ...values, [item.id]: label }))} onCell={(col, row) => { const next = atlasSprite(col, row); if (next) stage(next); }} />
          </div>
        </aside>
      </main>}
  </section>;
}
