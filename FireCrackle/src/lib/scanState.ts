// One wording for every frame-by-frame scan (first-person, no-fire, GUI detector), whatever each backend calls its states.
import { projectKey } from "./projects";

export type ScanState = "ready" | "running" | "saving" | "done" | "cancelled" | "paused" | "failed" | "error";

const LABELS: Record<ScanState, string> = {
  ready: "Ready",
  running: "Scanning",
  saving: "Saving labels",
  done: "Scan complete",
  cancelled: "Paused · progress saved",
  paused: "Paused · progress saved",
  failed: "Scan failed · progress saved",
  error: "Scan failed · progress saved",
};

/** `warmup` is shown while running before the first frame, for scans that load a model first. */
export function scanStateLabel(state: ScanState, processed: number, opts: { warmup?: string } = {}): string {
  if (state === "running" && processed === 0 && opts.warmup) return opts.warmup;
  return LABELS[state] ?? String(state);
}

/** Whether a job's status is for the open video (same file whatever the slash style or Windows letter case). */
export function sameVideo(statusPath: string | undefined | null, videoPath: string | undefined): boolean {
  return !!statusPath && !!videoPath && projectKey(statusPath) === projectKey(videoPath);
}
