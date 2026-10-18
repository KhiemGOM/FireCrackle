import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ copyStatus: "", failures: [] as Array<import("../lib/appErrors").AppFailure>, dismiss: vi.fn(), report: vi.fn() }));
vi.mock("react", async importOriginal => ({ ...await importOriginal<typeof import("react")>(),
  useSyncExternalStore: () => state.failures, useEffect: () => {}, useRef: () => ({ current: null }),
  useState: () => [state.copyStatus, (value: string) => { state.copyStatus = value; }],
}));
vi.mock("react-dom", () => ({ createPortal: (node: unknown) => node }));
vi.mock("../lib/appErrors", async importOriginal => ({ ...await importOriginal<typeof import("../lib/appErrors")>(), dismissFailure: state.dismiss, reportError: state.report }));
import { AppErrorBoundary, ErrorNotifications } from "./ErrorNotifications";
function nodes(node: any): any[] { return !node || typeof node !== "object" ? [] : [node, ...(Array.isArray(node.props?.children) ? node.props.children.flat(Infinity) : [node.props?.children]).flatMap(nodes)]; }
beforeEach(() => {
  state.copyStatus = ""; state.dismiss.mockClear(); state.report.mockClear();
  state.failures = [{ id: 1, context: "Open video", message: "FFmpeg is missing", details: "Missing ffprobe", count: 1, time: 0 }];
  vi.stubGlobal("document", { body: {} });
  vi.stubGlobal("navigator", { userAgent: "test runtime", clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
it("shows a readable modal and copies versioned diagnostics", async () => {
  const tree = nodes(ErrorNotifications());
  expect(tree[0].props.role).toBe("alertdialog");
  expect(tree.some(x => x.props.id === "failure-message" && x.props.children === "FFmpeg is missing")).toBe(true);
  const copy = tree.find(x => x.type === "button" && x.props.children === "Copy error");
  copy.props.onClick(); await Promise.resolve(); await Promise.resolve();
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("Missing ffprobe"));
  expect(state.copyStatus).toBe("Copied");
  tree.find(x => x.props["aria-label"] === "Dismiss error").props.onClick();
  expect(state.dismiss).toHaveBeenCalledWith(1);
});
it("leaves diagnostics selectable if the clipboard is unavailable", async () => {
  vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error("denied"));
  nodes(ErrorNotifications()).find(x => x.props.children === "Copy error").props.onClick();
  await Promise.resolve(); await Promise.resolve();
  expect(state.copyStatus).toContain("Select the details");
  expect(nodes(ErrorNotifications()).find(x => x.type === "textarea").props.readOnly).toBe(true);
});
it("handles Escape dismissal and remains absent when there is no failure", () => {
  const preventDefault = vi.fn(); nodes(ErrorNotifications())[0].props.onCancel({ preventDefault });
  expect(preventDefault).toHaveBeenCalled(); expect(state.dismiss).toHaveBeenCalledWith(1);
  state.failures = []; expect(ErrorNotifications()).toBeNull();
});
it("keeps a reload fallback and reports component crashes outside the failed app", () => {
  const boundary = new AppErrorBoundary({ children: "App" });
  boundary.state = AppErrorBoundary.getDerivedStateFromError();
  boundary.componentDidCatch(new Error("Broken screen"), { componentStack: "VideoPane" });
  expect(state.report).toHaveBeenCalledWith("Display application", expect.objectContaining({ message: "Broken screen" }));
  expect(nodes(boundary.render()).some(x => x.props.children === "Reload app")).toBe(true);
});
