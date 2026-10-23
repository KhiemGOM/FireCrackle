// Plumbing shared by every proof export (comparison masks and frame comparisons): file names, the save dialog,
// handing picture bytes to the desktop backend, and the browser download fallback.
import type { ProofFormat } from "./comparisonProof";
import { inTauri } from "./api";
import { scanRemainingTime } from "./scanSpeed";

export const proofExtension = (format: ProofFormat) => (format === "jpeg" ? "jpg" : format);

/** The bytes of a picture as the Tauri commands take them; `null` stays `null`. */
export async function blobBytes(blob: Blob | null | undefined): Promise<number[] | null> {
  return blob ? Array.from(new Uint8Array(await blob.arrayBuffer())) : null;
}

/** The desktop save dialog for a proof; `null` when the user cancels. */
export async function askSavePath(filename: string, format: ProofFormat): Promise<string | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  return save({ defaultPath: filename, filters: [{ name: format.toUpperCase(), extensions: [proofExtension(format)] }] });
}

/** Browser fallback: download the picture, then release its object URL. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const formatMegabytes = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;

/** Speed and time left for a download, from the same tracker the scans use (its "fps" is bytes per second here). */
export function downloadReadout(speed: { fps: number; remainingSeconds: number | null } | null): string {
  if (!speed) return "measuring speed…";
  if (speed.fps <= 0) return "waiting for data";
  const rate = `${formatMegabytes(speed.fps)}/s`;
  return speed.remainingSeconds === null ? rate : `${rate} · about ${scanRemainingTime(speed.remainingSeconds)} left`;
}

/** Copy a PNG picture to the clipboard only: never open a save dialog or silently download a file. */
export async function copyPicture(proof: Blob | Promise<Blob>): Promise<void> {
  if (inTauri()) {
    const blob = await proof;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("copy_comparison_proof", { png: await blobBytes(blob) });
    return;
  }
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    // Observe render failures even when the browser cannot copy images.
    void Promise.resolve(proof).catch(() => {});
    throw Error("Image clipboard is unavailable. Use the desktop app to copy pictures.");
  }
  // Start the clipboard write in the click handler so rendering retains user activation.
  await navigator.clipboard.write([new ClipboardItem({ "image/png": Promise.resolve(proof) })]);
}

/** Save a PNG picture: the desktop save dialog, or a browser download. False when the user cancels. */
export async function savePicture(png: Blob | Promise<Blob>, filename: string): Promise<boolean> {
  if (!inTauri()) { downloadBlob(await png, filename); return true; }
  const path = await askSavePath(filename, "png");
  if (!path) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("save_comparison_proof", { path, format: "png", png: await blobBytes(await png), base: null });
  return true;
}
