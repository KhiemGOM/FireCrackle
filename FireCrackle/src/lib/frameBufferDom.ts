import type { BufferIo } from "./frameBuffer";

/** The browser side of the frame buffer: object URLs for the JPEG bytes, and `Image.decode()` to decode ahead of time. */
export function domBufferIo(fetchFrame: (frame: number) => Promise<ArrayBuffer>): BufferIo {
  return {
    fetch: fetchFrame,
    createUrl: (bytes) => URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" })),
    revokeUrl: (url) => URL.revokeObjectURL(url),
    predecode: async (url) => {
      const image = new Image();
      image.src = url;
      await image.decode();
    },
  };
}
