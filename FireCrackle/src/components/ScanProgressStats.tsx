import { useEffect, useRef, useState } from "react";
import { ScanSpeedTracker, scanRemainingTime, type ScanProgress, type ScanSpeed } from "../lib/scanSpeed";

/** Speed and time left for any frame-by-frame CV job; pass its status through `povScanProgress`/`guiScanProgress`. */
export function ScanProgressStats({ progress }: { progress: ScanProgress }) {
  const tracker = useRef(new ScanSpeedTracker());
  const [speed, setSpeed] = useState<ScanSpeed | null>(null);
  useEffect(() => {
    setSpeed(tracker.current.update(progress, performance.now()));
  }, [progress.identity, progress.running, progress.processed, progress.total]);
  return <span className="dim" aria-label="Scan speed and estimated time remaining"
    title="Measured from recent scan progress. Remaining time updates as speed changes.">
    {speed === null ? "Measuring speed… · ETA pending" :
      `${speed.fps.toFixed(1)} fps · ${speed.remainingSeconds !== null ? `About ${scanRemainingTime(speed.remainingSeconds)} remaining` : speed.fps > 0 ? "Length unknown" : "Waiting for progress"}`}
  </span>;
}
