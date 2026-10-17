import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { UpdateBanner } from "./UpdateBanner";
import { UpdatesDialog } from "./UpdatesDialog";
import { parseRelease, type InstallKind, type LatestRelease } from "../lib/updateCheck";

type El = ReactElement<Record<string, any>>;
const BASE = "https://github.com/KhiemGOM/FireCrackle/releases/download/v0.2.3/";
const names = ["windows-x64-Setup.exe", "windows-x64.zip", "linux-x86_64.AppImage", "linux-amd64.deb"];

function release(patch: Record<string, unknown> = {}): LatestRelease {
  return parseRelease({
    tag_name: "v0.2.3", html_url: "https://github.com/KhiemGOM/FireCrackle/releases/tag/v0.2.3", body: "Smooth playback.\nLess lag.", draft: false, prerelease: false,
    assets: names.map((n, i) => ({ name: `FireCrackle-0.2.3-${n}`, size: 1000 + i, browser_download_url: `${BASE}FireCrackle-0.2.3-${n}`, digest: "sha256:" + String(i + 1).repeat(64) })),
    ...patch,
  })!;
}

function all(node: unknown, pred: (e: El) => boolean): El[] {
  if (Array.isArray(node)) return node.flatMap(n => all(n, pred));
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const el = node as El;
  return [...(pred(el) ? [el] : []), ...all(el.props.children, pred)];
}
function text(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return text((node as El).props?.children);
}
const buttons = (root: El) => all(root, e => e.type === "button");
const button = (root: El, label: string) => buttons(root).find(b => b.props["aria-label"] === label || text(b) === label);

function banner(over: Partial<Parameters<typeof UpdateBanner>[0]> = {}) {
  const handlers = { onOpen: vi.fn(), onSkip: vi.fn(), onLater: vi.fn(), onDetails: vi.fn() };
  const root = UpdateBanner({ release: release(), localVersion: "0.2.2", kind: "windows_setup", ...handlers, ...over }) as El;
  return { root, ...handlers };
}

describe("update banner", () => {
  it("says which version is available and which you have", () => {
    const { root } = banner();
    const t = text(root);
    expect(t).toContain("0.2.3");
    expect(t).toContain("0.2.2");
    expect(t.toLowerCase()).toContain("available");
    expect(root.props.role).toBe("status");
  });

  it("offers the one download that fits this install, and opens exactly that file", () => {
    const kinds: Array<[InstallKind, string]> = [
      ["windows_setup", "FireCrackle-0.2.3-windows-x64-Setup.exe"], ["windows_portable", "FireCrackle-0.2.3-windows-x64.zip"],
      ["linux_appimage", "FireCrackle-0.2.3-linux-x86_64.AppImage"], ["linux_deb", "FireCrackle-0.2.3-linux-amd64.deb"],
    ];
    for (const [kind, name] of kinds) {
      const { root, onOpen } = banner({ kind });
      const download = buttons(root).find(b => (b.props["aria-label"] ?? "").startsWith("Download"));
      expect(download, kind).toBeTruthy();
      expect(text(download) + (download!.props["aria-label"] ?? "") + (download!.props.title ?? "")).toContain(name);
      download!.props.onClick();
      expect(onOpen).toHaveBeenCalledExactlyOnceWith(BASE + name);
      expect(buttons(root).filter(b => (b.props["aria-label"] ?? "").startsWith("Download")), kind).toHaveLength(1);
    }
  });

  it("shows the file's checksum so it can be compared", () => {
    const { root } = banner({ kind: "windows_setup" });
    const shown = text(root) + all(root, () => true).map(e => String(e.props.title ?? "")).join(" ");
    expect(shown).toContain("1".repeat(64));
  });

  it("shows no checksum line when GitHub gave none", () => {
    const r = release({ assets: [{ name: "FireCrackle-0.2.3-windows-x64-Setup.exe", size: 1, browser_download_url: BASE + "FireCrackle-0.2.3-windows-x64-Setup.exe" }] });
    const { root } = banner({ release: r, kind: "windows_setup" });
    expect(text(root).toLowerCase()).not.toContain("sha-256");
  });

  it("when it cannot tell which package you run, lists every installer instead of guessing", () => {
    const { root } = banner({ kind: "unknown" });
    const downloads = buttons(root).filter(b => (b.props["aria-label"] ?? "").startsWith("Download"));
    expect(downloads).toHaveLength(4);
  });

  it("explains how to install, starting with closing the app", () => {
    const { root } = banner({ kind: "windows_portable" });
    const steps = all(root, e => e.type === "li").map(text);
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(steps.join(" ").toLowerCase()).toContain("close firecrackle");
    expect(steps.join(" ")).toMatch(/extract/i);
  });

  it("has a release page, what's new, skip and later, each calling its handler", () => {
    const { root, onOpen, onSkip, onLater, onDetails } = banner();
    button(root, "Release page")!.props.onClick();
    expect(onOpen).toHaveBeenLastCalledWith("https://github.com/KhiemGOM/FireCrackle/releases/tag/v0.2.3");
    button(root, "What's new")!.props.onClick();
    expect(onDetails).toHaveBeenCalledOnce();
    button(root, "Skip this version")!.props.onClick();
    expect(onSkip).toHaveBeenCalledOnce();
    button(root, "Later")!.props.onClick();
    expect(onLater).toHaveBeenCalledOnce();
  });

  it("every control is a plain button that does not submit anything", () => {
    for (const b of buttons(banner().root)) expect(b.props.type ?? "button").toBe("button");
  });
});

function dialog(over: Partial<Parameters<typeof UpdatesDialog>[0]> = {}) {
  const handlers = { onAuto: vi.fn(), onCheck: vi.fn(), onOpen: vi.fn(), onClose: vi.fn() };
  const props = { localVersion: "0.2.2", auto: true, lastCheckMs: null as number | null, status: "idle" as const, message: null as string | null, release: null as LatestRelease | null, nowMs: 1_800_000_000_000, ...handlers, ...over };
  return { root: UpdatesDialog(props) as El, ...handlers };
}

describe("updates dialog", () => {
  it("shows your version and that nothing was checked yet", () => {
    const t = text(dialog().root);
    expect(t).toContain("0.2.2");
    expect(t.toLowerCase()).toContain("never checked");
  });

  it("shows when it last checked", () => {
    expect(text(dialog({ lastCheckMs: 1_799_999_000_000 }).root)).toContain("Last checked");
  });

  it("has the automatic-check switch, reflecting the setting and reporting changes", () => {
    const { root, onAuto } = dialog({ auto: true });
    const box = all(root, e => e.type === "input" && e.props.type === "checkbox")[0];
    expect(box.props["aria-label"]).toBe("Check for updates automatically");
    expect(box.props.checked).toBe(true);
    box.props.onChange({ target: { checked: false } });
    expect(onAuto).toHaveBeenCalledExactlyOnceWith(false);
    expect(all(dialog({ auto: false }).root, e => e.type === "input")[0].props.checked).toBe(false);
  });

  it("explains in one line what a check sends and that it can be turned off", () => {
    const t = text(dialog().root).toLowerCase();
    expect(t).toContain("github");
    expect(t).toContain("once a day");
  });

  it("checks on request, and not while a check is running", () => {
    const idle = dialog();
    button(idle.root, "Check now")!.props.onClick();
    expect(idle.onCheck).toHaveBeenCalledOnce();
    const busy = dialog({ status: "checking" });
    expect(button(busy.root, "Check now")!.props.disabled).toBe(true);
    expect(text(busy.root).toLowerCase()).toContain("checking");
  });

  it("says you are up to date", () => {
    expect(text(dialog({ status: "current" }).root).toLowerCase()).toContain("up to date");
  });

  it("shows a failed check as an alert with its reason, without alarming wording", () => {
    const { root } = dialog({ status: "error", message: "Could not reach GitHub. Are you offline?" });
    const alert = all(root, e => e.props.role === "alert")[0];
    expect(text(alert)).toContain("Could not reach GitHub");
  });

  it("when an update exists, shows its notes as plain text and a release page button", () => {
    const { root, onOpen } = dialog({ status: "available", release: release({ body: "<img src=x onerror=alert(1)> Smooth playback." }) });
    const notes = all(root, e => e.type === "pre")[0];
    expect(text(notes)).toContain("<img src=x onerror=alert(1)>"); // shown as text, never as markup
    expect(all(root, e => e.props.dangerouslySetInnerHTML !== undefined)).toHaveLength(0);
    button(root, "Release page")!.props.onClick();
    expect(onOpen).toHaveBeenCalledWith("https://github.com/KhiemGOM/FireCrackle/releases/tag/v0.2.3");
  });

  it("closes from its button, and from Escape", () => {
    const { root, onClose } = dialog();
    button(root, "Close")!.props.onClick();
    expect(onClose).toHaveBeenCalledOnce();
    const outer = all(root, e => typeof e.props.onKeyDown === "function")[0];
    outer.props.onKeyDown({ key: "Escape", stopPropagation() {} });
    expect(onClose).toHaveBeenCalledTimes(2);
    outer.props.onKeyDown({ key: "a", stopPropagation() {} });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("is a labelled modal dialog", () => {
    const d = all(dialog().root, e => e.props.role === "dialog")[0];
    expect(d.props["aria-modal"]).toBe("true");
    expect(String(d.props["aria-label"])).toMatch(/update/i);
  });
});
