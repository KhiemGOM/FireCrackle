import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
let errors: typeof import("./appErrors");
beforeEach(async () => { vi.resetModules(); errors = await import("./appErrors"); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("shared failure reporting", () => {
  it("reports a failed download once across polls, including after dismissal, but reports a new job", async () => {
    let status = { id: 7, state: "failed", error: "Missing completed video" };
    const backend = errors.withErrorReporting({ async linkStatus() { return status; } });
    for(let i=0;i<47;i++)await backend.linkStatus();
    expect(errors.getFailures()).toMatchObject([{context:"Video download",count:1}]);
    errors.dismissFailure(errors.getFailures()[0].id);
    vi.useFakeTimers();vi.advanceTimersByTime(10_001);
    await backend.linkStatus();expect(errors.getFailures()).toEqual([]);
    status = {...status,id:8};await backend.linkStatus();
    expect(errors.getFailures()).toMatchObject([{count:1}]);
  });
  it("reports a rejected backend operation even when its caller catches it", async () => {
    const original = { mock: false, pickVideo: vi.fn().mockRejectedValue(new Error("GTK chooser failed")) };
    const backend = errors.withErrorReporting(original);
    await expect(backend.pickVideo()).rejects.toThrow("GTK chooser failed");
    expect(backend.mock).toBe(false);
    expect(backend.pickVideo).toBe(backend.pickVideo);
    expect(errors.getFailures()).toMatchObject([{ context: "Open video chooser", message: "GTK chooser failed", count: 1 }]);
  });
  it("keeps receiver binding and returns success unchanged", async () => {
    const source = { value: 42, async read() { return this.value; } };
    expect(await errors.withErrorReporting(source).read()).toBe(42);
    expect(errors.getFailures()).toEqual([]);
  });
  it("reports background failure statuses and autosave errors, without flagging abstention", async () => {
    const backend = errors.withErrorReporting({
      async thumbsStatus() { return { state: "failed", error: "Unrecognized option vsync" }; },
      async view() { return { save_error: "Disk full" }; },
      async guiMask() { return { state: "abstain", error: null }; },
    });
    await backend.thumbsStatus(); await backend.view(); await backend.guiMask();
    expect(errors.getFailures().map(x => x.message)).toEqual(["Unrecognized option vsync", "Disk full"]);
  });
  it("does not treat normal cancellation or missing time guesses as failures", async () => {
    const backend = errors.withErrorReporting({ async pickVideo() { return null; } });
    expect(await backend.pickVideo()).toBeNull();
    errors.reportError("Chooser", new DOMException("Dismissed", "AbortError"));
    errors.reportError("Time guess", "NoSuggestion");
    errors.reportError("Chooser", "Cancelled");
    errors.reportError("Match sprite", new Error("Matching cancelled"));
    expect(errors.getFailures()).toEqual([]);
  });
  it("groups repeated polling failures and briefly silences only the dismissed message", () => {
    vi.useFakeTimers();
    const notify = vi.fn(); const unsubscribe = errors.subscribeFailures(notify);
    errors.reportError("Decode", "FFmpeg failed"); errors.reportError("Project", "FFmpeg failed");
    expect(errors.getFailures()).toHaveLength(1);
    expect(errors.getFailures()[0].count).toBe(2);
    errors.dismissFailure(errors.getFailures()[0].id);
    errors.reportError("Decode", "FFmpeg failed");
    errors.reportError("Save", "Disk full");
    expect(errors.getFailures().map(x => x.message)).toEqual(["Disk full"]);
    vi.advanceTimersByTime(10_001); errors.reportError("Decode", "FFmpeg failed");
    expect(errors.getFailures()).toHaveLength(2);
    expect(notify).toHaveBeenCalledTimes(5); unsubscribe();
  });
  it("captures runtime errors and unhandled rejections and removes listeners on cleanup", () => {
    class RuntimeError extends Event { error = new Error("Render exploded"); message = this.error.message; }
    vi.stubGlobal("ErrorEvent", RuntimeError);
    const target = new EventTarget();
    const cleanup = errors.installGlobalErrorHandlers(target as Window);
    target.dispatchEvent(new RuntimeError("error"));
    target.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: "Download failed" }));
    expect(errors.getFailures().map(x => x.message)).toEqual(["Render exploded", "Download failed"]);
    cleanup(); target.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: "After cleanup" }));
    expect(errors.getFailures()).toHaveLength(2);
    expect(errors.failureDetails(errors.getFailures()[0])).toContain("Render exploded");
  });
  it("blocks background shortcuts while preserving native dialog keys", () => {
    const target = new EventTarget();
    const querySelector = vi.fn().mockReturnValue({});
    Object.assign(target, { document: { querySelector } });
    const cleanup = errors.installGlobalErrorHandlers(target as Window);
    const shortcut = vi.fn(); target.addEventListener("keydown", shortcut);
    const key = new Event("keydown", { cancelable: true }); target.dispatchEvent(key);
    expect(shortcut).not.toHaveBeenCalled(); expect(key.defaultPrevented).toBe(false);
    querySelector.mockReturnValue(null); target.dispatchEvent(new Event("keydown"));
    expect(shortcut).toHaveBeenCalledOnce(); cleanup();
  });
});
