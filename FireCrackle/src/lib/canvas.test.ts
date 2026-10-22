import { afterEach, expect, it, vi } from "vitest";
import { blobDataUrl, canvasBlob, loadImage, loadImageBytes } from "./canvas";

class FakeImage { onload?: () => void; onerror?: () => void; set src(v: string) { queueMicrotask(() => (v.includes("bad") ? this.onerror?.() : this.onload?.())); } }
afterEach(() => vi.unstubAllGlobals());

it("loads an image and reports the caller's own failure text", async () => {
  vi.stubGlobal("Image", FakeImage);
  await expect(loadImage("ok.png")).resolves.toBeInstanceOf(FakeImage);
  await expect(loadImage("bad.png", "Could not load motion preview")).rejects.toThrow("Could not load motion preview");
});

it("loads image bytes through a temporary URL that is always released", async () => {
  vi.stubGlobal("Image", FakeImage);
  const urls: string[] = [];
  let n = 0;
  vi.stubGlobal("URL", { createObjectURL: () => { const u = `blob:${n++ === 1 ? "bad" : "ok"}`; urls.push(u); return u; }, revokeObjectURL: (u: string) => urls.splice(urls.indexOf(u), 1) });
  await loadImageBytes(new ArrayBuffer(4));
  await expect(loadImageBytes(new ArrayBuffer(4))).rejects.toThrow();
  expect(urls).toEqual([]);
});

it("encodes a canvas, and a canvas that gives no blob is an error", async () => {
  const blob = new Blob(["x"]);
  const good = { toBlob: (cb: (b: Blob | null) => void, type: string, q: number) => { expect([type, q]).toEqual(["image/jpeg", 0.9]); cb(blob); } } as unknown as HTMLCanvasElement;
  await expect(canvasBlob(good, "image/jpeg", 0.9)).resolves.toBe(blob);
  const bad = { toBlob: (cb: (b: Blob | null) => void) => cb(null) } as unknown as HTMLCanvasElement;
  await expect(canvasBlob(bad, "image/png", undefined, "PNG export failed")).rejects.toThrow("PNG export failed");
});

it("reads a blob as a data URL", async () => {
  vi.stubGlobal("FileReader", class { result = "data:image/png;base64,eA=="; onload?: () => void; onerror?: () => void; readAsDataURL() { queueMicrotask(() => this.onload?.()); } });
  await expect(blobDataUrl(new Blob(["x"]))).resolves.toBe("data:image/png;base64,eA==");
});
