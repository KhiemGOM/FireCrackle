import { useEffect, useState } from "react";
import type { FrameBuffer } from "../lib/frameBuffer";
import { formatReadout, readoutLevel, type PlaybackStats } from "../lib/playbackStats";
import "./PlaybackReadout.css";

interface Props {
  stats: PlaybackStats;
  buffer: FrameBuffer | null;
  fps: number;
  current: number;
  dir: -1 | 0 | 1;
}

const HELP =
  "Playback over the last 5 seconds: frames shown per second (of the video's rate), frames dropped (replaced before " +
  "they were shown, or jumped over), frames that took longer than one frame time to appear, the 95th-percentile time " +
  "from the playhead reaching a frame to its picture being shown, and how many frames are buffered ahead of the playhead.";

/** One line in the status bar while frames are being shown: red when frames are lost, so a stutter is visible, not felt. */
export function PlaybackReadout({ stats, buffer, fps, current, dir }: Props) {
  const [, refresh] = useState(0);
  useEffect(() => {
    const id = setInterval(() => refresh((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);
  const summary = stats.summary(performance.now(), fps);
  const level = readoutLevel(summary, fps);
  if (level === "idle") return null;
  return (
    <span className={`playback-readout ${level}`} title={HELP}>
      {formatReadout(summary, buffer?.aheadCount(current, dir) ?? 0, fps)}
    </span>
  );
}
