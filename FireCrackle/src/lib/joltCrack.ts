// Running Splosh's JoltCracker from inside FireCrackle: what to show while it works, and when to import its result.
import { projectName } from "./projects";
import { sameVideo } from "./scanState";

export interface JoltCrackStatus {
  id: number;
  video_path: string;
  state: "preparing" | "running" | "done" | "failed" | "cancelled";
  message: string;
  percent: number | null;
  version: string | null;
  /** JoltCracker's JSON result, once it has finished. */
  result: string | null;
  error: string | null;
}

export function crackLabel(s: JoltCrackStatus): string {
  const name = s.version ? `JoltCracker v${s.version}` : "JoltCracker";
  switch (s.state) {
    case "preparing": return s.message;
    case "running": return [name, s.message, s.percent === null ? "" : `${s.percent}%`].filter(Boolean).join(" · ");
    case "done": return `${name} finished · imported as this video's Jolt clock`;
    case "cancelled": return "JoltCracker stopped";
    case "failed": return s.error ?? "JoltCracker failed";
  }
}

/** The result to import: a finished run of the open video that has not been imported yet. */
export function crackImport(s: JoltCrackStatus | null, videoKey: string | undefined, imported: number | null): { id: number; text: string; name: string } | null {
  if (!s || s.state !== "done" || !s.result || s.id === imported || !sameVideo(s.video_path, videoKey)) return null;
  return { id: s.id, text: s.result, name: `JoltCracker v${s.version ?? "?"} · ${projectName(s.video_path)}${/\.[^./\\]+$/.exec(s.video_path)?.[0] ?? ""}` };
}
