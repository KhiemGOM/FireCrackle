// Plumbing shared by every proof export (comparison masks and frame comparisons): file names, the save dialog,
// handing picture bytes to the desktop backend, and the browser download fallback.
import type { ProofFormat } from "./comparisonProof";
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
