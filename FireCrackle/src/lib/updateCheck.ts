/** Is a newer FireCrackle out? Asks GitHub's public API for the latest release of this project (at most once a day, and
 *  only while the user leaves automatic checks on), compares versions, and says which download fits this install. It
 *  downloads and installs nothing: the user does that. Everything here is plain functions so it can be tested without a
 *  browser; the hook and components only wire it up. */
import assetNames from "../../release/asset-names.json";

export const REPO = "KhiemGOM/FireCrackle";
export const LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const PROJECT_PATH_PREFIX = `/${REPO}/releases/`;
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const NOTES_LIMIT = 4000;
const MAX_BODY_CHARS = 1_000_000;
export const UPDATE_STORAGE_KEY = "firecrackle.updates.v1";

// ---------------------------------------------------------------- versions

export interface Version {
  major: number;
  minor: number;
  patch: number;
  /** The pre-release part (`beta.1`), or null for a final release. */
  pre: string | null;
}

export function parseVersion(text: string): Version | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?$/.exec(String(text).trim());
  if (!m) return null;
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (![major, minor, patch].every(Number.isSafeInteger)) return null;
  return { major, minor, patch, pre: m[4] ?? null };
}

function comparePre(a: string, b: string): number {
  const x = a.split(".");
  const y = b.split(".");
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === undefined) return -1;
    if (y[i] === undefined) return 1;
    const [nx, ny] = [/^\d+$/.test(x[i]), /^\d+$/.test(y[i])];
    if (nx && ny) {
      const d = Number(x[i]) - Number(y[i]);
      if (d !== 0) return d;
    } else if (nx !== ny) {
      return nx ? -1 : 1; // numbers rank before words
    } else if (x[i] !== y[i]) {
      return x[i] < y[i] ? -1 : 1;
    }
  }
  return 0;
}

/** Negative, zero or positive; null when either side is not a version. A pre-release is older than its release. */
export function compareVersions(a: string, b: string): number | null {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  if (!x || !y) return null;
  for (const key of ["major", "minor", "patch"] as const) {
    if (x[key] !== y[key]) return x[key] - y[key];
  }
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return comparePre(x.pre, y.pre);
}

/** Only a newer, final version is ever offered. */
export function isNewer(remote: string, local: string): boolean {
  const r = parseVersion(remote);
  if (!r || r.pre !== null) return false;
  const c = compareVersions(remote, local);
  return c !== null && c > 0;
}

// -------------------------------------------------------------------- URLs

/** Only this project's own GitHub release pages and files may ever be opened from a release. */
export function isProjectUrl(url: unknown): boolean {
  if (typeof url !== "string") return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.protocol === "https:" && u.hostname === "github.com" && u.port === "" && u.username === "" && u.password === "" &&
    u.pathname.startsWith(PROJECT_PATH_PREFIX);
}

// ---------------------------------------------------------------- releases

export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
  /** Lower-case hex, from GitHub's own digest of the file; null when it did not give one. */
  sha256: string | null;
}

export interface LatestRelease {
  /** `0.2.3` (the tag without its `v`). */
  version: string;
  tag: string;
  pageUrl: string;
  notes: string;
  assets: ReleaseAsset[];
}

function asset(raw: unknown): ReleaseAsset | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.name !== "string" || !isProjectUrl(a.browser_download_url)) return null;
  const digest = typeof a.digest === "string" ? /^sha256:([0-9a-fA-F]{64})$/.exec(a.digest) : null;
  return {
    name: a.name,
    url: a.browser_download_url as string,
    size: typeof a.size === "number" && Number.isFinite(a.size) && a.size >= 0 ? a.size : 0,
    sha256: digest ? digest[1].toLowerCase() : null,
  };
}

/** A usable release from the API's answer, or null (not a release, a draft, a pre-release, an unreadable tag). */
export function parseRelease(json: unknown): LatestRelease | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const r = json as Record<string, unknown>;
  if (r.draft === true || r.prerelease === true || typeof r.tag_name !== "string") return null;
  const v = parseVersion(r.tag_name);
  if (!v || v.pre !== null) return null;
  const tag = r.tag_name.trim();
  const notes = typeof r.body === "string" ? r.body : "";
  return {
    version: `${v.major}.${v.minor}.${v.patch}`,
    tag,
    pageUrl: isProjectUrl(r.html_url) ? (r.html_url as string) : `https://github.com/${REPO}/releases/tag/${encodeURIComponent(tag)}`,
    notes: notes.length > NOTES_LIMIT ? notes.slice(0, NOTES_LIMIT) + "…" : notes,
    assets: (Array.isArray(r.assets) ? r.assets : []).map(asset).filter((a): a is ReleaseAsset => a !== null),
  };
}

// ----------------------------------------------------- which file to offer

/** How this copy of FireCrackle was installed (from the desktop app; see `install_kind` in the Rust core). */
export type InstallKind = "windows_setup" | "windows_portable" | "linux_appimage" | "linux_deb" | "unknown";

const KEY_OF: Record<Exclude<InstallKind, "unknown">, keyof typeof assetNames> = {
  windows_setup: "windowsSetup",
  windows_portable: "windowsPortable",
  linux_appimage: "linuxAppImage",
  linux_deb: "linuxDeb",
};

function nameFor(key: keyof typeof assetNames, version: string): string {
  return assetNames[key].replace("{version}", version);
}

/** The installer that matches this install (primary), and the other installers of the release. When the matching one
 *  is missing or the install is unknown there is no primary: the user chooses. */
export function chooseDownloads(release: LatestRelease, kind: InstallKind): { primary: ReleaseAsset | null; others: ReleaseAsset[] } {
  const installers = (Object.keys(assetNames) as Array<keyof typeof assetNames>)
    .map(key => release.assets.find(a => a.name === nameFor(key, release.version)))
    .filter((a): a is ReleaseAsset => a !== undefined);
  const primary = kind === "unknown" ? null : installers.find(a => a.name === nameFor(KEY_OF[kind], release.version)) ?? null;
  return { primary, others: installers.filter(a => a !== primary) };
}

export function installSteps(kind: InstallKind): string[] {
  switch (kind) {
    case "windows_setup":
      return ["Close FireCrackle.", "Run the downloaded Setup file: it replaces the installed version.", "Open FireCrackle again. Your labels stay beside your videos."];
    case "windows_portable":
      return ["Close FireCrackle.", "Extract the downloaded ZIP (to the same place or a new folder).", "Run FireCrackle.exe from the new folder. Your labels stay beside your videos."];
    case "linux_appimage":
      return ["Close FireCrackle.", "Replace your old AppImage with the downloaded one and make it executable.", "Start it again. Your labels stay beside your videos."];
    case "linux_deb":
      return ["Close FireCrackle.", "Install the downloaded .deb with your package manager (for example: sudo apt install ./the-file.deb).", "Start FireCrackle again. Your labels stay beside your videos."];
    default:
      return ["Close FireCrackle.", "Download the package that matches how you installed it, and install it the way you did the first time."];
  }
}

// ---------------------------------------------------------------- settings

export interface UpdateSettings {
  /** Check by itself, once a day. */
  auto: boolean;
  lastCheckMs: number | null;
  /** A version the user said to stop offering. */
  skipped: string | null;
}

const DEFAULTS: UpdateSettings = { auto: true, lastCheckMs: null, skipped: null };

export function readUpdateSettings(storage: Pick<Storage, "getItem">): UpdateSettings {
  try {
    const raw = storage.getItem(UPDATE_STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const v = JSON.parse(raw) as Record<string, unknown> | null;
    if (!v || typeof v !== "object" || Array.isArray(v)) return { ...DEFAULTS };
    return {
      auto: typeof v.auto === "boolean" ? v.auto : true,
      lastCheckMs: typeof v.lastCheckMs === "number" && Number.isFinite(v.lastCheckMs) ? v.lastCheckMs : null,
      skipped: typeof v.skipped === "string" && v.skipped ? v.skipped : null,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/** False when the settings could not be saved (they then last until the app closes). */
export function writeUpdateSettings(storage: Pick<Storage, "setItem">, settings: UpdateSettings): boolean {
  try {
    storage.setItem(UPDATE_STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

/** Whether the automatic check should run now. */
export function isDue(settings: UpdateSettings, nowMs: number, intervalMs = CHECK_INTERVAL_MS): boolean {
  if (!settings.auto) return false;
  const last = settings.lastCheckMs;
  if (last === null || !Number.isFinite(last) || last > nowMs) return true; // never, unreadable, or the clock went back
  return nowMs - last >= intervalMs;
}

export function withSkipped(settings: UpdateSettings, version: string): UpdateSettings {
  return { ...settings, skipped: version };
}

// ----------------------------------------------------------------- network

export type UpdateErrorReason = "offline" | "rate_limited" | "not_found" | "http" | "bad_response" | "redirect" | "too_large" | "timeout" | "bad_version";

const MESSAGES: Record<UpdateErrorReason, string> = {
  offline: "Could not reach GitHub. Are you offline?",
  rate_limited: "GitHub is limiting requests right now. Try again later.",
  not_found: "No release was found.",
  http: "GitHub answered with an error.",
  bad_response: "GitHub's answer could not be understood.",
  redirect: "The answer came from an unexpected address and was ignored.",
  too_large: "GitHub's answer was unexpectedly large and was ignored.",
  timeout: "GitHub did not answer in time.",
  bad_version: "This copy's version could not be read.",
};

export class UpdateError extends Error {
  readonly reason: UpdateErrorReason;
  constructor(reason: UpdateErrorReason, detail?: string) {
    super(detail ? `${MESSAGES[reason]} (${detail})` : MESSAGES[reason]);
    this.name = "UpdateError";
    this.reason = reason;
  }
}

function isAbort(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { name?: unknown }).name === "AbortError";
}

function isApiUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "api.github.com";
  } catch {
    return false;
  }
}

/** The project's latest published release, or an UpdateError saying why not. */
export async function fetchLatestRelease(fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<LatestRelease> {
  let response: Response;
  try {
    response = await fetchImpl(LATEST_URL, { headers: { Accept: "application/vnd.github+json" }, credentials: "omit", cache: "no-store", signal });
  } catch (e) {
    throw new UpdateError(isAbort(e) ? "timeout" : "offline");
  }
  if (response.url && !isApiUrl(response.url)) throw new UpdateError("redirect");
  if (response.status === 403 || response.status === 429) throw new UpdateError("rate_limited");
  if (response.status === 404) throw new UpdateError("not_found");
  if (!response.ok) throw new UpdateError("http", `HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_BODY_CHARS) throw new UpdateError("too_large");
  let text: string;
  try {
    text = await response.text();
  } catch (e) {
    throw new UpdateError(isAbort(e) ? "timeout" : "offline");
  }
  if (text.length > MAX_BODY_CHARS) throw new UpdateError("too_large");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new UpdateError("bad_response");
  }
  const release = parseRelease(json);
  if (!release) throw new UpdateError("bad_response");
  return release;
}

// ------------------------------------------------------------------ results

export type CheckResult =
  | { state: "available"; release: LatestRelease }
  | { state: "current"; latest: string }
  | { state: "error"; reason: UpdateErrorReason; message: string };

/** Never throws: a failure is an error result. */
export async function checkForUpdate(options: { fetchImpl?: typeof fetch; localVersion: string; timeoutMs?: number }): Promise<CheckResult> {
  if (!parseVersion(options.localVersion)) return { state: "error", reason: "bad_version", message: MESSAGES.bad_version };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  try {
    const release = await fetchLatestRelease(options.fetchImpl ?? fetch, controller.signal);
    return isNewer(release.version, options.localVersion) ? { state: "available", release } : { state: "current", latest: release.version };
  } catch (e) {
    if (e instanceof UpdateError) return { state: "error", reason: e.reason, message: e.message };
    return { state: "error", reason: "offline", message: MESSAGES.offline };
  } finally {
    clearTimeout(timer);
  }
}

/** The scheduled or requested check. Null result: nothing was due. Every attempt, failed or not, is remembered so a broken
 *  network is not asked again before the next day. Does not change the settings it is given. */
export async function performCheck(options: {
  manual: boolean;
  settings: UpdateSettings;
  nowMs: number;
  localVersion: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<{ result: CheckResult | null; settings: UpdateSettings }> {
  if (!options.manual && !isDue(options.settings, options.nowMs)) return { result: null, settings: options.settings };
  const result = await checkForUpdate({ fetchImpl: options.fetchImpl, localVersion: options.localVersion, timeoutMs: options.timeoutMs });
  return { result, settings: { ...options.settings, lastCheckMs: options.nowMs } };
}

/** The release to put in the banner: an available one the user has not skipped. */
export function visibleRelease(result: CheckResult | null, settings: UpdateSettings): LatestRelease | null {
  return result?.state === "available" && settings.skipped !== result.release.version ? result.release : null;
}
