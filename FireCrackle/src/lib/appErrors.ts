/** One failure channel for caught operations, background jobs and runtime errors. */
export interface AppFailure {
  id: number;
  context: string;
  message: string;
  details: string;
  count: number;
  time: number;
}
let failures: readonly AppFailure[] = [];
let sequence = 0;
const listeners = new Set<() => void>();
const dismissed = new Map<string, number>();
const QUIET_MS = 10_000;
export const getFailures = () => failures;
export function subscribeFailures(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function emit() { for (const listener of listeners) listener(); }
export function failureMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  try { return JSON.stringify(error) || String(error); } catch { return String(error); }
}
export function reportError(context: string, error: unknown): void {
  const message = failureMessage(error);
  // User cancellation and an unavailable time guess are expected outcomes.
  if ((error instanceof Error && error.name === "AbortError") || /^(?:matching )?(?:cancelled|canceled)$/i.test(message) || message.includes("NoSuggestion")) return;
  const now = Date.now();
  for (const [key, until] of dismissed) if (until <= now) dismissed.delete(key);
  if (dismissed.has(message)) return;
  const existing = failures.find(item => item.message === message || message.endsWith(`: ${item.message}`));
  if (existing) {
    failures = failures.map(item => item === existing ? { ...item, count: item.count + 1 } : item);
  } else {
    const details = error instanceof Error ? error.stack || message : message;
    failures = [...failures.slice(-19), { id: ++sequence, context, message, details, count: 1, time: now }];
  }
  emit();
}
export function dismissFailure(id: number): void {
  const item = failures.find(item => item.id === id);
  if (item) dismissed.set(item.message, Date.now() + QUIET_MS);
  failures = failures.filter(item => item.id !== id);
  emit();
}
export function failureDetails(item: AppFailure): string {
  return `${item.context}\n${new Date(item.time).toISOString()}\n${item.details}${item.count > 1 ? `\nRepeated ${item.count} times` : ""}`;
}
const operationNames: Record<string, string> = {
  pickVideo: "Open video chooser", openVideo: "Open video", frame: "Decode video frame",
  act: "Change labels or position", view: "Load project", settingsSet: "Save settings",
  transferLabels: "Import or export labels", thumbsStart: "Create thumbnails", thumbsStatus: "Create thumbnails",
  noFireStart: "Start no-fire scan", noFireStatus: "No-fire scan", povStart: "Start first-person scan", povStatus: "First-person scan",
  linkStart: "Start video download", linkStatus: "Video download", guiMask: "Detect GUI mask", guiMaskFrame: "Detect GUI mask", guiMaskPixels: "Read GUI mask",
};
const rawBackends=new WeakMap<object,object>();
/** Optional display preparation handles its own failures without interrupting foreground work. */
export function backgroundBackend<T extends object>(backend:T):T{return (rawBackends.get(backend)??backend) as T;}
/** Preserve the backend contract and callers' own recovery, while reporting even swallowed rejections. */
export function withErrorReporting<T extends object>(backend: T): T {
  const methods = new Map<PropertyKey, unknown>();
  const terminalFailures = new Map<PropertyKey, string>();
  const wrapped=new Proxy(backend, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      if (!methods.has(property)) methods.set(property, async (...args: unknown[]) => {
        const context = operationNames[String(property)] ?? String(property).replace(/([a-z])([A-Z])/g, "$1 $2");
        try {
          const result: unknown = await value.apply(target, args);
          if (result && typeof result === "object") {
            const status = result as { id?: unknown; state?: string; error?: unknown; save_error?: unknown };
            if (status.state === "failed" || status.state === "error") {
              const error = status.error || "The operation failed without an explanation.";
              const signature = JSON.stringify([status.id, status.state, failureMessage(error)]);
              if (terminalFailures.get(property) !== signature) {
                terminalFailures.set(property, signature);
                reportError(context, error);
              }
            } else terminalFailures.delete(property);
            if (status.save_error) reportError("Save project", status.save_error);
          } else terminalFailures.delete(property);
          return result;
        } catch (error) { reportError(context, error); throw error; }
      });
      return methods.get(property);
    },
  });
  rawBackends.set(wrapped,backend);
  return wrapped;
}
export function reportVideoFailure(message: string) { reportError("Display video or image", message); }
export function installGlobalErrorHandlers(target: Window): () => void {
  const error = (event: Event) => {
    if (event instanceof ErrorEvent) reportError("Application error", event.error || event.message);
    else if (event.target instanceof HTMLElement) {
      const element = event.target;
      // an object URL alone does not say which picture failed: add its alt text and the box it sits in
      const where = [element.getAttribute("alt") && `"${element.getAttribute("alt")}"`, element.parentElement?.className && `in .${String(element.parentElement.className).trim().split(/\s+/).join(".")}`].filter(Boolean).join(", ");
      if (["IMG", "SCRIPT", "LINK", "VIDEO", "AUDIO"].includes(element.tagName)) reportError("Load application media", `Could not load ${element.tagName.toLowerCase()}: ${(element.getAttribute("src") || element.getAttribute("href") || "resource").slice(0, 300)}${where ? ` (${where})` : ""}`);
    }
  };
  const rejection = (event: PromiseRejectionEvent) => reportError("Application action", event.reason);
  // Registered before React mounts: stop window-level labelling shortcuts while the modal
  // owns focus, but preserve native Tab, Escape, text selection and button activation.
  const key = (event: KeyboardEvent) => {
    if (target.document?.querySelector(".failure-dialog[open]")) event.stopImmediatePropagation();
  };
  target.addEventListener("error", error, true);
  target.addEventListener("unhandledrejection", rejection);
  target.addEventListener("keydown", key, true);
  return () => { target.removeEventListener("error", error, true); target.removeEventListener("unhandledrejection", rejection); target.removeEventListener("keydown", key, true); };
}
