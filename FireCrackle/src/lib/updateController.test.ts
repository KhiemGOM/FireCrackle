import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UPDATE_STORAGE_KEY, readUpdateSettings } from "./updateCheck";
import { bannerRelease, createUpdateController } from "./updateController";

const BASE = "https://github.com/KhiemGOM/FireCrackle/releases/download/v0.2.3/";
const body = (tag = "v0.2.3") => ({
  tag_name: tag, html_url: `https://github.com/KhiemGOM/FireCrackle/releases/tag/${tag}`, body: "Notes", draft: false, prerelease: false,
  assets: [{ name: "FireCrackle-0.2.3-windows-x64.zip", size: 1, browser_download_url: BASE + "FireCrackle-0.2.3-windows-x64.zip", digest: "sha256:" + "a".repeat(64) }],
});
const response = (json: unknown, status = 200) => ({
  ok: status < 300, status, url: "https://api.github.com/repos/KhiemGOM/FireCrackle/releases/latest",
  headers: { get: () => null }, text: async () => JSON.stringify(json),
}) as unknown as Response;

function memory(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { values, getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } };
}

function setup(over: { storage?: ReturnType<typeof memory>; fetchImpl?: typeof fetch; now?: number; local?: string } = {}) {
  const storage = over.storage ?? memory();
  const calls: string[] = [];
  const fetchImpl = over.fetchImpl ?? ((async (url: string) => { calls.push(url); return response(body()); }) as unknown as typeof fetch);
  const opened: string[] = [];
  let now = over.now ?? 1_800_000_000_000;
  const c = createUpdateController({ storage, localVersion: over.local ?? "0.2.2", fetchImpl, now: () => now, openUrl: url => { opened.push(url); }, startDelayMs: 3000 });
  return { c, storage, calls, opened, setNow: (n: number) => { now = n; } };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("update controller", () => {
  it("starts from the saved settings and shows nothing", () => {
    const { c } = setup({ storage: memory({ [UPDATE_STORAGE_KEY]: JSON.stringify({ auto: false, lastCheckMs: 5, skipped: "0.2.0" }) }) });
    expect(c.state.settings).toEqual({ auto: false, lastCheckMs: 5, skipped: "0.2.0" });
    expect(c.state.result).toBeNull();
    expect(c.state.checking).toBe(false);
    expect(bannerRelease(c.state)).toBeNull();
  });

  it("checks by itself a little after starting, and offers the new version", async () => {
    const { c, calls } = setup();
    c.start();
    expect(calls).toHaveLength(0); // not at once: the app gets to draw first
    await vi.advanceTimersByTimeAsync(3001);
    expect(calls).toHaveLength(1);
    expect(c.state.result?.state).toBe("available");
    expect(bannerRelease(c.state)?.version).toBe("0.2.3");
  });

  it("remembers the check so the next start within a day makes no request", async () => {
    const first = setup();
    first.c.start();
    await vi.advanceTimersByTimeAsync(3001);
    const second = setup({ storage: first.storage, now: 1_800_000_000_000 + 3_600_000 });
    second.c.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(second.calls).toHaveLength(0);
    const third = setup({ storage: first.storage, now: 1_800_000_000_000 + 25 * 3_600_000 });
    third.c.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(third.calls).toHaveLength(1);
  });

  it("makes no automatic request when switched off", async () => {
    const { c, calls } = setup({ storage: memory({ [UPDATE_STORAGE_KEY]: JSON.stringify({ auto: false, lastCheckMs: null, skipped: null }) }) });
    c.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(0);
  });

  it("switching off is saved, and stop() cancels a check that has not started", async () => {
    const { c, calls, storage } = setup();
    c.start();
    c.setAuto(false);
    expect(readUpdateSettings(storage).auto).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(0);
    const other = setup();
    other.c.start();
    other.c.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(other.calls).toHaveLength(0);
  });

  it("a manual check works with the switch off and says it is checking meanwhile", async () => {
    const { c, calls } = setup({ storage: memory({ [UPDATE_STORAGE_KEY]: JSON.stringify({ auto: false, lastCheckMs: null, skipped: null }) }) });
    const pending = c.check(true);
    expect(c.state.checking).toBe(true);
    await pending;
    expect(c.state.checking).toBe(false);
    expect(calls).toHaveLength(1);
    expect(c.state.result?.state).toBe("available");
  });

  it("a second request while one is running joins it instead of asking again", async () => {
    const { c, calls } = setup();
    const a = c.check(true);
    const b = c.check(true);
    await Promise.all([a, b]);
    expect(calls).toHaveLength(1);
  });

  it("saves the time of every attempt, including a failed one", async () => {
    const { c, storage } = setup({ fetchImpl: (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch });
    await c.check(true);
    expect(c.state.result).toMatchObject({ state: "error", reason: "offline" });
    expect(readUpdateSettings(storage).lastCheckMs).toBe(1_800_000_000_000);
    expect(bannerRelease(c.state)).toBeNull(); // a failure never shows a banner
  });

  it("skipping hides that version for good and is saved, but a newer one shows again", async () => {
    const { c, storage } = setup();
    await c.check(true);
    c.skip();
    expect(readUpdateSettings(storage).skipped).toBe("0.2.3");
    expect(bannerRelease(c.state)).toBeNull();
    const later = setup({ storage, fetchImpl: (async () => response(body("v0.2.4"))) as unknown as typeof fetch });
    await later.c.check(true); // (a manual check: the last check was just now, so an automatic one is not due)
    expect(bannerRelease(later.c.state)?.version).toBe("0.2.4");
    expect(readUpdateSettings(storage).skipped).toBe("0.2.3"); // skipping 0.2.3 is not undone by 0.2.4
  });

  it("'Check now' brings back a version that was skipped", async () => {
    const { c, storage } = setup();
    await c.check(true);
    c.skip();
    await c.check(true);
    expect(bannerRelease(c.state)?.version).toBe("0.2.3");
    expect(readUpdateSettings(storage).skipped).toBeNull();
  });

  it("'Later' hides the banner until the next start, without saving anything", async () => {
    const { c, storage } = setup();
    await c.check(true);
    const before = storage.values.get(UPDATE_STORAGE_KEY);
    c.later();
    expect(bannerRelease(c.state)).toBeNull();
    expect(storage.values.get(UPDATE_STORAGE_KEY)).toBe(before);
    const restarted = setup({ storage });
    await restarted.c.check(true);
    expect(bannerRelease(restarted.c.state)?.version).toBe("0.2.3");
  });

  it("opens only this project's release URLs", () => {
    const { c, opened } = setup();
    c.open("https://github.com/KhiemGOM/FireCrackle/releases/tag/v0.2.3");
    c.open(BASE + "FireCrackle-0.2.3-windows-x64.zip");
    c.open("https://evil.example/phish");
    c.open("javascript:alert(1)");
    c.open("");
    expect(opened).toEqual(["https://github.com/KhiemGOM/FireCrackle/releases/tag/v0.2.3", BASE + "FireCrackle-0.2.3-windows-x64.zip"]);
  });

  it("an opener that fails does not break the app", () => {
    const c = createUpdateController({ storage: memory(), localVersion: "0.2.2", fetchImpl: (async () => response(body())) as unknown as typeof fetch, now: () => 1, openUrl: () => { throw new Error("no browser"); } });
    expect(() => c.open("https://github.com/KhiemGOM/FireCrackle/releases/tag/v0.2.3")).not.toThrow();
  });

  it("tells listeners about every change, and stops when they unsubscribe", async () => {
    const { c } = setup();
    const seen = vi.fn();
    const off = c.subscribe(seen);
    await c.check(true);
    expect(seen.mock.calls.length).toBeGreaterThanOrEqual(2); // checking, then the result
    off();
    seen.mockClear();
    c.setAuto(false);
    expect(seen).not.toHaveBeenCalled();
  });

  it("keeps working when storage is blocked", async () => {
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
    const c = createUpdateController({ storage: blocked, localVersion: "0.2.2", fetchImpl: (async () => response(body())) as unknown as typeof fetch, now: () => 7, openUrl: () => {} });
    await expect(c.check(true)).resolves.toBeUndefined();
    expect(c.state.result?.state).toBe("available");
    expect(() => c.setAuto(false)).not.toThrow();
    expect(c.state.settings.auto).toBe(false);
  });

  it("exposes the install kind it is told", () => {
    const { c } = setup();
    expect(c.state.kind).toBe("unknown");
    c.setKind("windows_portable");
    expect(c.state.kind).toBe("windows_portable");
  });
});
