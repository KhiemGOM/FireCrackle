import type { PovStatus } from "./api";
import type { GuiScanStatus } from "./guiScan";

export interface ScanSpeed { fps: number; remainingSeconds: number | null }
/**
 * What every frame-by-frame CV job reports, whatever its own status type. `identity` changes when it is a
 * different job (new run, video or length), so its speed is measured afresh. A `total` of 0 means unknown.
 */
export interface ScanProgress { identity: string; running: boolean; processed: number; total: number }
type Sample = { at: number; processed: number };

export function povScanProgress(s: PovStatus): ScanProgress {
  return { identity: JSON.stringify([s.id, s.video_path, s.total]), running: s.state === "running", processed: s.processed, total: s.total };
}

export function guiScanProgress(s: GuiScanStatus): ScanProgress {
  return { identity: JSON.stringify(["gui", s.video_path, s.total]), running: s.state === "running", processed: s.processed, total: s.total };
}

/** Recent observed work only: restored checkpoints and paused time are not throughput. */
export class ScanSpeedTracker {
  private identity = "";
  private samples: Sample[] = [];

  update(progress: ScanProgress, now: number): ScanSpeed | null {
    const last = this.samples[this.samples.length - 1];
    if (!progress.running || progress.identity !== this.identity ||
        (last && (now < last.at || progress.processed < last.processed))) {
      this.samples = [];
    }
    this.identity = progress.identity;
    if (!progress.running) return null;
    this.samples.push({ at: now, processed: progress.processed });
    // Retain the sample just before the 15-second boundary as the rate anchor.
    while (this.samples.length > 2 && this.samples[1].at <= now - 15_000) this.samples.shift();
    const first = this.samples[0];
    const elapsed = now - first.at;
    if (elapsed < 2_000) return null;
    const fps = (progress.processed - first.processed) * 1000 / elapsed;
    const known = progress.total > 0;
    return { fps, remainingSeconds: fps > 0 && known ? Math.max(0, progress.total - progress.processed) / fps : null };
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
