/** The list of projects. One project is one video; its labels live in the `<video>.firecrackle` folder next to it,
 *  so this list only remembers which videos were imported and where each was left. Removing an entry never touches
 *  those files. */
import type { SavedSession } from "./sessionRestore";

export const PROJECTS_STORAGE_KEY = "firecrackle.projects.v1";
export const MAX_PROJECTS = 200;

export interface ProjectEntry {
  videoPath: string;
  name: string;
  /** last frame the user was on */
  frame: number;
  frameCount: number;
  labelled: number;
  createdAt: number;
  openedAt: number;
}

export interface ProjectProgress {
  videoPath: string;
  frame: number;
  frameCount: number;
  labelled: number;
}

/** Same video, whatever the slash style (and, for Windows paths, the letter case). */
export function projectKey(videoPath: string): string {
  const p = videoPath.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-zA-Z]:\//.test(p) || p.startsWith("//") ? p.toLowerCase() : p;
}

export function projectName(videoPath: string): string {
  const file = videoPath.trim().replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(0, dot) : file;
}

const count = (v: unknown): number => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0);

function limited(list: ProjectEntry[]): ProjectEntry[] {
  return [...list].sort((a, b) => b.openedAt - a.openedAt).slice(0, MAX_PROJECTS);
}

/** Add the video as a project, or update the one it already belongs to; the result is most recently opened first. */
export function recordProject(list: ProjectEntry[], progress: ProjectProgress, now: number): ProjectEntry[] {
  const videoPath = progress.videoPath.trim();
  if (!videoPath) throw new Error("A project needs a video path");
  const key = projectKey(videoPath);
  const old = list.find(p => projectKey(p.videoPath) === key);
  const entry: ProjectEntry = {
    videoPath: old?.videoPath ?? videoPath,
    name: projectName(videoPath),
    frame: count(progress.frame),
    frameCount: count(progress.frameCount),
    labelled: count(progress.labelled),
    createdAt: old?.createdAt ?? now,
    openedAt: now,
  };
  return limited([entry, ...list.filter(p => projectKey(p.videoPath) !== key)]);
}

/** Where the video's project was left, or 0 for a new one. */
export function savedFrame(list: ProjectEntry[], videoPath: string): number {
  const key = projectKey(videoPath);
  return list.find(p => projectKey(p.videoPath) === key)?.frame ?? 0;
}

/** Forget a project (its files stay on disk). */
export function removeProject(list: ProjectEntry[], videoPath: string): ProjectEntry[] {
  const key = projectKey(videoPath);
  return list.filter(p => projectKey(p.videoPath) !== key);
}

/** The old single "last video" becomes the first project, once, when no list exists yet. */
export function seedFromSession(list: ProjectEntry[], session: SavedSession | null, now: number): ProjectEntry[] {
  if (list.length > 0 || !session) return list;
  return recordProject(list, { videoPath: session.videoPath, frame: session.frame, frameCount: 0, labelled: 0 }, now);
}

export function readProjects(storage: Pick<Storage, "getItem">): ProjectEntry[] {
  const raw = storage.getItem(PROJECTS_STORAGE_KEY);
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const valid: ProjectEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const e = item as Partial<ProjectEntry>;
    if (typeof e.videoPath !== "string" || !e.videoPath.trim()) continue;
    valid.push({
      videoPath: e.videoPath,
      name: projectName(e.videoPath),
      frame: count(e.frame),
      frameCount: count(e.frameCount),
      labelled: count(e.labelled),
      createdAt: count(e.createdAt),
      openedAt: count(e.openedAt),
    });
  }
  const seen = new Set<string>();
  return limited(valid).filter(p => {
    const key = projectKey(p.videoPath);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function writeProjects(storage: Pick<Storage, "setItem">, list: ProjectEntry[]) {
  storage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(list));
}
