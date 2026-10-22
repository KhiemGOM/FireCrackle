// Image and canvas plumbing shared by previews, proofs, thumbnails and compression. Each takes the caller's failure
// text, so the error a user sees still names what was being done.

export function loadImage(src: string, failure = "Could not load the picture."): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(failure));
    image.src = src;
  });
}

/** An image from encoded bytes; the temporary object URL is released whether it loads or not. */
export async function loadImageBytes(bytes: ArrayBuffer, type = "image/jpeg", failure = "Could not load the picture."): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  try { return await loadImage(url, failure); } finally { URL.revokeObjectURL(url); }
}

export function canvasBlob(canvas: HTMLCanvasElement, type = "image/png", quality?: number, failure = "Could not encode the picture."): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error(failure))), type, quality));
}

export function blobDataUrl(blob: Blob, failure = "Could not read the picture."): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(failure));
    reader.readAsDataURL(blob);
  });
}
