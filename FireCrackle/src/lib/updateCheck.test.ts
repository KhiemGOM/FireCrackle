import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import assetNames from "../../release/asset-names.json";
import {
  CHECK_INTERVAL_MS, LATEST_URL, NOTES_LIMIT, UPDATE_STORAGE_KEY, UpdateError,
  checkForUpdate, chooseDownloads, compareVersions, fetchLatestRelease, installSteps, isDue, isNewer,
  isProjectUrl, parseRelease, parseVersion, performCheck, readUpdateSettings, visibleRelease, withSkipped, writeUpdateSettings,
  type InstallKind, type LatestRelease, type UpdateSettings,
} from "./updateCheck";

const BASE = "https://github.com/KhiemGOM/FireCrackle/releases/download/v0.2.3/";
const HASH = "a".repeat(64);

/** What the GitHub API returns for a release (the fields we use). */
function apiRelease(patch: Record<string, unknown> = {}) {
  return {
    tag_name: "v0.2.3",
    name: "FireCrackle v0.2.3",
    html_url: "https://github.com/KhiemGOM/FireCrackle/releases/tag/v0.2.3",
    body: "Smooth playback.",
    draft: false,
    prerelease: false,
    assets: [
      { name: "FireCrackle-0.2.3-windows-x64-Setup.exe", size: 3_300_000, browser_download_url: BASE + "FireCrackle-0.2.3-windows-x64-Setup.exe", digest: "sha256:" + HASH },
      { name: "FireCrackle-0.2.3-windows-x64.zip", size: 4_300_000, browser_download_url: BASE + "FireCrackle-0.2.3-windows-x64.zip", digest: "sha256:" + "b".repeat(64) },
      { name: "FireCrackle-0.2.3-linux-x86_64.AppImage", size: 84_000_000, browser_download_url: BASE + "FireCrackle-0.2.3-linux-x86_64.AppImage", digest: null },
      { name: "FireCrackle-0.2.3-linux-amd64.deb", size: 5_700_000, browser_download_url: BASE + "FireCrackle-0.2.3-linux-amd64.deb", digest: "sha256:" + "c".repeat(64) },
      { name: "SHA256SUMS.txt", size: 200, browser_download_url: BASE + "SHA256SUMS.txt", digest: "sha256:" + "d".repeat(64) },
    ],
    ...patch,
  };
}

function release(): LatestRelease {
  return parseRelease(apiRelease())!;
}

describe("versions", () => {
  it("reads plain, v-prefixed and pre-release versions", () => {
    expect(parseVersion("0.2.10")).toEqual({ major: 0, minor: 2, patch: 10, pre: null });
    expect(parseVersion("v1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, pre: null });
    expect(parseVersion(" 1.0.0-beta.1 ")).toEqual({ major: 1, minor: 0, patch: 0, pre: "beta.1" });
  });

  it("rejects anything that is not major.minor.patch", () => {
    for (const bad of ["", "v", "1.2", "1.2.3.4", "x.y.z", "1.2.x", "-1.2.3", "1.2.3-", "latest", "1..3"]) {
      expect(parseVersion(bad), bad).toBeNull();
    }
  });

  it("compares numbers, not text: 0.2.10 is newer than 0.2.9", () => {
    expect(compareVersions("0.2.10", "0.2.9")).toBeGreaterThan(0);
    expect(compareVersions("0.2.9", "0.2.10")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
    expect(compareVersions("v0.2.1", "0.2.1")).toBe(0);
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
  });

  it("puts a pre-release before its release", () => {
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0-rc.2")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.10")).toBeLessThan(0);
  });

  it("cannot compare what it cannot read", () => {
    expect(compareVersions("nope", "1.0.0")).toBeNull();
    expect(compareVersions("1.0.0", "")).toBeNull();
  });

  it("offers only a newer, final version", () => {
    expect(isNewer("0.2.3", "0.2.2")).toBe(true);
    expect(isNewer("0.2.2", "0.2.2")).toBe(false);
    expect(isNewer("0.2.1", "0.2.2")).toBe(false);
    expect(isNewer("0.3.0-beta.1", "0.2.2")).toBe(false); // a pre-release is never offered
    expect(isNewer("garbage", "0.2.2")).toBe(false);
    expect(isNewer("0.2.3", "garbage")).toBe(false);
    expect(isNewer("1.0.0", "1.0.0-rc.1")).toBe(true); // a final release beats the pre-release you run
  });
});

describe("which URLs may be opened", () => {
  it("allows only this project's GitHub release URLs over https", () => {
    expect(isProjectUrl("https://github.com/KhiemGOM/FireCrackle/releases/tag/v0.2.3")).toBe(true);
    expect(isProjectUrl(BASE + "x.zip")).toBe(true);
  });

  it("refuses everything else", () => {
    for (const bad of [
      "http://github.com/KhiemGOM/FireCrackle/releases/tag/v1", "https://github.com/KhiemGOM/FireCrackle", "https://github.com/KhiemGOM/FireCrackleEvil/releases/x",
      "https://github.com.evil.example/KhiemGOM/FireCrackle/releases/x", "https://evil.example/https://github.com/KhiemGOM/FireCrackle/releases/x",
      "https://github.com/KhiemGOM/FireCrackle/../Evil/releases/x", "javascript:alert(1)", "file:///C:/x.exe", "", "https://user@github.com/KhiemGOM/FireCrackle/releases/x",
      "https://github.com/khiemgom/firecrackle/releases/x",
    ]) expect(isProjectUrl(bad), bad).toBe(false);
  });
});

describe("reading a release", () => {
  it("reads a real-shaped release", () => {
    const r = release();
    expect(r.version).toBe("0.2.3");
    expect(r.tag).toBe("v0.2.3");
    expect(r.pageUrl).toBe("https://github.com/KhiemGOM/FireCrackle/releases/tag/v0.2.3");
    expect(r.notes).toBe("Smooth playback.");
    expect(r.assets).toHaveLength(5);
    expect(r.assets[0]).toEqual({ name: "FireCrackle-0.2.3-windows-x64-Setup.exe", url: BASE + "FireCrackle-0.2.3-windows-x64-Setup.exe", size: 3_300_000, sha256: HASH });
  });

  it("ignores drafts, pre-releases and releases it cannot read", () => {
    expect(parseRelease(apiRelease({ draft: true }))).toBeNull();
    expect(parseRelease(apiRelease({ prerelease: true }))).toBeNull();
    expect(parseRelease(apiRelease({ tag_name: "nightly" }))).toBeNull();
    expect(parseRelease(apiRelease({ tag_name: undefined }))).toBeNull();
    for (const junk of [null, undefined, 7, "x", [], {}]) expect(parseRelease(junk)).toBeNull();
  });

  it("drops assets whose download URL is not this project's, and malformed assets", () => {
    const r = parseRelease(apiRelease({ assets: [
      { name: "ok.zip", size: 1, browser_download_url: BASE + "ok.zip" },
      { name: "evil.exe", size: 1, browser_download_url: "https://evil.example/evil.exe" },
      { name: 5, size: 1, browser_download_url: BASE + "x" },
      null, "text", { name: "no-url.zip" },
    ] }))!;
    expect(r.assets.map(a => a.name)).toEqual(["ok.zip"]);
  });

  it("replaces a page URL that is not this project's with the release page it should be", () => {
    const r = parseRelease(apiRelease({ html_url: "https://evil.example/phish" }))!;
    expect(r.pageUrl).toBe("https://github.com/KhiemGOM/FireCrackle/releases/tag/v0.2.3");
  });

  it("keeps a checksum only when it is a real sha256, lower-cased", () => {
    const r = parseRelease(apiRelease({ assets: [
      { name: "a", size: 1, browser_download_url: BASE + "a", digest: "sha256:" + "A".repeat(64) },
      { name: "b", size: 1, browser_download_url: BASE + "b", digest: "sha256:123" },
      { name: "c", size: 1, browser_download_url: BASE + "c", digest: "md5:" + "a".repeat(32) },
      { name: "d", size: 1, browser_download_url: BASE + "d" },
      { name: "e", size: 1, browser_download_url: BASE + "e", digest: 12 },
    ] }))!;
    expect(r.assets.map(a => a.sha256)).toEqual(["a".repeat(64), null, null, null, null]);
  });

  it("copes with a missing body and with sizes that are not numbers, and cuts huge notes", () => {
    expect(parseRelease(apiRelease({ body: null }))!.notes).toBe("");
    expect(parseRelease(apiRelease({ assets: [{ name: "a", size: "big", browser_download_url: BASE + "a" }] }))!.assets[0].size).toBe(0);
    const long = parseRelease(apiRelease({ body: "x".repeat(NOTES_LIMIT * 3) }))!.notes;
    expect(long.length).toBeLessThanOrEqual(NOTES_LIMIT + 1);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("which download for which install", () => {
  const kinds: Array<[InstallKind, string]> = [
    ["windows_setup", "FireCrackle-0.2.3-windows-x64-Setup.exe"],
    ["windows_portable", "FireCrackle-0.2.3-windows-x64.zip"],
    ["linux_appimage", "FireCrackle-0.2.3-linux-x86_64.AppImage"],
    ["linux_deb", "FireCrackle-0.2.3-linux-amd64.deb"],
  ];

  it("picks exactly the package the user runs", () => {
    for (const [kind, name] of kinds) {
      const d = chooseDownloads(release(), kind);
      expect(d.primary?.name, kind).toBe(name);
      expect(d.others.map(a => a.name), kind).not.toContain(name);
    }
  });

  it("uses the same names the publisher checks (release/asset-names.json)", () => {
    const expected = Object.values(assetNames).map(t => t.replace("{version}", "0.2.3")).sort();
    expect(expected).toEqual(kinds.map(([, n]) => n).sort());
    expect(Object.keys(assetNames).sort()).toEqual(["linuxAppImage", "linuxDeb", "windowsPortable", "windowsSetup"]);
  });

  it("when it cannot tell, offers every installer and picks none", () => {
    const d = chooseDownloads(release(), "unknown");
    expect(d.primary).toBeNull();
    expect(d.others.map(a => a.name).sort()).toEqual(kinds.map(([, n]) => n).sort());
  });

  it("never offers the checksum or notes files as an installer", () => {
    for (const kind of ["unknown", "windows_setup"] as const) {
      const d = chooseDownloads(release(), kind);
      expect([d.primary, ...d.others].filter(Boolean).some(a => /SHA256SUMS/.test(a!.name))).toBe(false);
    }
  });

  it("with the user's package missing from the release, falls back to the other installers", () => {
    const r = parseRelease(apiRelease({ assets: apiRelease().assets.filter(a => !a.name.endsWith(".zip")) }))!;
    const d = chooseDownloads(r, "windows_portable");
    expect(d.primary).toBeNull();
    expect(d.others.map(a => a.name)).toContain("FireCrackle-0.2.3-windows-x64-Setup.exe");
  });

  it("does not match another version's file", () => {
    const r = parseRelease(apiRelease({ assets: [{ name: "FireCrackle-0.1.0-windows-x64.zip", size: 1, browser_download_url: BASE + "FireCrackle-0.1.0-windows-x64.zip" }] }))!;
    expect(chooseDownloads(r, "windows_portable").primary).toBeNull();
  });

  it("says what to do for each package, and always to close the app first", () => {
    for (const [kind] of kinds) {
      const steps = installSteps(kind);
      expect(steps.length, kind).toBeGreaterThanOrEqual(2);
      expect(steps.join(" ").toLowerCase(), kind).toContain("close firecrackle");
    }
    expect(installSteps("unknown").length).toBeGreaterThanOrEqual(1);
    expect(installSteps("windows_portable").join(" ")).toMatch(/extract/i);
    expect(installSteps("windows_setup").join(" ")).toMatch(/setup/i);
    expect(installSteps("linux_deb").join(" ")).toMatch(/\.deb/);
    expect(installSteps("linux_appimage").join(" ")).toMatch(/AppImage/);
  });
});

describe("when to check", () => {
  const settings = (patch: Partial<UpdateSettings> = {}): UpdateSettings => ({ auto: true, lastCheckMs: null, skipped: null, ...patch });
  const now = 1_800_000_000_000;

  it("checks on the first run and then at most once a day", () => {
    expect(isDue(settings(), now)).toBe(true);
    expect(isDue(settings({ lastCheckMs: now - 1000 }), now)).toBe(false);
    expect(isDue(settings({ lastCheckMs: now - CHECK_INTERVAL_MS + 1 }), now)).toBe(false);
    expect(isDue(settings({ lastCheckMs: now - CHECK_INTERVAL_MS }), now)).toBe(true);
  });

  it("never checks by itself when switched off", () => {
    expect(isDue(settings({ auto: false }), now)).toBe(false);
    expect(isDue(settings({ auto: false, lastCheckMs: null }), now)).toBe(false);
  });

  it("treats a last check in the future (the clock went back) as due", () => {
    expect(isDue(settings({ lastCheckMs: now + 5 * CHECK_INTERVAL_MS }), now)).toBe(true);
    expect(isDue(settings({ lastCheckMs: Number.NaN }), now)).toBe(true);
  });
});

describe("saved settings", () => {
  const memory = () => {
    const values = new Map<string, string>();
    return { values, getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } };
  };

  it("defaults to checking automatically", () => {
    expect(readUpdateSettings(memory())).toEqual({ auto: true, lastCheckMs: null, skipped: null });
  });

  it("round-trips", () => {
    const s = memory();
    const saved = { auto: false, lastCheckMs: 123456, skipped: "0.2.3" };
    expect(writeUpdateSettings(s, saved)).toBe(true);
    expect(s.values.has(UPDATE_STORAGE_KEY)).toBe(true);
    expect(readUpdateSettings(s)).toEqual(saved);
  });

  it("repairs corrupt or wrongly typed data instead of failing", () => {
    for (const raw of ["{", "null", "[]", "7", '"x"', '{"auto":"yes","lastCheckMs":"soon","skipped":5}']) {
      expect(readUpdateSettings({ getItem: () => raw }), raw).toEqual({ auto: true, lastCheckMs: null, skipped: null });
    }
    expect(readUpdateSettings({ getItem: () => '{"auto":false}' })).toEqual({ auto: false, lastCheckMs: null, skipped: null });
  });

  it("never throws when storage is blocked or full", () => {
    expect(readUpdateSettings({ getItem: () => { throw new Error("blocked"); } })).toEqual({ auto: true, lastCheckMs: null, skipped: null });
    expect(writeUpdateSettings({ setItem: () => { throw new Error("full"); } }, { auto: true, lastCheckMs: 1, skipped: null })).toBe(false);
  });
});

function fakeResponse(body: unknown, init: { status?: number; url?: string; contentLength?: string; raw?: string } = {}) {
  const text = init.raw ?? JSON.stringify(body);
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    url: init.url ?? LATEST_URL,
    headers: { get: (name: string) => (name.toLowerCase() === "content-length" ? init.contentLength ?? null : null) },
    text: async () => text,
  } as unknown as Response;
}

describe("fetching the latest release", () => {
  it("asks the GitHub API for the latest release, without credentials", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => { calls.push([url, init]); return fakeResponse(apiRelease()); }) as unknown as typeof fetch;
    const r = await fetchLatestRelease(fetchImpl);
    expect(r.version).toBe("0.2.3");
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("https://api.github.com/repos/KhiemGOM/FireCrackle/releases/latest");
    expect(calls[0][1]?.credentials).toBe("omit");
    expect((calls[0][1]?.headers as Record<string, string>).Accept).toBe("application/vnd.github+json");
  });

  const failsWith = async (fetchImpl: typeof fetch, reason: string) => {
    await expect(fetchLatestRelease(fetchImpl)).rejects.toMatchObject({ name: "UpdateError", reason });
  };

  it("reports being offline", async () => {
    await failsWith((async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch, "offline");
  });

  it("tells a rate limit from other errors", async () => {
    await failsWith((async () => fakeResponse({}, { status: 403 })) as unknown as typeof fetch, "rate_limited");
    await failsWith((async () => fakeResponse({}, { status: 429 })) as unknown as typeof fetch, "rate_limited");
    await failsWith((async () => fakeResponse({}, { status: 404 })) as unknown as typeof fetch, "not_found");
    await failsWith((async () => fakeResponse({}, { status: 500 })) as unknown as typeof fetch, "http");
  });

  it("rejects an answer that is not JSON or not a release", async () => {
    await failsWith((async () => fakeResponse(null, { raw: "<html>proxy login</html>" })) as unknown as typeof fetch, "bad_response");
    await failsWith((async () => fakeResponse({ message: "weird" })) as unknown as typeof fetch, "bad_response");
    await failsWith((async () => fakeResponse(apiRelease({ prerelease: true }))) as unknown as typeof fetch, "bad_response");
  });

  it("refuses an answer that came from somewhere else (a redirect)", async () => {
    await failsWith((async () => fakeResponse(apiRelease(), { url: "https://evil.example/releases/latest" })) as unknown as typeof fetch, "redirect");
    await failsWith((async () => fakeResponse(apiRelease(), { url: "https://api.github.com.evil.example/x" })) as unknown as typeof fetch, "redirect");
  });

  it("refuses a huge answer, whether it says so or not", async () => {
    await failsWith((async () => fakeResponse(apiRelease(), { contentLength: "5000000" })) as unknown as typeof fetch, "too_large");
    await failsWith((async () => fakeResponse(null, { raw: "x".repeat(1_100_000) })) as unknown as typeof fetch, "too_large");
  });

  it("is an UpdateError with a reason and a readable message", async () => {
    try { await fetchLatestRelease((async () => { throw new TypeError("x"); }) as unknown as typeof fetch); } catch (e) {
      expect(e).toBeInstanceOf(UpdateError);
      expect((e as UpdateError).message.length).toBeGreaterThan(5);
    }
  });
});

describe("checking for an update", () => {
  const ok = (body: unknown) => (async () => fakeResponse(body)) as unknown as typeof fetch;

  it("finds a newer release", async () => {
    const r = await checkForUpdate({ fetchImpl: ok(apiRelease()), localVersion: "0.2.2" });
    expect(r.state).toBe("available");
    if (r.state === "available") expect(r.release.version).toBe("0.2.3");
  });

  it("says you are up to date when the latest is yours or older", async () => {
    expect(await checkForUpdate({ fetchImpl: ok(apiRelease()), localVersion: "0.2.3" })).toEqual({ state: "current", latest: "0.2.3" });
    expect(await checkForUpdate({ fetchImpl: ok(apiRelease()), localVersion: "0.9.0" })).toEqual({ state: "current", latest: "0.2.3" });
  });

  it("never throws: failures come back as an error result with a message", async () => {
    const r = await checkForUpdate({ fetchImpl: (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch, localVersion: "0.2.2" });
    expect(r).toMatchObject({ state: "error", reason: "offline" });
    expect((r as { message: string }).message.length).toBeGreaterThan(5);
    const bad = await checkForUpdate({ fetchImpl: ok(apiRelease()), localVersion: "not a version" });
    expect(bad).toMatchObject({ state: "error" });
  });

  describe("timeout", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it("gives up on a request that never answers", async () => {
      const hang = ((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as unknown as typeof fetch;
      const pending = checkForUpdate({ fetchImpl: hang, localVersion: "0.2.2", timeoutMs: 5000 });
      await vi.advanceTimersByTimeAsync(5001);
      expect(await pending).toMatchObject({ state: "error", reason: "timeout" });
    });
  });
});

describe("the scheduled and manual check", () => {
  const now = 1_800_000_000_000;
  const base: UpdateSettings = { auto: true, lastCheckMs: null, skipped: null };
  const counting = () => { const calls: string[] = []; return { calls, fetchImpl: (async (u: string) => { calls.push(u); return fakeResponse(apiRelease()); }) as unknown as typeof fetch }; };

  it("an automatic check that is not due makes no request", async () => {
    const f = counting();
    const out = await performCheck({ manual: false, settings: { ...base, lastCheckMs: now - 1000 }, nowMs: now, localVersion: "0.2.2", fetchImpl: f.fetchImpl });
    expect(out.result).toBeNull();
    expect(f.calls).toHaveLength(0);
    expect(out.settings.lastCheckMs).toBe(now - 1000);
  });

  it("an automatic check does nothing when the switch is off", async () => {
    const f = counting();
    const out = await performCheck({ manual: false, settings: { ...base, auto: false }, nowMs: now, localVersion: "0.2.2", fetchImpl: f.fetchImpl });
    expect(out.result).toBeNull();
    expect(f.calls).toHaveLength(0);
  });

  it("a due automatic check asks once and remembers when", async () => {
    const f = counting();
    const out = await performCheck({ manual: false, settings: base, nowMs: now, localVersion: "0.2.2", fetchImpl: f.fetchImpl });
    expect(out.result?.state).toBe("available");
    expect(f.calls).toHaveLength(1);
    expect(out.settings.lastCheckMs).toBe(now);
  });

  it("a manual check ignores the switch and the daily limit", async () => {
    const f = counting();
    const out = await performCheck({ manual: true, settings: { auto: false, lastCheckMs: now - 5, skipped: null }, nowMs: now, localVersion: "0.2.2", fetchImpl: f.fetchImpl });
    expect(out.result?.state).toBe("available");
    expect(f.calls).toHaveLength(1);
  });

  it("a failed check still counts as an attempt, so a broken network is not hammered", async () => {
    const out = await performCheck({ manual: false, settings: base, nowMs: now, localVersion: "0.2.2", fetchImpl: (async () => { throw new TypeError("x"); }) as unknown as typeof fetch });
    expect(out.result?.state).toBe("error");
    expect(out.settings.lastCheckMs).toBe(now);
  });

  it("keeps the other settings and does not change the input", async () => {
    const input: UpdateSettings = { auto: true, lastCheckMs: null, skipped: "0.2.0" };
    const snapshot = JSON.stringify(input);
    const out = await performCheck({ manual: true, settings: input, nowMs: now, localVersion: "0.2.2", fetchImpl: counting().fetchImpl });
    expect(out.settings.skipped).toBe("0.2.0");
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("hides a skipped version from the banner but not a newer one", () => {
    const r = release();
    const result = { state: "available" as const, release: r };
    expect(visibleRelease(result, { ...base, skipped: "0.2.3" })).toBeNull();
    expect(visibleRelease(result, { ...base, skipped: "0.2.2" })).toBe(r);
    expect(visibleRelease(result, base)).toBe(r);
    expect(visibleRelease({ state: "current", latest: "0.2.3" }, base)).toBeNull();
    expect(visibleRelease(null, base)).toBeNull();
    expect(visibleRelease({ state: "error", reason: "offline", message: "x" }, base)).toBeNull();
  });

  it("skipping remembers the version", () => {
    expect(withSkipped(base, "0.2.3")).toEqual({ ...base, skipped: "0.2.3" });
    expect(base.skipped).toBeNull();
  });
});
