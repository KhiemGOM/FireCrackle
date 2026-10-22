// Browser-storage helpers for small optional UI memory (view zoom, mask positions, review ranges, ...). Reading never
// throws and writing reports failure, so private windows or a full quota only lose the memory, never the app.
import { projectKey } from "./projects";

type Reader = Pick<Storage, "getItem">;
type Writer = Pick<Storage, "setItem">;

export function readJson(key: string, storage?: Reader): unknown {
  try { return JSON.parse((storage ?? localStorage).getItem(key) ?? "null"); } catch { return null; }
}

/** False when nothing could be saved. */
export function writeJson(key: string, value: unknown, storage?: Writer): boolean {
  try { (storage ?? localStorage).setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

/** `firecrackle.<kind>:<video>[:<suffix>]`, the same for one video whatever its slash style or Windows letter case. */
export function videoStorageKey(kind: string, video: string, suffix?: string): string {
  return `firecrackle.${kind}:${encodeURIComponent(projectKey(video))}${suffix ? `:${suffix}` : ""}`;
}

/** The saved value for this video; memory saved before keys were normalised (raw path) is still read. */
export function readVideoJson(kind: string, video: string | undefined, storage?: Reader, suffix?: string): unknown {
  if (!video) return null;
  const current = readJson(videoStorageKey(kind, video, suffix), storage);
  if (current !== null) return current;
  return readJson(`firecrackle.${kind}:${encodeURIComponent(video)}${suffix ? `:${suffix}` : ""}`, storage);
}
