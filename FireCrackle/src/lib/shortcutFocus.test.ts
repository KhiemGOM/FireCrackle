import { expect, it, vi } from "vitest";
import { blocksVideoToolKeys, focusVideoViewport, modalOpen, videoToolContextAvailable, type ShortcutTarget } from "./shortcutFocus";

it("lets video letter shortcuts through non-typing controls, but protects fields and owned-key ancestors", () => {
  for (const target of [null, {tagName: "DIV"}, {tagName: "BUTTON"}, ...["range", "checkbox", "radio", "color"].map(type => ({tagName: "INPUT", type}))]) expect(blocksVideoToolKeys(target)).toBe(false);
  for (const target of [{tagName: "INPUT", type: "number"}, {tagName: "INPUT", type: "text"}, {tagName: "TEXTAREA"}, {tagName: "SELECT"}, {isContentEditable: true}, {dataset: {ownsKeys: "true"}}, {closest: () => ({})}]) expect(blocksVideoToolKeys(target)).toBe(true);
});
it("moves focus on video/image/overlay pointer-down before dragging can prevent the default", () => {
  const focus = vi.fn();
  for (const tagName of ["DIV", "IMG", "svg", "circle", "path", "CANVAS"]) focusVideoViewport({button: 0, target: {tagName}, currentTarget: {focus}});
  expect(focus).toHaveBeenCalledTimes(6);
  expect(focus).toHaveBeenLastCalledWith({preventScroll: true});
});
it("does not steal focus from controls, their children, editable widgets or secondary clicks", () => {
  const focus = vi.fn();
  const controls: ShortcutTarget[] = [{tagName: "INPUT", type: "range"}, {tagName: "INPUT", type: "checkbox"}, {tagName: "BUTTON"}, {tagName: "A"}, {isContentEditable: true}, {tagName: "svg", closest: () => ({})}];
  for (const target of controls) focusVideoViewport({button: 0, target, currentTarget: {focus}});
  focusVideoViewport({button: 2, target: {tagName: "IMG"}, currentTarget: {focus}});
  expect(focus).not.toHaveBeenCalled();
});
it("disables tools for hidden/unmounted viewers and modal dialogs", () => {
  const doc = {querySelector: vi.fn(() => null)};
  expect(videoToolContextAvailable({offsetParent: {}}, doc)).toBe(true);
  expect(videoToolContextAvailable(null, doc)).toBe(false);
  expect(videoToolContextAvailable({offsetParent: null}, doc)).toBe(false);
  doc.querySelector.mockReturnValue({} as never);
  expect(videoToolContextAvailable({offsetParent: {}}, doc)).toBe(false);
});

it('a modal dialog (the image viewer, Credits) is open when either modal marker is in the page',()=>{
  const doc=(found:string|null)=>({querySelector:(selector:string)=>found&&selector.includes(found)?{}:null});
  expect(modalOpen(doc('[role="dialog"][aria-modal="true"]'))).toBe(true);
  expect(modalOpen(doc('.modal-backdrop'))).toBe(true);
  expect(modalOpen(doc(null))).toBe(false);
});

// ---- E (opacity) and P (parallelize) for the sprite overlays

import { maskShortcut } from "./shortcutFocus";

it("E toggles the 3D quad's sprite opacity too (the quad mask's opacity it shares), not only the quad mask's", () => {
  expect(maskShortcut({ key: "e", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, blocked: false },
    { manualEnabled: false, hudEnabled: false, fire3dOn: true })).toBe("manualOpacity");
  expect(maskShortcut({ key: "E", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, blocked: false },
    { manualEnabled: true, hudEnabled: false, fire3dOn: false })).toBe("manualOpacity");
  expect(maskShortcut({ key: "e", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, blocked: false },
    { manualEnabled: false, hudEnabled: true, fire3dOn: false })).toBe("hudOpacity");
});
it("P parallelizes only the quad mask; no tool, a modifier, a repeat or typing does nothing", () => {
  const tools = { manualEnabled: true, hudEnabled: false, fire3dOn: false };
  const key = (k: string, extra = {}) => maskShortcut({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, blocked: false, ...extra }, tools);
  expect(key("p")).toBe("parallel");
  expect(maskShortcut({ key: "p", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, blocked: false }, { manualEnabled: false, hudEnabled: false, fire3dOn: true })).toBeNull();
  expect(maskShortcut({ key: "e", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, blocked: false }, { manualEnabled: false, hudEnabled: false, fire3dOn: false })).toBeNull();
  for (const extra of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }, { repeat: true }, { blocked: true }]) expect(key("e", extra)).toBeNull();
  expect(key("x")).toBeNull();
});
