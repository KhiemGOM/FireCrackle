import type { Backend, View } from "./api";
import { clampFrame } from "./frameMath";

export const SESSION_STORAGE_KEY = "firecrackle.session.v1";
export interface SavedSession {
  videoPath: string;
  frame: number;
}

export function readSession(storage: Pick<Storage, "getItem">): SavedSession | null {
  const raw = storage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SavedSession> | null;
    if (!value || typeof value.videoPath !== "string" || !value.videoPath.trim() ||
      !Number.isSafeInteger(value.frame) || (value.frame as number) < 0) return null;
    return { videoPath: value.videoPath, frame: value.frame as number };
  } catch {
    return null;
  }
}

export function writeSession(storage: Pick<Storage, "setItem">, session: SavedSession) {
  storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

/** Reopen the existing project and then return to its saved frame. */
export async function openSession(backend: Backend, session: SavedSession): Promise<View> {
  const opened = await backend.openVideo(session.videoPath);
  const frame = clampFrame(session.frame, opened.frame_count);
  return frame === opened.current ? opened : backend.act({ type: "goTo", frame });
}
