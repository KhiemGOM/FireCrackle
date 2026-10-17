import { useCallback, useEffect, useRef, useState } from "react";
import type { UiAction } from "../lib/actions";
import type { Backend, Flag, SettingInfo, View } from "../lib/api";
import { openSession, readSession, SESSION_STORAGE_KEY, writeSession } from "../lib/sessionRestore";
import {
  PROJECTS_STORAGE_KEY, projectKey, readProjects, recordProject, removeProject, savedFrame, seedFromSession, writeProjects,
  type ProjectEntry,
} from "../lib/projects";
import { createTrailingThrottle } from "../lib/writeThrottle";

/** Actions that change labels: after them the timeline lanes and the flag list must be refreshed. */
const MUTATING = new Set<UiAction["type"]>([
  "clickCell",
  "digit",
  "flushTyped",
  "clear",
  "noFire",
  "skip",
  "undo",
  "acceptSuggestion",
  "fillRange",
  "manualStep",
  "manualBigStep",
]);

export function messageOf(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/** The saved project list; the old single "last video" becomes the first project once. */
function loadProjects(): ProjectEntry[] {
  try {
    // An empty stored list means every project was forgotten, so only seed when no list was ever written.
    if (localStorage.getItem(PROJECTS_STORAGE_KEY) !== null) return readProjects(localStorage);
    return seedFromSession([], readSession(localStorage), Date.now());
  } catch {
    return [];
  }
}

export interface WorkspaceState {
  videoPath?: string;
  /** One project per imported video, most recently opened first. */
  projects: ProjectEntry[];
  /** Forget a project; its video and labels stay on disk. */
  forgetProject: (videoPath: string) => void;
  view: View | null;
  flags: Flag[];
  settings: SettingInfo[];
  error: string | null;
  /** Increments whenever labels changed. */
  version: number;
  opening: boolean;
  saveStatus: string;
  save: () => Promise<void>;
  transferLabels: (kind: "import" | "export") => Promise<void>;
  transferring: boolean;
  applyAutomation: (id:number) => Promise<void>;
  /** True while an action is in flight (playback skips ticks instead of queueing them). */
  busy: React.MutableRefObject<boolean>;
  /** True when the video opened. Without a frame, a known project resumes where it was left. */
  open: (path: string, frame?: number) => Promise<boolean>;
  act: (a: UiAction) => Promise<void>;
  setSetting: (key: string, value: number) => Promise<string | null>;
  clearError: () => void;
}

export function useWorkspace(backend: Backend | null): WorkspaceState {
  const [view, setView] = useState<View | null>(null);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [settings, setSettings] = useState<SettingInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [opening, setOpening] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [projects, setProjects] = useState<ProjectEntry[]>(loadProjects);
  const projectsRef = useRef(projects);
  // The list is kept up to date in memory at every step but written at most about once a second: a step every frame
  // while playing must not rewrite a long list (and re-render the project list) sixty times a second.
  const projectWrite = useRef<ReturnType<typeof createTrailingThrottle> | null>(null);
  if (projectWrite.current === null) {
    projectWrite.current = createTrailingThrottle(() => {
      try {
        writeProjects(localStorage, projectsRef.current);
        setProjects(projectsRef.current);
      } catch (e) {
        setError(`Labels still autosave, but the project list could not be saved: ${messageOf(e)}`);
      }
    }, 1000);
  }
  useEffect(() => () => projectWrite.current?.flush(), []);
  const busy = useRef(false);
  const seenNoFire = useRef(new Set<string>());
  const applyAutomation = useCallback(async (id:number) => {
    if (!backend?.povApply || busy.current) return;
    busy.current=true;
    try {
      const next=await backend.povApply(id);
      setView(next);setVersion(v=>v+1);setError(next.save_error);
    } catch(e) {setError(messageOf(e));throw e;}
    finally {busy.current=false;}
  },[backend]);
  const isOpen = view !== null;
  const videoPath = useRef<string | null>(null);
  const restoredBackend = useRef<Backend | null>(null);
  const [saveStatus, setSaveStatus] = useState("Autosave on");

  const remember = useCallback((v: View) => {
    if (!backend || backend.mock || !videoPath.current) return;
    try {
      writeSession(localStorage, { videoPath: videoPath.current, frame: v.current });
      projectsRef.current = recordProject(projectsRef.current, { videoPath: videoPath.current, frame: v.current, frameCount: v.frame_count, labelled: v.labelled_count }, Date.now());
      projectWrite.current?.call();
      setSaveStatus(v.save_error ? "Save failed" : "Autosaved");
    } catch (e) {
      setSaveStatus("Resume unavailable");
      setError(`Labels still autosave, but the last video and frame could not be remembered: ${messageOf(e)}`);
    }
  }, [backend]);

  const forgetProject = useCallback((path: string) => {
    try {
      const next = removeProject(projectsRef.current, path);
      writeProjects(localStorage, next);
      const session = readSession(localStorage);
      if (session && projectKey(session.videoPath) === projectKey(path)) localStorage.removeItem(SESSION_STORAGE_KEY);
      projectsRef.current = next;
      setProjects(next);
    } catch (e) {
      setError(`Could not update the project list: ${messageOf(e)}`);
    }
  }, []);

  const open = useCallback(
    async (path: string, frame?: number): Promise<boolean> => {
      if (!backend) return false;
      if (busy.current) return false;
      busy.current = true;
      setOpening(true);
      try {
        if (videoPath.current) {
          const previous = await backend.act({ type: "flushTyped" });
          if (previous.save_error) throw new Error(previous.save_error);
        }
        const v = await openSession(backend, { videoPath: path, frame: frame ?? savedFrame(projectsRef.current, path) });
        videoPath.current = path;
        setView(v);
        setError(null);
        remember(v);
        setSettings(await backend.settingsDescribe());
        setVersion((x) => x + 1);
        return true;
      } catch (e) {
        setError(messageOf(e));
        return false;
      } finally {
        busy.current = false;
        setOpening(false);
      }
    },
    [backend, remember],
  );

  // The ref survives StrictMode's effect replay, so a video is restored once.
  useEffect(() => {
    if (!backend || backend.mock || restoredBackend.current === backend) return;
    restoredBackend.current = backend;
    setOpening(true);
    void (async () => {
      try {
        const launchPath = await backend.startupVideo?.();
        const remembered = readSession(localStorage);
        if (launchPath) await open(launchPath);
        else if (remembered) await open(remembered.videoPath, remembered.frame);
      } catch (e) {
        setError(`Could not restore the last session: ${messageOf(e)}. You can open a video manually.`);
      } finally {
        setOpening(false);
      }
    })();
  }, [backend, open]);

  const act = useCallback(
    async (a: UiAction) => {
      if (!backend || busy.current) return;
      busy.current = true;
      try {
        const v = await backend.act(a);
        setView(v);
        remember(v);
        if (MUTATING.has(a.type)) setVersion((x) => x + 1);
      } catch (e) {
        const m = messageOf(e);
        if (!m.includes("NoSuggestion")) setError(m); // pressing Enter with nothing to accept is not an error
      } finally {
        busy.current = false;
      }
    },
    [backend, remember],
  );

  const save = useCallback(async () => {
    if (!backend || backend.mock || busy.current || !videoPath.current) return;
    busy.current = true;
    setSaveStatus("Saving…");
    try {
      // Flush a half-typed row and retry any label writes that failed earlier.
      const v = await backend.act({ type: "flushTyped" });
      setView(v);
      setVersion((x) => x + 1);
      remember(v);
      if (v.save_error) setError(v.save_error);
    } catch (e) {
      setSaveStatus("Save failed");
      setError(messageOf(e));
    } finally {
      busy.current = false;
    }
  }, [backend, remember]);

  const transferLabels = useCallback(async (kind: "import" | "export") => {
    if (!backend?.transferLabels || busy.current || !videoPath.current) return;
    busy.current = true;
    setTransferring(true);
    try {
      const v = await backend.transferLabels(kind);
      if (!v) return;
      setView(v);
      setVersion((x) => x + 1);
      remember(v);
      setError(v.save_error);
      if (!v.save_error) setSaveStatus(kind === "export" ? "Labels exported" : "Labels imported · autosaved");
    } catch (e) {
      setError(messageOf(e));
    } finally {
      busy.current = false;
      setTransferring(false);
    }
  }, [backend, remember]);

  useEffect(() => {
    if (!view?.save_error) return;
    const timer = setInterval(() => void save(), 5000);
    return () => clearInterval(timer);
  }, [view?.save_error, save]);

  useEffect(() => {
    if (!backend || !isOpen) return;
    let cancelled = false;
    backend
      .flags()
      .then((f) => !cancelled && setFlags(f))
      .catch((e) => !cancelled && setError(messageOf(e)));
    return () => {
      cancelled = true;
    };
  }, [backend, isOpen, version]);

  const setSetting = useCallback(
    async (key: string, value: number): Promise<string | null> => {
      if (!backend) return "no backend";
      try {
        setView(await backend.settingsSet(key, value));
        setSettings(await backend.settingsDescribe());
        setVersion((x) => x + 1); // phase thresholds change the flags and the chart
        return null;
      } catch (e) {
        return messageOf(e);
      }
    },
    [backend],
  );

  // Native completion saves even with Auto closed; refresh the visible workspace once per job.
  useEffect(() => {
    if (!backend?.noFireStatus || !isOpen) return;
    let live = true, checking = false;
    const refresh = async () => {
      if (checking) return;
      checking = true;
      try {
        const status = await backend.noFireStatus!();
        if (!live || !status || status.video_path !== videoPath.current || !["done","failed"].includes(status.state)) return;
        const key = status.video_path + ":" + status.id;
        if (seenNoFire.current.has(key) || busy.current) return;
        busy.current = true;
        try {
          const next = await backend.view();
          if (!live || videoPath.current !== status.video_path) return;
          seenNoFire.current.add(key);
          setView(next); setVersion(v=>v+1); remember(next);
          setError(status.error ?? next.save_error);
        } finally { busy.current = false; }
      } catch (e) { if (live) setError(messageOf(e)); }
      finally { checking = false; }
    };
    void refresh();
    const timer = setInterval(()=>void refresh(),1000);
    return () => {live=false;clearInterval(timer);};
  },[backend,isOpen,remember]);

  return { view, projects, forgetProject, videoPath: videoPath.current ?? undefined, flags, settings, error, version, opening, saveStatus, save, transferLabels, transferring, applyAutomation, busy, open, act, setSetting, clearError: () => setError(null) };
}
