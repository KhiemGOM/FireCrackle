import { useEffect, useRef, useState } from "react";
import type { PovStatus } from "../lib/api";
import { ScanSpeedTracker, scanRemainingTime, type ScanSpeed } from "../lib/scanSpeed";

export function ScanProgressStats({ status }: { status: PovStatus }) {
  const tracker = useRef(new ScanSpeedTracker());
  const [speed, setSpeed] = useState<ScanSpeed | null>(null);
  useEffect(() => {
    setSpeed(tracker.current.update(status, performance.now()));
  }, [status]);
  return <span className="dim" aria-label="Scan speed and estimated time remaining"
    title="Measured from recent scan progress. Remaining time updates as speed changes.">
    {speed === null ? "Measuring speed… · ETA pending" :
      `${speed.fps.toFixed(1)} fps · ${speed.remainingSeconds === null ? "Waiting for progress" : `About ${scanRemainingTime(speed.remainingSeconds)} remaining`}`}
  </span>;
}
