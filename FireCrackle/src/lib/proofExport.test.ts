import { afterEach, expect, it, vi } from "vitest";
import { blobBytes, downloadBlob, formatMegabytes, proofExtension } from "./proofExport";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("sends a blob to the backend as a plain byte array", async () => {
  expect(await blobBytes(new Blob([new Uint8Array([1, 2, 255])]))).toEqual([1, 2, 255]);
  expect(await blobBytes(null)).toBeNull();
});

it("downloads in the browser and releases the object URL afterwards", () => {
  vi.useFakeTimers();
  const clicked: string[] = [];
  const revoked: string[] = [];
  vi.stubGlobal("URL", { createObjectURL: () => "blob:1", revokeObjectURL: (u: string) => revoked.push(u) });
  vi.stubGlobal("document", { createElement: () => ({ set href(v: string) { clicked.push(v); }, download: "", click() { clicked.push(`click:${this.download}`); } }) });
  downloadBlob(new Blob(["x"]), "proof.png");
  expect(clicked).toEqual(["blob:1", "click:proof.png"]);
  expect(revoked).toEqual([]);
  vi.advanceTimersByTime(1000);
  expect(revoked).toEqual(["blob:1"]);
});

it("uses .jpg for JPEG and the format name otherwise", () => {
  expect(["jpeg", "png", "gif", "webp"].map(f => proofExtension(f as never))).toEqual(["jpg", "png", "gif", "webp"]);
});

it("formats sizes in megabytes with one decimal", () => {
  expect([0, 1048576, 52428800, 1572864].map(formatMegabytes)).toEqual(["0.0 MB", "1.0 MB", "50.0 MB", "1.5 MB"]);
});

it("describes a download's speed and time left, or says it is measuring", async () => {
  const { downloadReadout } = await import("./proofExport");
  expect(downloadReadout(null)).toBe("measuring speed…");
  expect(downloadReadout({ fps: 2 * 1048576, remainingSeconds: 12 })).toBe("2.0 MB/s · about 12 s left");
  expect(downloadReadout({ fps: 1048576, remainingSeconds: null })).toBe("1.0 MB/s");
  expect(downloadReadout({ fps: 0, remainingSeconds: null })).toBe("waiting for data");
});
