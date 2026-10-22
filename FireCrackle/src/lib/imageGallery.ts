import type { View } from "./api";
import type { PreviewSprite } from "./firePreview";
import { clampFrame } from "./frameMath";

export interface GalleryImage { id: string; name: string; url: string; file: File }
export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/bmp,image/avif";
export function isPhoto(file: Pick<File, "type" | "name">): boolean {
  return /^(image\/(png|jpeg|webp|bmp|avif))$/i.test(file.type) || (!file.type && /\.(png|jpe?g|webp|bmp|avif)$/i.test(file.name));
}
export function imageIndex(index: number, count: number): number { return clampFrame(index, count); }
export function clipboardPhotos(data: Pick<DataTransfer, "files" | "items"> | null): File[] {
  if (!data) return [];
  const files = Array.from(data.files).filter(isPhoto);
  return files.length ? files : Array.from(data.items).filter(item => item.kind === "file").map(item => item.getAsFile()).filter((file): file is File => !!file && isPhoto(file));
}
export function imageView(index: number, count: number, selected: PreviewSprite | null): View {
  return { current: imageIndex(index, count), frame_count: count, fps: 1, pts: 0, label: "unset", suggestion: null,
    pick: { sheet: selected?.sheet ?? 1, mirrored: selected?.mirrored ?? false }, typed_pending: null,
    labelled_count: 0, flag_count: 0, warnings: [], save_error: null };
}

/** Appending photos never replaces or reopens the video backend. */
export function appendImages(current: GalleryImage[], files: File[], createUrl = (file: File) => URL.createObjectURL(file)): { images: GalleryImage[]; rejected: number } {
  const images = [...current]; let rejected = 0;
  for (const file of files) {
    if (!isPhoto(file)) { rejected++; continue; }
    if (images.some(image => image.name === file.name && image.file.size === file.size && image.file.lastModified === file.lastModified)) continue;
    images.push({ id: crypto.randomUUID(), name: file.name, url: createUrl(file), file });
  }
  return { images, rejected };
}
