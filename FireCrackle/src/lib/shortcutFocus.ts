import { isTypingTarget, type TypingTarget } from "./post/keys";

export interface ShortcutTarget extends TypingTarget {
  dataset?: { ownsKeys?: string };
  closest?: (selector: string) => unknown;
}

/** Letter shortcuts work on buttons/sliders/checkboxes, but never while typing or inside a key-owning widget. */
export function blocksVideoToolKeys(target: ShortcutTarget | null | undefined): boolean {
  return isTypingTarget(target) || target?.dataset?.ownsKeys === "true"
    || !!target?.closest?.('[data-owns-keys="true"], [role="textbox"], [role="combobox"]');
}

/** A modal (the image viewer, Credits, ...) owns the keyboard while it is open. */
export function modalOpen(doc: Pick<Document, "querySelector"> | undefined = globalThis.document): boolean {
  return !!doc?.querySelector('.modal-backdrop, [role="dialog"][aria-modal="true"]');
}

/** Both families of video-tool shortcuts use the same visible-pane/modal guard. */
export function videoToolContextAvailable(pane: { offsetParent: unknown } | null, doc: Pick<Document, "querySelector">): boolean {
  return !!pane && pane.offsetParent !== null && !modalOpen(doc);
}

/** Panning/overlay drags prevent the browser's normal focus change, so focus the viewer during capture first. */
export function focusVideoViewport(e: { button: number; target: ShortcutTarget | null; currentTarget: { focus: (options: FocusOptions) => void } }): void {
  if (e.button !== 0 || blocksVideoToolKeys(e.target)
    || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(e.target?.tagName ?? "")
    || e.target?.closest?.('input, textarea, select, button, a[href], [role="button"], [role="slider"]')) return;
  e.currentTarget.focus({ preventScroll: true });
}
