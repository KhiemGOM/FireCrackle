/** Whether a picture that arrived after the playhead moved on should still be shown (docs/PLAN-BUFFER.md).
 *
 *  When frames are fetched or decoded slower than the playhead moves, each one used to be thrown away as soon as the
 *  playhead had passed it, so the screen froze on an old picture and then jumped. A late frame that is newer (in the
 *  direction of play) than the one on screen, and not further behind the playhead than `maxLag` frames, is shown
 *  anyway: the picture follows the playhead at whatever rate it can. */
export interface LateFrame {
  /** The frame that has just arrived. */
  frame: number;
  /** The frame on screen, null when there is none yet. */
  shown: number | null;
  /** Where the playhead is now. */
  current: number;
  dir: -1 | 0 | 1;
  /** The most frames a late picture may lie behind the playhead (0 turns this off). */
  maxLag: number;
}

export function shouldShowLate({ frame, shown, current, dir, maxLag }: LateFrame): boolean {
  if (dir === 0 || !(maxLag >= 1) || !Number.isFinite(frame) || !Number.isFinite(current)) return false;
  const behind = (current - frame) * dir; // how far the playhead is past this frame, in the direction of play
  if (behind < 1 || behind > maxLag) return false;
  return shown === null || !Number.isFinite(shown) || (frame - shown) * dir > 0;
}
