import { inTauri } from "./api";
import { blobDataUrl, canvasBlob as encodeCanvas, loadImage as loadPicture } from "./canvas";
import { askSavePath, blobBytes, copyPicture, downloadBlob, proofExtension } from "./proofExport";

export interface ProofRect { x: number; y: number; width: number; height: number }
export interface ProofMask { svg: SVGSVGElement; description: string; opacity: number; details?: string; bounds?: ProofRect }
export const proofOpacity = (value: number) => value > 0 ? Math.min(1, value) : 1;

/** One shared source-pixel crop for before/after, with 20% context (at least eight pixels). */
export function proofCrop(width: number, height: number, bounds: ProofRect[]): ProofRect {
  if (![width, height].every(Number.isFinite) || width <= 0 || height <= 0) throw Error("The picture is not ready yet.");
  if (!bounds.length) return {x: 0, y: 0, width, height};
  if (bounds.some(b => ![b.x, b.y, b.width, b.height].every(Number.isFinite) || b.width <= 0 || b.height <= 0)) throw Error("The texture mask has invalid bounds.");
  const left = Math.max(0, Math.min(...bounds.map(b => b.x)));
  const top = Math.max(0, Math.min(...bounds.map(b => b.y)));
  const right = Math.min(width, Math.max(...bounds.map(b => b.x + b.width)));
  const bottom = Math.min(height, Math.max(...bounds.map(b => b.y + b.height)));
  if (right <= left || bottom <= top) throw Error("The texture mask is outside the picture.");
  const pad = Math.max(8, Math.ceil(Math.max(right - left, bottom - top) * 0.2));
  const x = Math.max(0, Math.floor(left - pad)), y = Math.max(0, Math.floor(top - pad));
  return {x, y, width: Math.min(width, Math.ceil(right + pad)) - x, height: Math.min(height, Math.ceil(bottom + pad)) - y};
}

/** Expand, never cut off, the selected fire. Wide/tall source frames may need letterboxing. */
export function squareProofCrop(width: number, height: number, crop: ProofRect): ProofRect {
  const side = Math.max(crop.width, crop.height);
  const origin = (center: number, limit: number) => Math.round(side <= limit ? Math.max(0, Math.min(limit - side, center - side / 2)) : (limit - side) / 2);
  return {x: origin(crop.x + crop.width / 2, width), y: origin(crop.y + crop.height / 2, height), width: side, height: side};
}

/** HUD texels already contain projected source-pixel coordinates; editing guides were removed first. */
function maskBounds(svg: SVGSVGElement): ProofRect | undefined {
  const points = Array.from(svg.querySelectorAll("polygon")).flatMap(p => {
    const coordinates = (p.getAttribute("points") ?? "").trim().split(/[\s,]+/).map(Number);
    if (coordinates.length < 6 || coordinates.length % 2 || !coordinates.every(Number.isFinite)) return [];
    return Array.from({length: coordinates.length / 2}, (_, i) => ({x: coordinates[i * 2], y: coordinates[i * 2 + 1]}));
  });
  if (!points.length) return undefined;
  const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y));
  return {x, y, width: Math.max(...points.map(p => p.x)) - x, height: Math.max(...points.map(p => p.y)) - y};
}

export function proofLayout(width: number, height: number) {
  if (![width, height].every(Number.isFinite) || width <= 0 || height <= 0) throw Error("The picture is not ready yet.");
  const scale = Math.min(4096 / width, 4096 / height, Math.max(1, 640 / width));
  const panelWidth = Math.round(width * scale), panelHeight = Math.round(height * scale);
  const font = Math.max(14, Math.min(48, Math.round(panelWidth / 36)));
  return { panelWidth, panelHeight, font, header: font * 5, footer: font * 2, gap: Math.max(8, Math.round(panelWidth / 120)) };
}

const loadImage = (url: string) => loadPicture(url, "Could not render the comparison mask.");
const dataUrl = (blob: Blob) => blobDataUrl(blob, "Could not read the compressed mask.");

/** Snapshot the rendered mask, including compression, but never its editing controls. */
export function cleanProofMask(mask: ProofMask, width: number, height: number): SVGSVGElement {
  if (mask.svg.querySelector('[role="status"], [role="alert"]')) throw Error("Wait for the mask preview to finish loading before making a comparison proof.");
  const clone = mask.svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll(".fire-quad-guide, .fire-quad-handle, .quad-transform, title").forEach(node => node.remove());
  if (!clone.querySelector("polygon, image")) throw Error("The mask texture is still loading. Try again in a moment.");
  clone.removeAttribute("class");
  clone.removeAttribute("style");
  clone.querySelectorAll("[opacity]").forEach(node => node.removeAttribute("opacity"));
  clone.setAttribute("opacity", String(proofOpacity(mask.opacity)));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  return clone;
}

async function rasterMask(svg: SVGSVGElement): Promise<{ image: HTMLImageElement; dispose: () => void }> {
  // Blob-backed compressed PNGs must be embedded before the SVG becomes an image.
  for (const image of svg.querySelectorAll("image")) {
    const href = image.getAttribute("href");
    if (href && !href.startsWith("data:")) {
      const response = await fetch(href);
      if (!response.ok) throw Error("Could not read the mask preview.");
      image.setAttribute("href", await dataUrl(await response.blob()));
    }
  }
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }));
  try { return { image: await loadImage(url), dispose: () => URL.revokeObjectURL(url) }; }
  catch (error) { URL.revokeObjectURL(url); throw error; }
}

export type ProofFormat = "gif" | "webp" | "png" | "jpeg";
export interface ProofAction {format: ProofFormat; destination: "copy" | "save"}

const canvasBlob = (canvas: HTMLCanvasElement, type = "image/png") => encodeCanvas(canvas, type, 0.95, "Could not render the comparison proof.");

async function renderProof(picture: HTMLImageElement, masks: ProofMask[], source: string, animated = false, type = "image/png"): Promise<{image: Blob; base?: Blob}> {
  if (!picture.complete || !picture.naturalWidth || !picture.naturalHeight) throw Error("Wait for the current picture to load.");
  if (!masks.length) throw Error("Turn on a texture mask before making a comparison proof.");
  const { naturalWidth: width, naturalHeight: height } = picture;
  // Clone geometry and pixels synchronously: animation/frame navigation cannot change this proof later.
  const layers = masks.map(mask => ({ ...mask, svg: cleanProofMask(mask, width, height) }));
  let crop = proofCrop(width, height, layers.flatMap(mask => {
    const bounds = mask.bounds ?? maskBounds(mask.svg);
    return bounds ? [bounds] : [];
  }));
  if (animated) crop = squareProofCrop(width, height, crop);
  const {panelWidth: w, panelHeight: h, font, header, footer, gap} = animated
    ? {panelWidth: 640, panelHeight: 640, font: 18, header: 108, footer: 36, gap: 0}
    : proofLayout(crop.width, crop.height);
  const canvas = document.createElement("canvas");
  canvas.width = animated ? header + h + footer : w * 2 + gap; canvas.height = header + h + footer;
  const context = canvas.getContext("2d");
  if (!context) throw Error("Image rendering is unavailable.");
  context.fillStyle = "#111722"; context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = false;
  const panelX = animated ? (canvas.width - w) / 2 : w + gap;
  const drawCrop = (image: CanvasImageSource, x: number) => {
    const sx = Math.max(0, crop.x), sy = Math.max(0, crop.y);
    const sw = Math.min(width, crop.x + crop.width) - sx, sh = Math.min(height, crop.y + crop.height) - sy;
    context.drawImage(image, sx, sy, sw, sh, x + (sx - crop.x) * w / crop.width, header + (sy - crop.y) * h / crop.height, sw * w / crop.width, sh * h / crop.height);
  };
  if (!animated) drawCrop(picture, 0);
  drawCrop(picture, panelX);
  context.fillStyle = "#ffffff"; context.font = `600 ${font}px sans-serif`;
  const textX = animated ? font : w + gap + font, textWidth = (animated ? canvas.width : w) - font * 2;
  if (animated) context.fillText("Comparison proof · overlay fade", font, font * 1.5, textWidth);
  else {
    context.fillText("Original", font, font * 1.5, w - font * 2);
    context.fillText("After · mask comparison", textX, font * 1.5, textWidth);
  }
  context.font = `${font}px sans-serif`;
  context.fillText(source.slice(0, 140), font, font * 3, animated ? textWidth : w - font * 2);
  // The viewer offers one active mask mode; record the displayed sprite, never the candidate/guess.
  layers.forEach((mask, index) => {
    context.fillText(mask.description, textX, font * ((animated ? 4 : 3) + index), textWidth);
  });
  context.fillStyle = "#bdc8da";
  context.fillText(layers.map(mask => `Opacity ${animated ? "0–" : ""}${Math.round(proofOpacity(mask.opacity) * 100)}%${mask.details ? ` · ${mask.details}` : ""}`).join(" / "), textX, font * (animated ? 5 : 4.3), textWidth);
  context.fillText(`${animated ? "Aligned reference" : "Comparison proof · manually aligned reference overlay"} · crop ${crop.x},${crop.y} · ${crop.width}×${crop.height} source px`, font, header + h + font * 1.35, canvas.width - font * 2);
  const base = animated ? await canvasBlob(canvas) : undefined;
  for (const layer of layers) {
    const raster = await rasterMask(layer.svg);
    try { drawCrop(raster.image, panelX); }
    finally { raster.dispose(); }
  }
  return {image: await canvasBlob(canvas, type), base};
}

export async function createComparisonProof(picture: HTMLImageElement, masks: ProofMask[], source: string): Promise<Blob> {
  return (await renderProof(picture, masks, source)).image;
}

/** Animated copies carry the actual file so pasting into Discord preserves every frame. */
export async function copyFormattedComparisonProof(picture: HTMLImageElement, masks: ProofMask[], source: string, format: ProofFormat): Promise<void> {
  if (format === "png") return copyPicture(createComparisonProof(picture, masks, source));
  if (!inTauri()) throw Error("Use the desktop app to copy this format, or use its save button.");
  const {image, base} = await renderProof(picture, masks, source, format === "gif" || format === "webp");
  const {invoke} = await import("@tauri-apps/api/core");
  await invoke("copy_formatted_comparison_proof", {format, png: Array.from(new Uint8Array(await image.arrayBuffer())), base: base ? Array.from(new Uint8Array(await base.arrayBuffer())) : null});
}

/** Explicit downloads preserve animation; image clipboards generally flatten animated files. */
export async function downloadComparisonProof(picture: HTMLImageElement, masks: ProofMask[], source: string, format: ProofFormat): Promise<boolean> {
  const animated = format === "gif" || format === "webp";
  if (animated && !inTauri()) throw Error("Use the desktop app to save animated comparison proofs.");
  // Freeze the picture and geometry before the save dialog or any asynchronous work.
  const pending = renderProof(picture, masks, source, animated, !inTauri() && format === "jpeg" ? "image/jpeg" : "image/png");
  void pending.catch(() => {});
  const filename = `comparison-proof.${proofExtension(format)}`;
  if (inTauri()) {
    const path = await askSavePath(filename, format);
    if (!path) return false;
    const {image, base} = await pending;
    const {invoke} = await import("@tauri-apps/api/core");
    await invoke("save_comparison_proof", {path, format, png: await blobBytes(image), base: await blobBytes(base)});
  } else {
    downloadBlob((await pending).image, filename);
  }
  return true;
}
