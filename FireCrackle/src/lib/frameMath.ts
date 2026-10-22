// Small numeric helpers every view shares: clamping, and turning a time into a frame of the open video.

export const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

/** The nearest whole frame inside a video of `frameCount` frames (frame 0 when there are none or the input is not a number). */
export function clampFrame(frame: number, frameCount: number): number {
  if (!Number.isFinite(frame)) return 0;
  return clamp(Math.round(frame), 0, Math.max(0, frameCount - 1));
}

/**
 * The frame shown at `time` seconds. `locate` is the backend's lookup over the real presentation timestamps (exact on
 * variable-frame-rate video); without it the frame rate is used. Errors from `locate` are passed on to the caller.
 */
export function frameAtTime(time: number, video: { fps: number; frameCount: number; locate?: (time: number) => Promise<number> }): Promise<number> {
  if (video.locate) return video.locate(time);
  return Promise.resolve(clampFrame(time * video.fps, video.frameCount));
}
