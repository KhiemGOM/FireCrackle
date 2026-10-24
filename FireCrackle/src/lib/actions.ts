// Glue between hotkeys and the backend: which backend action a key action means, how playback state changes,
// and what counts as "typing in a text field". Pure, so it is tested without a browser.

import type { Action, KeyInfo } from "./keymap";
import type { Label } from "./grid";

/** The actions the backend understands (mirrors the Rust `UiAction`). */
export type UiAction =
  | {type:"analysisMode";combined:boolean}
  | { type: "step"; frames: number }
  | { type: "bigStep"; dir: number }
  | { type: "manualStep"; frames: number }
  | { type: "manualBigStep"; dir: number }
  | { type: "home" }
  | { type: "end" }
  | { type: "goTo"; frame: number }
  | { type: "nextUnlabelled"; dir: number }
  | { type: "nextFlag"; dir: number }
  | { type: "toggleSheet" }
  | { type: "toggleMirror" }
  | { type: "digit"; digit: number }
  | { type: "flushTyped" }
  | { type: "cancelTyping" }
  | { type: "acceptSuggestion" }
  | { type: "clear" }
  | { type: "noFire" }
  | { type: "skip" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "setLabel"; label: Label }
  | { type: "clickCell"; col: number; row: number }
  | { type: "fillRange"; start: number; end: number; label: Label };

/** The backend action for a key action, or null when the key is handled by the interface itself (playback). */
export function toUiAction(a: Action): UiAction | null {
  switch (a.type) {
    case "step":
      return { type: "step", frames: a.frames };
    case "bigStep":
      return { type: "bigStep", dir: a.dir };
    case "home":
    case "end":
    case "toggleSheet":
    case "toggleMirror":
    case "acceptSuggestion":
    case "clear":
    case "noFire":
    case "skip":
    case "undo":
    case "redo":
    case "cancelTyping":
      return { type: a.type };
    case "digit":
      return { type: "digit", digit: a.digit };
    case "nextUnlabelled":
      return { type: "nextUnlabelled", dir: a.dir };
    case "nextFlag":
      return { type: "nextFlag", dir: a.dir };
    case "playPause":
    case "stepPhase":
    case "shuttle":
      return null;
  }
}

export interface EventTargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  /** `data-owns-keys` marks a field that uses Enter and the arrows itself (the jump box). */
  dataset?: { ownsKeys?: string };
}

/** True when a key press should go to a text field instead of the hotkeys. */
export function isEditableTarget(t: EventTargetLike | null | undefined): boolean {
  if (!t) return false;
  if (t.isContentEditable) return true;
  const tag = (t.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export interface KeyboardEventLike {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  repeat: boolean;
  target: EventTargetLike | null;
}

export function keyInfo(e: KeyboardEventLike): KeyInfo {
  return {
    key: e.key,
    ctrlKey: e.ctrlKey,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    metaKey: e.metaKey,
    repeat: e.repeat,
    targetEditable: isEditableTarget(e.target),
    ...(e.target?.dataset?.ownsKeys === "true" ? { targetOwnsKeys: true } : {}),
  };
}

/** Playback: direction (-1, 0 = stopped, 1) and speed as a multiple of the frame rate. */
export interface Playback {
  dir: -1 | 0 | 1;
  speed: number;
}

export const STOPPED: Playback = { dir: 0, speed: 1 };

/** The playback state after a play/pause or shuttle key. Pressing the same direction again doubles the speed. */
export function nextPlayback(
  state: Playback,
  action: { type: "playPause" } | { type: "shuttle"; dir: -1 | 0 | 1 },
  maxSpeed: number,
  preferredSpeed = 1,
): Playback {
  const max = Math.max(1, Math.floor(maxSpeed) || 1);
  const startSpeed = Number.isFinite(preferredSpeed) && preferredSpeed > 0 ? Math.min(preferredSpeed, max) : 1;
  if (action.type === "playPause") return state.dir === 0 ? { dir: 1, speed: startSpeed } : STOPPED;
  if (action.dir === 0) return STOPPED;
  if (state.dir === action.dir) return { dir: action.dir, speed: Math.min(state.speed * 2, max) };
  return { dir: action.dir, speed: startSpeed };
}

export interface PlaybackTick {
  /** Milliseconds between steps. */
  intervalMs: number;
  /** Frames to move at each step (negative = backwards). */
  frames: number;
}

/**
 * How to drive playback: one frame per frame time while that is slower than `minTickMs`; beyond that, steps of
 * `minTickMs` that each move several frames, so the speed is kept. `null` when stopped or unusable.
 */
export function playbackTick(fps: number, p: Playback, minTickMs: number): PlaybackTick | null {
  const base = stepIntervalMs(fps, p);
  if (base === null) return null;
  const intervalMs = Math.max(base, minTickMs);
  return { intervalMs, frames: Math.max(1, Math.round(intervalMs / base)) * p.dir };
}

/** Milliseconds between steps while playing, or null when stopped / unusable. */
export function stepIntervalMs(fps: number, p: Playback): number | null {
  if (p.dir === 0 || !(fps > 0) || !Number.isFinite(fps)) return null;
  return 1000 / (fps * p.speed);
}
