import { useCallback, useEffect, useRef, useState } from "react";
import { readPreferences } from "../lib/preferences";
import { POST_TOGGLE_KEY, isTypingTarget, postKeyAction } from "../lib/post/keys";
import {
  DEFAULT_POST, onlyToneParamsChanged, pictureSettings, readPostSettings, toggleEnabled, writePostSettings, type PostSettings, type RowId,
} from "../lib/post/settings";

/** How long the picture waits for a slider to stop moving. Switches apply at once. */
export const SLIDER_DELAY_MS = 80;

/**
 * The global post-processing settings: saved, toggled by one key, and handed to the picture. `settings` is what the panel
 * shows (always current); `picture` is what the frame is drawn with (delayed a moment while a slider moves).
 * Only useState, useRef, useEffect and useCallback, like the other hooks the App test replaces.
 */
export function usePostSettings() {
  const [settings, setSettings] = useState<PostSettings>(() => readPostSettings(undefined, readPreferences()));
  const [applied, setApplied] = useState<PostSettings>(settings);
  const [selected, setSelected] = useState<RowId>("veil");
  const [portalStatus, setPortalStatus] = useState("");
  const appliedRef = useRef(applied);
  appliedRef.current = applied;

  useEffect(() => { writePostSettings(settings); }, [settings]);

  useEffect(() => {
    if (appliedRef.current === settings) return;
    if (!onlyToneParamsChanged(appliedRef.current, settings)) { setApplied(settings); return; }
    const timer = setTimeout(() => setApplied(settings), SLIDER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [settings]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const action = postKeyAction({
        key: e.key, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, shiftKey: e.shiftKey, repeat: e.repeat,
        targetEditable: isTypingTarget(e.target as HTMLElement | null),
      });
      if (action !== "toggle") return;
      e.preventDefault();
      setSettings(toggleEnabled);
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);

  const change = useCallback((next: PostSettings) => setSettings(next), []);
  const toggle = useCallback(() => setSettings(toggleEnabled), []);
  /** Every effect back to its neutral state; the master switch is left as it is. */
  const reset = useCallback(() => setSettings(current => ({ ...DEFAULT_POST, enabled: current.enabled })), []);

  return { settings, picture: pictureSettings(applied), selected, setSelected, change, toggle, reset, portalStatus, setPortalStatus, toggleKey: POST_TOGGLE_KEY };
}

export type PostController = ReturnType<typeof usePostSettings>;
