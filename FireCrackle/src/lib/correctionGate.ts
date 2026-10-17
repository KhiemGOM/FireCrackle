import type { VeilMode } from "./veil";
import type { PortalMode } from "./portal";

/**
 * Whether the picture correction (veil undo, portal undo, the Enhance stage) runs for the frame being shown. It runs on a paused picture.
 * While playing it is skipped: a correction costs tens of milliseconds a frame (more with the GUI mask behind the portal
 * undo), far more than a frame time, so every corrected picture was finished after the playhead had moved on and was thrown
 * away; the screen stayed on one picture until playback was paused. Playing shows the plain frames; pausing corrects.
 */
export function correctsNow({ playing, veilMode, portalMode, enhance = false }: { playing: boolean; veilMode: VeilMode; portalMode: PortalMode; enhance?: boolean }): boolean {
  return !playing && (veilMode !== "off" || portalMode !== "off" || enhance);
}
