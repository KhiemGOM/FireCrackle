/** `HH:MM:SS|FF`: the time of a frame, with FF the frame number inside that second (00 .. fps-1). */
export function formatTimecode(seconds: number, fps: number): string {
  // fps is a whole-video average, which dropped frames pull below the capture rate; rounding it down would give
  // two neighbouring frames the same FF, so round up (the epsilon keeps an exact 60 at 60).
  const rate = Number.isFinite(fps) && fps >= 1 ? Math.ceil(fps - 1e-6) : 1;
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
