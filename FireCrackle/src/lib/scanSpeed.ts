import type { PovStatus } from "./api";

export interface ScanSpeed { fps: number; remainingSeconds: number | null }
type Sample = { at: number; processed: number };

/** Recent observed work only: restored checkpoints and paused time are not throughput. */
export class ScanSpeedTracker {
  private identity = "";
  private samples: Sample[] = [];

  update(status: PovStatus, now: number): ScanSpeed | null {
    const identity = JSON.stringify([status.id, status.video_path, status.total]);
    const last = this.samples[this.samples.length - 1];
    if (status.state !== "running" || identity !== this.identity ||
        (last && (now < last.at || status.processed < last.processed))) {
      this.samples = [];
    }
    this.identity = identity;
    if (status.state !== "running") return null;
    this.samples.push({ at: now, processed: status.processed });
    // Retain the sample just before the 15-second boundary as the rate anchor.
    while (this.samples.length > 2 && this.samples[1].at <= now - 15_000) this.samples.shift();
    const first = this.samples[0];
    const elapsed = now - first.at;
    if (elapsed < 2_000) return null;
    const fps = (status.processed - first.processed) * 1000 / elapsed;
    return { fps, remainingSeconds: fps > 0 ? Math.max(0, status.total - status.processed) / fps : null };
  }
}

export function scanRemainingTime(seconds: number): string {
  const rounded = Math.max(0, Math.ceil(seconds));
  if (rounded < 60) return `${rounded} s`;
  const minutes = Math.ceil(rounded / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return `${hours} h${rest ? ` ${rest} min` : ""}`;
}
