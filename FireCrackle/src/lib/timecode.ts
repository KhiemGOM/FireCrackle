/** `HH:MM:SS|FF`: the time of a frame, with FF the frame number inside that second (00 .. fps-1). */
export function formatTimecode(seconds: number, fps: number): string {
  const rate = Number.isFinite(fps) && fps >= 1 ? Math.round(fps) : 1;
  const t = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const frames = Math.round(t * rate);
  const whole = Math.floor(frames / rate);
  const ff = frames % rate;
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}|${pad(ff)}`;
}

/**
 * The time of a frame for a video of `durationSeconds`: `MM:SS|FF` with the hour part dropped entirely while the video
 * is under an hour (and the time is too), `HH:MM:SS|FF` otherwise or when the length is unknown.
 */
export function formatTimecodeFor(seconds: number, fps: number, durationSeconds: number): string {
  const full = formatTimecode(seconds, fps);
  return Number.isFinite(durationSeconds) && durationSeconds < 3600 ? full.replace(/^00:/, "") : full;
}
