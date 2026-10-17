/** The update check as a plain object (no React), so its scheduling and choices can be tested. The hook only subscribes. */
import {
  type CheckResult, type InstallKind, type LatestRelease, type UpdateSettings,
  isDue, isProjectUrl, performCheck, readUpdateSettings, visibleRelease, withSkipped, writeUpdateSettings,
} from "./updateCheck";

export interface UpdateState {
  settings: UpdateSettings;
  result: CheckResult | null;
  checking: boolean;
  /** "Later": the banner stays hidden until the next start. Not saved. */
  laterHidden: boolean;
  kind: InstallKind;
}

export interface UpdateControllerDeps {
  storage: Pick<Storage, "getItem" | "setItem">;
  localVersion: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Open a URL in the browser. */
  openUrl: (url: string) => void | Promise<void>;
  /** How long after start the automatic check waits, so the app can draw first. */
  startDelayMs?: number;
}

/** The release the banner shows now, if any. */
export function bannerRelease(state: UpdateState): LatestRelease | null {
  return state.laterHidden ? null : visibleRelease(state.result, state.settings);
}

export function createUpdateController(deps: UpdateControllerDeps) {
  const now = deps.now ?? Date.now;
  let state: UpdateState = { settings: readUpdateSettings(deps.storage), result: null, checking: false, laterHidden: false, kind: "unknown" };
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;

  const set = (patch: Partial<UpdateState>) => {
    state = { ...state, ...patch };
    listeners.forEach(listener => listener());
  };
  const save = (settings: UpdateSettings) => { writeUpdateSettings(deps.storage, settings); };

  async function run(manual: boolean): Promise<void> {
    if (!manual && !isDue(state.settings, now())) return;
    set({ checking: true });
    const out = await performCheck({ manual, settings: state.settings, nowMs: now(), localVersion: deps.localVersion, fetchImpl: deps.fetchImpl });
    // the user may have changed a setting while the request ran: keep theirs, add the time of this attempt
    let settings: UpdateSettings = { ...state.settings, lastCheckMs: out.settings.lastCheckMs };
    // asking by hand brings a skipped version back
    if (manual && out.result?.state === "available" && settings.skipped === out.result.release.version) settings = { ...settings, skipped: null };
    save(settings);
    set({ settings, result: out.result ?? state.result, checking: false });
  }

  const controller = {
    get state(): UpdateState { return state; },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    /** The automatic check, a moment after the app starts (nothing happens when it is not due or switched off). */
    start(): void {
      if (timer !== null) return;
      timer = setTimeout(() => { timer = null; void controller.check(false); }, deps.startDelayMs ?? 3000);
    },
    stop(): void {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
    /** `manual`: ignore the daily limit and the switch. A request while one is running joins it. */
    check(manual: boolean): Promise<void> {
      if (inFlight) return inFlight;
      inFlight = run(manual).finally(() => { inFlight = null; });
      return inFlight;
    },
    setAuto(auto: boolean): void {
      const settings = { ...state.settings, auto };
      save(settings);
      set({ settings });
    },
    skip(): void {
      if (state.result?.state !== "available") return;
      const settings = withSkipped(state.settings, state.result.release.version);
      save(settings);
      set({ settings });
    },
    later(): void { set({ laterHidden: true }); },
    setKind(kind: InstallKind): void { set({ kind }); },
    /** Only this project's own release URLs are ever opened. */
    open(url: string): void {
      if (!isProjectUrl(url)) return;
      try {
        void Promise.resolve(deps.openUrl(url)).catch(() => {});
      } catch {
        /* no browser: nothing to do */
      }
    },
  };
  return controller;
}

export type UpdateController = ReturnType<typeof createUpdateController>;
