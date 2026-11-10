// Copy or save the picture the video viewer is on: the frame itself at the video's own resolution, never the
// overlays drawn over it. The clipboard and save plumbing is the comparison proof's (proofExport).
import type { Backend } from "./api";
import { canvasBlob, loadImageBytes } from "./canvas";
import { nativeFrame, pngSize } from "./exactFrame";
import { copyPicture, savePicture } from "./proofExport";

/** A video frame, or the image open in the Images tab. */
export type FrameSource =
  | { backend: Pick<Backend, "frame" | "exactFrame">; frame: number }
  | { still: { name: string; url: string; file?: Blob } };

/** Ctrl+Shift+C (Cmd on a Mac). Plain Ctrl+C stays the text copy; a held key or a typing field never copies. */
export function copyFrameKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; repeat: boolean; blocked: boolean }): boolean {
  return (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && !e.repeat && !e.blocked && e.key.toLowerCase() === "c";
}

/** The picture as a PNG with its size. `native`: the frame at the video's own resolution, not the scaled display one. */
export async function framePng(source: FrameSource): Promise<{ png: Blob; width: number; height: number; native: boolean }> {
  const picture: Blob = "still" in source
    ? source.still.file ?? await (await fetch(source.still.url)).blob()
    : await nativeFrame(source.backend, source.frame);
  const native = "still" in source || picture.type === "image/png";
  const bytes = await picture.arrayBuffer(), size = picture.type === "image/png" ? pngSize(bytes) : null;
  if (size) return { png: picture, ...size, native };
  // the clipboard and the save command take PNG only
  const image = await loadImageBytes(bytes, picture.type || "image/jpeg", "Could not read the frame.");
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  canvas.getContext("2d")!.drawImage(image, 0, 0);
  return { png: await canvasBlob(canvas, "image/png", undefined, "Could not encode the frame."), width: image.naturalWidth, height: image.naturalHeight, native };
}

const what = (source: FrameSource) => "still" in source ? "image" : `frame ${source.frame}`;

export function frameFilename(source: FrameSource): string {
  if (!("still" in source)) return `frame-${source.frame}.png`;
  return `${source.still.name.replace(/\.[^./\\]*$/, "") || "image"}.png`;
}

/** Copy the picture; resolves to the note to show. The picture's promise goes to the clipboard at once, inside the
 * click or key press, so a browser keeps that gesture's permission while the frame decodes. */
export async function copyFrame(source: FrameSource): Promise<string> {
  const picture = framePng(source);
  await copyPicture(picture.then(p => p.png));
  const { width, height, native } = await picture;
  return `Copied ${what(source)} · ${width} × ${height}${native ? "" : " (display quality)"}`;
}

/** Save the picture as a PNG file; null when the save dialog is cancelled. */
export async function saveFrame(source: FrameSource): Promise<string | null> {
  return await savePicture(framePng(source).then(p => p.png), frameFilename(source)) ? `Saved ${what(source)}` : null;
}
