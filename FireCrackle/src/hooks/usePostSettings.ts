import { useCallback, useEffect, useRef, useState } from "react";
import {useUndoState} from './useUndoState';
import type {LabelUndo} from '../lib/labelUndo';
import { POST_TOGGLE_KEY, isTypingTarget, postKeyAction } from "../lib/post/keys";
import { addUserPreset, readUserPresets, removeUserPreset, writeUserPresets } from "../lib/post/userPresets";
import type { Preset } from "../lib/post/presets";
import {
  STARTING_POST, onlyParamsChanged, pictureSettings, readPostSettings, toggleEnabled, writePostSettings, type PostSettings, type RowId,
} from "../lib/post/settings";

/** How long the picture waits for a slider to stop moving. Switches apply at once. */
export const SLIDER_DELAY_MS = 80;

/**
 * The global post-processing settings: saved, toggled by one key, and handed to the picture. `settings` is what the panel
 * shows (always current); `picture` is what the frame is drawn with (delayed a moment while a slider moves).
 * Only useState, useRef, useEffect and useCallback, like the other hooks the App test replaces.
 */
export function usePostSettings(history?:LabelUndo) {
  const [settings, setSettings] = useUndoState<PostSettings>(() => readPostSettings(),history,'post.settings');
  const [applied, setApplied] = useState<PostSettings>(settings);
  const [selected, setSelected] = useState<RowId>("veil");
  const [portalStatus, setPortalStatus] = useState("");
  const [portalFit, setPortalFit] = useState<{ phase: number; opacity: number } | null>(null);
  const [userPresets, setUserPresets] = useUndoState<Preset[]>(() => readUserPresets(),history,'post.presets');
  const [presetName, setPresetName] = useState("");
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const appliedRef = useRef(applied);
  appliedRef.current = applied;

  useEffect(() => { writePostSettings(settings); }, [settings]);
  useEffect(() => {writeUserPresets(userPresets);},[userPresets]);

  useEffect(() => {
    if (appliedRef.current === settings) return;
    if (!onlyParamsChanged(appliedRef.current, settings)) { setApplied(settings); return; }
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
  /** Back to how a fresh install starts (veil and portal in Auto, every other effect off); the master switch is left as it is. */
  const reset = useCallback(() => setSettings(current => ({ ...STARTING_POST, enabled: current.enabled })), []);

  /** Saves the effects that are on as a preset with the typed name (a blank name or no effect on saves nothing). */
  const savePreset = useCallback((name: string) => {
    setUserPresets(current => {
      const next = addUserPreset(current, name, settingsRef.current);
      if (next !== current) writeUserPresets(next);
      return next;
    });
    setPresetName("");
  }, []);
  const deletePreset = useCallback((id: string) => {
    setUserPresets(current => {
      const next = removeUserPreset(current, id);
      writeUserPresets(next);
      return next;
    });
  }, []);

  return { settings, picture: pictureSettings(applied), selected, setSelected, change, toggle, reset, portalStatus, setPortalStatus, portalFit, setPortalFit, userPresets, presetName, setPresetName, savePreset, deletePreset, toggleKey: POST_TOGGLE_KEY };
}

export type PostController = ReturnType<typeof usePostSettings>;
