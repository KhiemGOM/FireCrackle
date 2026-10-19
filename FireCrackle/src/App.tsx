import {ANIMATION_ATLASES} from "./lib/animationAtlases";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { version as appVersion } from "../package.json";
import "./App.css";
import { FlagsPanel } from "./components/FlagsPanel";
import { AutomationTools } from "./components/AutomationTools";
import { OpenLink, ToolSetupNotice } from "./components/OpenLink";
import { Icon, IconButton } from "./components/Icon";
import { PhaseTab } from "./components/PhaseTab";
import { ImagesTab } from "./components/ImagesTab";
import { Picker } from "./components/Picker";
import { ProjectsHome } from "./components/ProjectsHome";
import { Credits } from "./components/Credits";
import { UpdateBanner } from "./components/UpdateBanner";
import { UpdatesDialog, statusOf } from "./components/UpdatesDialog";
import { useUpdates } from "./hooks/useUpdates";
import { EnhancePanel } from "./components/EnhancePanel";
import { usePostSettings } from "./hooks/usePostSettings";
import { readExtraSources, saveExtraSources } from "./lib/extraSources";
import { SettingsPanel } from "./components/SettingsPanel";
import { Splitter } from "./components/Splitter";
import { Timeline } from "./components/Timeline";
import { VideoPane, type VideoPreviewHandle } from "./components/VideoPane";
import { VideoNotes } from "./components/VideoNotes";
import { selectAtlasCell, atlasSprite, spriteLabel, labelSprite, spriteWithSheet, type PreviewSprite } from "./lib/firePreview";
import { candidateConfirmation, candidateDigit, candidateText, currentCandidate, replacedLabel, spriteText, type CandidateDraft } from "./lib/labelCandidate";
import { useLayout } from "./hooks/useLayout";
import { usePanelZooms } from "./hooks/usePanelZooms";
import { useWheel } from "./hooks/useWheel";
import { useWorkspace, messageOf } from "./hooks/useWorkspace";
import { FLAGS_LIMITS, SIDE_LIMITS, VIDEO_LIMITS, clampSize, pickerCellSize, upperBound } from "./lib/layout";
import { STOPPED, keyInfo, nextPlayback, playbackTick, toUiAction, type Playback } from "./lib/actions";
import { framesDue, startClock } from "./lib/playbackClock";
import { createBackend, settingValue, LABEL_SOURCE_NAMES, type Backend } from "./lib/api";
import { veilOptionsFromSettings } from "./lib/veil";
import { getFailures, reportError, reportVideoFailure, subscribeFailures, withErrorReporting } from "./lib/appErrors";
import { wouldConsumeToolKey } from "./lib/toolKeys";
import { actionFor, reservedGlobally } from "./lib/keymap";
import { blocksVideoToolKeys } from "./lib/shortcutFocus";
import type { AtlasEdges, EdgeFilter } from "./lib/atlasFilter";
import { readPreferences, writePreferences } from "./lib/preferences";

const KEY_HELP: Array<[string, string]> = [
  ["Q · H · M · U", "quad · first-person fire · matcher · ruler"],
  ["M", "open / find match · close matcher"],
  ["Hold M + 1–3", "preview match 1–3"],
  ["← →", "previous / next frame · hold to repeat"],
  ["↑ ↓", "previous / next sprite row"],
  ["Shift + ← →", "big frame step"],
  ["Home · End", "first / last frame"],
  ["Space · L · J · K", "play · forward · backward · stop"],
  ["0–9", "choose row · Enter to save"],
  ["Enter", "save candidate and advance"],
  ["R · T", "flip · switch sheet / still–flowing"],
  ["X · Shift+X", "mark selected source absent · skip"],
  ["Backspace · Ctrl+Z", "clear label · undo"],
  ["Ctrl+S", "save labels and position"],
  ["N · Shift+N", "next / previous unlabelled frame"],
  ["F · Shift+F", "next / previous flag"],
  ["Esc", "discard candidate / deselect corner"],
  ["Atlas click", "select and preview · Enter to save"],
  ["Right-click sprite", "exclude / restore candidate · fire only"],
  ["Ctrl+click sprite", "preview only"],
  ["Ctrl+drag quad", "move all corners"],
  ["Shift (quad)", "resize / rotate handles"],
  ["Shift (video)", "rotate around pointer anchor"],
  ["P", "make quad a parallelogram"],
  ["E", "toggle preview opacity 0% / 100%"],
  ["Corner + Alt+click", "place selected corner"],
];

export default function App() {
  const [backend, setBackend] = useState<Backend | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  useEffect(() => {
    createBackend().then(value => setBackend(withErrorReporting(value))).catch((e) => { setStartupError(String(e)); reportError("Start FireCrackle", e); });
  }, []);

  const [extraSources, setExtraSources] = useState(readExtraSources);
  const ws = useWorkspace(backend, !extraSources);
  const { view, act } = ws;
  const [playback, setPlayback] = useState<Playback>(STOPPED);
  useEffect(() => subscribeFailures(() => { if (getFailures().length) setPlayback(STOPPED); }), []);
  const presented = useRef<number | null>(null);
  const playbackView = useRef(view);
  playbackView.current = view;
  const framePresented = useCallback((frame: number) => { presented.current = frame; }, []);
  const [showSettings, setShowSettings] = useState(false);
  const changeExtraSources = (enabled: boolean) => { saveExtraSources(enabled); setExtraSources(enabled); setPreviewSprite(null); setDraft(null); activeAbsence.current = "no_fire"; };
  const [showKeys, setShowKeys] = useState(false);
  const [showCredits, setShowCredits] = useState(false);
  const updates = useUpdates(backend);
  const [showUpdates, setShowUpdates] = useState(false);
  const post = usePostSettings();
  const [side, setSide] = useState<"label" | "enhance">("label");
  const [showAutomation,setShowAutomation]=useState(false);
  const [path, setPath] = useState("");
  const [showLink, setShowLink] = useState(false);
  const [home, setHome] = useState(false);
  const [tab, setTab] = useState<"label" | "phase" | "images">(readPreferences().tab);
  const { layout, set: setLayout, reset: resetLayout } = useLayout();
  const workareaRef = useRef<HTMLElement | null>(null);
  const { zooms, wheel: zoomWheel, reset: resetZoom } = usePanelZooms();
  const pickerBoxRef = useRef<HTMLDivElement | null>(null);
  const activeAbsence = useRef<import("./lib/grid").Label>("no_fire");
  const videoPreviewRef = useRef<VideoPreviewHandle | null>(null);
  const [draft, setDraft] = useState<CandidateDraft | null>(null);
  const [previewSprite, setPreviewSprite] = useState<PreviewSprite | null>(null);
  const [atlasFilter, setAtlasFilter] = useState<EdgeFilter>(readPreferences().atlasFilter);
  const [atlasEdges, setAtlasEdges] = useState<AtlasEdges | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  useEffect(() => { if (ws.error) reportError("Project action", ws.error); }, [ws.error]);
  useEffect(() => { if (view?.save_error) reportError("Save project", view.save_error); }, [view?.save_error]);
  useEffect(() => { writePreferences({ tab, atlasFilter }); }, [tab, atlasFilter]);
  const candidate = view ? currentCandidate(view, draft) : null;
  // the saved label Confirm/Enter would overwrite: the Confirm button turns red and reads Replace
  const replaced = view ? replacedLabel(view, candidate) : null;
  const candidateSprite=candidate?labelSprite(candidate.label):null;
  const candidatePick = candidateSprite ?? view?.pick;
  const stageSprite = useCallback((sprite: PreviewSprite) => {
    if (!view) return;
    setPlayback(STOPPED);
    setDraft({ frame: view.current, label: spriteLabel(sprite), origin: "picked" });
  }, [view?.current]);
  const confirmCandidate = useCallback(() => {
    if (!view || ws.busy.current) return;
    const action = candidateConfirmation(currentCandidate(view, draft));
    if (!action) return;
    setPlayback(STOPPED);
    void act(action);
  }, [view, draft, act, ws.busy]);
  useEffect(() => { setDraft(null); }, [view?.current]);
  useEffect(() => {
    if(draft && draft.frame===view?.current){
      const sprite=labelSprite(draft.label);
      if(sprite)videoPreviewRef.current?.selectSprite(sprite);
    }
  }, [draft?.frame, draft?.label, view?.current]);
  const flagsBoxRef = useRef<HTMLDivElement | null>(null);
  // ctrl + wheel zooms the panel under the cursor (and not the whole window)
  useWheel(pickerBoxRef, (e) => (e.ctrlKey ? (zoomWheel("picker", e.deltaY), true) : false));
  useWheel(flagsBoxRef, (e) => (e.ctrlKey ? (zoomWheel("flags", e.deltaY), true) : false));

  /** Leave the Phase tab at a frame (a flag, or a point of the chart). */
  function jumpToLabel(frame: number) {
    setTab("label");
    void act({ type: "goTo", frame });
  }

  const maxSpeed = settingValue(ws.settings, "label.max_play_speed", 8);
  const minTick = settingValue(ws.settings, "label.min_play_tick_ms", 16);
  const bufferSettings = {
    ahead: settingValue(ws.settings, "label.buffer_ahead", 90),
    behind: settingValue(ws.settings, "label.buffer_behind", 30),
    decodeAhead: settingValue(ws.settings, "label.buffer_decode_ahead", 8),
    parallel: settingValue(ws.settings, "label.buffer_parallel", 3),
    lateShow: settingValue(ws.settings, "label.buffer_late_show", 30),
  };
  const typeTimeout = settingValue(ws.settings, "label.row_type_timeout_ms", 700);
  const veilOptions = veilOptionsFromSettings(ws.settings);

  // hotkeys
  useEffect(() => {
    const onSave = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (tab !== "images") void ws.save();
      }
    };
    window.addEventListener("keydown", onSave);
    return () => window.removeEventListener("keydown", onSave);
  }, [ws.save, tab]);

  // hotkeys
  useEffect(() => {
    if (!view || home || tab !== "label" || showAutomation || showLink) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      // A video tool key (Q H M U, or the 1-3 that follow M) belongs to the video pane: do not read it as a row digit.
      const t = e.target as HTMLElement | null;
      if (wouldConsumeToolKey({ key: e.key, type: "down", ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, shiftKey: e.shiftKey, repeat: e.repeat,
        targetEditable: blocksVideoToolKeys(t) })) return;
      // Reserve navigation/confirmation before focused inputs and buttons handle them (not in a field that owns its keys).
      if (reservedGlobally({ key: e.key, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, targetOwnsKeys: t?.dataset?.ownsKeys === "true" })) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
      const a = actionFor(
        keyInfo({
          key: e.key,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          metaKey: e.metaKey,
          repeat: e.repeat,
          target: e.target as HTMLElement | null,
        }),
      );
      if (!a) return;
      e.preventDefault();
      if (a.type === "step" || a.type === "bigStep") setPlayback(STOPPED);
      if (a.type === "acceptSuggestion") { confirmCandidate(); return; }
      if (a.type === "digit") {
        setPlayback(STOPPED);
        setDraft(previous => candidateDigit(view!.current, previous, a.digit, candidatePick ?? view!.pick));
        return;
      }
      if (a.type === "noFire" || a.type === "skip") {
        setPlayback(STOPPED);
        setDraft({ frame: view!.current, label: a.type === "noFire" ? activeAbsence.current : "skip", origin: "picked" });
        return;
      }
      if (a.type === "cancelTyping") { setDraft(null); return; }
      if (a.type === "stepPhase") {
        const sprite:PreviewSprite = previewSprite ?? candidateSprite ?? { ...view!.pick, sheet:view!.pick.sheet as 0|1, row: 0 };
        const count=sprite.atlas?ANIMATION_ATLASES[sprite.atlas].rows:32;
        stageSprite({ ...sprite, sheet: sprite.sheet as 0 | 1, row: (sprite.row+a.dir+count)%count });
        return;
      }
      if (a.type === "toggleSheet" || a.type === "toggleMirror") {
        const sprite:PreviewSprite=candidateSprite??{...view!.pick,sheet:view!.pick.sheet as 0|1,row:0};
        stageSprite(a.type==='toggleSheet'?spriteWithSheet(sprite,(1-sprite.sheet) as 0|1):{...sprite,mirrored:!sprite.mirrored});
        return;
      }
      const ui = toUiAction(a);
      if (ui) void act(ui);
      else if (a.type === "playPause" || a.type === "shuttle") setPlayback((p) => nextPlayback(p, a, maxSpeed));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [view, home, tab, act, maxSpeed, confirmCandidate, candidatePick, candidate, stageSprite, previewSprite, showAutomation, showLink]);

  // playback is a Label-tab thing: it must not keep stepping behind the chart
  useEffect(() => {
    if (tab !== "label" || home) setPlayback(STOPPED);
  }, [tab, home]);

  // playback: one timer, and the frame follows the wall clock. A tick that fires late, or is skipped while the previous
  // step is still in flight, is made up on the next one, so the video keeps its speed: at 60 fps a tick is 16.7 ms, and
  // counting only the ticks that ran lost the time of every skipped one, so any slow moment slowed the video for good.
  const fps = view?.fps ?? 0;
  useEffect(() => {
    const tick = playbackTick(fps, playback, minTick);
    if (!tick) return;
    const maxCatchUp = 30; // after a long stall, drop the rest instead of racing ahead
    let clock = startClock(performance.now());
    const id = setInterval(() => {
      const ready = !ws.busy.current && presented.current === playbackView.current?.current;
      const due = framesDue(performance.now(), clock, fps, playback.speed, maxCatchUp, ready);
      clock = due.clock;
      if (due.frames > 0) void act({ type: "step", frames: due.frames * playback.dir });
    }, tick.intervalMs);
    return () => clearInterval(id);
  }, [fps, playback, minTick, act, ws.busy]);
  useEffect(() => { presented.current = null; }, [ws.videoPath]);

  // stop at the ends
  useEffect(() => {
    if (!view) return;
    if ((playback.dir > 0 && view.current >= view.frame_count - 1) || (playback.dir < 0 && view.current <= 0)) setPlayback(STOPPED);
  }, [view?.current, view?.frame_count, playback.dir]); // eslint-disable-line react-hooks/exhaustive-deps

  // Finish interpreting a single digit without saving or advancing the frame.
  useEffect(() => {
    if (!draft?.digits || draft.digits.length !== 1) return;
    const id = setTimeout(() => setDraft(previous => previous === draft ? { ...previous, digits: undefined } : previous), typeTimeout);
    return () => clearTimeout(id);
  }, [draft, typeTimeout]);

  /** Import a video (a new project) or reopen its project; Home closes once the video is open. */
  async function openVideo(path: string, frame?: number) {
    setPlayback(STOPPED);
    setDraft(null);
    setPreviewSprite(null);
    setTab("label");
    if (await ws.open(path, frame)) setHome(false);
  }

  async function chooseVideo() {
    if (!backend) return;
    setPickerError(null);
    try {
      const picked = await backend.pickVideo();
      if (picked) await openVideo(picked);
    } catch (error) {
      setPickerError(`Could not open the video chooser: ${messageOf(error)}. On Home, paste the video path to bypass the chooser.`);
    }
  }

  if (startupError) return <div className="fatal">Could not start: {startupError}</div>;
  if (!backend) return <div className="fatal">starting…</div>;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img className="brand-icon" src="/favicon.png" alt="" draggable={false} />
          FireCrackle
          <span className="tag" title={`FireCrackle version ${appVersion}`}>v{appVersion}</span>
          {backend.mock && <span className="tag mock">mock backend</span>}
        </div>
        <nav className="tabs" aria-label="Workspace tabs">
          <button className={tab !== "images" && (!view || home) ? "on" : ""} onClick={() => { setTab("label"); setHome(true); }}><Icon name="home" /> Home</button>
          <button className={tab === "label" && view && !home ? "on" : ""} disabled={!view} onClick={() => { setTab("label"); setHome(false); }}><Icon name="label" /> Label</button>
          <button className={tab === "phase" && !home ? "on" : ""} disabled={!view} onClick={() => { setTab("phase"); setHome(false); }}><Icon name="chart" /> Phase</button>
          <button className={tab === "images" ? "on" : ""} onClick={() => { setTab("images"); setShowKeys(false); }}><Icon name="folder" /> Images</button>
        </nav>
        <div className="top-actions">
          <IconButton icon="folder" label={ws.opening ? "Opening video…" : "Open video"} onClick={() => void chooseVideo()} disabled={ws.opening} />
          <IconButton icon="link" label="Open link" title="Open a video from a URL" onClick={() => { setPlayback(STOPPED); setShowLink(true); }} disabled={ws.opening} />
          {view && (
            <div className={`video-top-actions${tab === "images" ? " inactive" : ""}`} inert={tab === "images"} aria-hidden={tab === "images"}>
              <IconButton icon="save" label="Save labels" onClick={() => void ws.save()} disabled={backend.mock || ws.opening} title="Save labels · Ctrl+S · autosave is also on" />
              <span className={`save-status${view.save_error ? " failed" : ""}`} role="status" title={backend.mock ? "Preview only" : ws.saveStatus}>
                <Icon name={view.save_error ? "alert" : "check"} /><span className="sr-only">{backend.mock ? "Preview only" : ws.saveStatus}</span>
              </span>
              <IconButton icon="export" label="Export labels" disabled={!backend.transferLabels || ws.opening || ws.transferring} onClick={() => { setPlayback(STOPPED); void ws.transferLabels("export"); }} title="Export labels to a JSON file" />
              <IconButton icon="import" label="Import labels" disabled={!backend.transferLabels || ws.opening || ws.transferring} onClick={() => { setPlayback(STOPPED); void ws.transferLabels("import"); }} title="Import labels · replaces matching frames · Undo restores the import" />
              <span className="toolbar-divider" />
              <IconButton icon="undo" label="Undo" onClick={() => void act({ type: "undo" })} title="Undo · Ctrl+Z" />
              <IconButton icon={playback.dir === 0 ? "play" : "pause"} label={playback.dir === 0 ? "Play video" : "Pause video"}
                className={`play-button${playback.dir !== 0 ? " on" : ""}`}
                onClick={() => setPlayback((p) => nextPlayback(p, { type: "playPause" }, maxSpeed))}
                title={`${playback.dir === 0 ? "Play" : "Pause"} · Space`}
              >
                {playback.dir !== 0 && <span>{playback.dir < 0 ? "−" : ""}{playback.speed}×</span>}
              </IconButton>
              <span className="toolbar-divider" />
              <IconButton icon="keyboard" label="Keyboard shortcuts" aria-pressed={showKeys} onClick={() => setShowKeys((s) => !s)} />
              <IconButton icon="robot" label="Auto" onClick={() => {setPlayback(STOPPED);setShowAutomation(true);}}>Auto</IconButton>
              <IconButton icon="settings" label="Settings" onClick={() => setShowSettings(true)} />
            </div>
          )}
          <IconButton icon="import" label="Software updates" title="Check for updates" onClick={() => setShowUpdates(true)}>{updates.banner ? "Update" : null}</IconButton>
          <IconButton icon="info" label="Credits" onClick={() => setShowCredits(true)} />
        </div>
      </header>

      <ToolSetupNotice backend={backend} />
      {pickerError && <div role="alert" className="banner error">{pickerError} <button onClick={() => setPickerError(null)}>Dismiss</button></div>}
      {updates.banner && <UpdateBanner release={updates.banner} localVersion={appVersion} kind={updates.state.kind} onOpen={updates.controller.open} onSkip={updates.controller.skip} onLater={updates.controller.later} onDetails={() => setShowUpdates(true)} />}
      {tab !== "images" && ws.error && (
        <div className="banner error" onClick={ws.clearError}>
          {ws.error} <span className="dismiss">(click to dismiss)</span>
        </div>
      )}
      {tab !== "images" && view?.save_error && <div className="banner error">⚠ {view.save_error}</div>}
      {tab !== "images" && view && view.warnings.length > 0 && (
        <VideoNotes key={JSON.stringify([ws.videoPath, view.warnings])} videoPath={ws.videoPath} warnings={view.warnings} />
      )}

      {tab === "images" ? null : !view || home ? (
        <ProjectsHome
          projects={ws.projects}
          current={ws.videoPath}
          opening={ws.opening}
          mock={backend.mock}
          path={path}
          onPath={setPath}
          onOpenProject={(videoPath, frame) => void openVideo(videoPath, frame)}
          onForget={ws.forgetProject}
          onChooseVideo={() => void chooseVideo()}
          onOpenPath={() => { if (/^https?:\/\//i.test(path.trim())) setShowLink(true); else if (path) void openVideo(path.trim()); }}
          onOpenLink={() => { setPlayback(STOPPED); setShowLink(true); }}
        />
      ) : tab === "phase" ? (
        <PhaseTab extraSources={extraSources} key={ws.videoPath} videoKey={ws.videoPath} backend={backend} view={view} version={ws.version} onJump={jumpToLabel} />
      ) : (
        <main
          className="workarea"
          ref={workareaRef}
          style={
            {
              "--side-w": `${layout.sideWidth}px`,
              "--video-h": `${layout.videoHeight}px`,
              "--flags-h": `${layout.flagsHeight}px`,
            } as CSSProperties
          }
        >
          <section className="left">
            <VideoPane key={ws.videoPath} videoKey={ws.videoPath} backend={backend} view={view} atlasFilter={atlasFilter} atlasEdges={atlasEdges} veil={veilOptions} post={post.picture} onPortalStatus={post.setPortalStatus} onPortalFit={post.setPortalFit} onAnimationStart={() => setPlayback(STOPPED)} previewRef={videoPreviewRef} onPreviewChange={setPreviewSprite} onMatchCandidate={stageSprite} onStep={(frames) => { setPlayback(STOPPED); void act({ type: "step", frames }); }} onGoTo={(frame) => { setPlayback(STOPPED); void act({ type: "goTo", frame }); }} onFramePresented={framePresented} motion={{ dir: playback.dir, speed: playback.speed }} bufferSettings={bufferSettings} onError={reportVideoFailure} />
            <Splitter
              direction="row"
              label="Video height"
              value={layout.videoHeight}
              min={VIDEO_LIMITS.min}
              getMax={() => upperBound(workareaRef.current?.clientHeight ?? 0, 160, VIDEO_LIMITS.max)}
              onChange={(v) => setLayout("videoHeight", v)}
              onReset={() => resetLayout("videoHeight")}
            />
            <Timeline
              key={ws.videoPath} videoKey={ws.videoPath}
              backend={backend}
              view={view}
              flags={ws.flags}
              version={ws.version}
              settings={ws.settings}
              onSeek={(frame) => void act({ type: "goTo", frame })}
            />
            <Splitter
              direction="row"
              label="Flag list height"
              sign={-1}
              value={layout.flagsHeight}
              min={FLAGS_LIMITS.min}
              getMax={() => FLAGS_LIMITS.max}
              onChange={(v) => setLayout("flagsHeight", v)}
              onReset={() => resetLayout("flagsHeight")}
            />
            <div className="zoom-box" ref={flagsBoxRef} style={{ zoom: zooms.flags }} onDoubleClick={(e) => e.ctrlKey && resetZoom("flags")}>
              <FlagsPanel flags={ws.flags} fps={view.fps} current={view.current} onSeek={(frame) => void act({ type: "goTo", frame })} />
            </div>
          </section>
          <Splitter
            direction="col"
            label="Picker width"
            sign={-1}
            value={layout.sideWidth}
            min={SIDE_LIMITS.min}
            getMax={() => upperBound(workareaRef.current?.clientWidth ?? 0, 360, SIDE_LIMITS.max)}
            onChange={(v) => setLayout("sideWidth", v)}
            onReset={() => resetLayout("sideWidth")}
          />
          <aside className={`right${side === "enhance" ? " enhancing" : ""}`}>
            <div className="side-switch">
              <button type="button" aria-label="Show label tools" aria-pressed={side === "label"} className={side === "label" ? "on" : ""} title="Label tools" onClick={() => setSide("label")}><Icon name="atlas" />Label</button>
              <button type="button" aria-label="Show Enhance panel" aria-pressed={side === "enhance"} className={side === "enhance" ? "on" : ""} title="Enhance" onClick={() => setSide("enhance")}><Icon name="enhance" />Enhance</button>
            </div>
            {side === "enhance" && <EnhancePanel settings={post.settings} selected={post.selected} onSelect={post.setSelected} onChange={post.change} onReset={post.reset} portalStatus={post.portalStatus} portalFit={post.portalFit} userPresets={post.userPresets} presetName={post.presetName} onPresetName={post.setPresetName} onSavePreset={post.savePreset} onDeletePreset={post.deletePreset} />}
            <div className="pick-state">
              <IconButton icon="layers" label={`Toggle candidate sheet · current sheet ${candidatePick?.sheet ?? view.pick.sheet}`} className={candidatePick?.sheet === 1 ? "on" : ""} onClick={() => stageSprite(spriteWithSheet(candidateSprite??{...view.pick,sheet:view.pick.sheet as 0|1,row:0},(1-(candidatePick?.sheet??view.pick.sheet)) as 0|1))} title="Switch between atlas sheets 0 and 1 · T · selects a candidate; Confirm saves">
                {candidatePick?.sheet ?? view.pick.sheet}
              </IconButton>
              <IconButton icon="mirror" label="Mirror candidate" aria-pressed={candidatePick?.mirrored ?? view.pick.mirrored} className={candidatePick?.mirrored ? "on" : ""} onClick={() => stageSprite({...candidateSprite,sheet:(candidatePick?.sheet??view.pick.sheet) as 0|1,row:candidateSprite?.row??0,mirrored:!(candidatePick?.mirrored??view.pick.mirrored)})} title="Flip the candidate sprite horizontally · R · Confirm saves">
                {candidatePick?.mirrored ? "mirrored" : "normal"}
              </IconButton>
              <IconButton icon="skip" label="Choose skip" onClick={() => { setPlayback(STOPPED); setDraft({ frame: view.current, label: "skip", origin: "picked" }); }} title="Mark this frame to skip · Shift+X · then Confirm" />
              <IconButton icon="erase" label="Clear label" onClick={() => void act({ type: "clear" })} title="Remove this frame's saved label immediately, making it unreviewed · Backspace · Undo restores it" />
            </div>
            <div className="candidate-panel">
              <div className="candidate-heading"><strong>Candidate</strong><span>{candidate?.origin === "guess" ? "time guess · not saved" : candidate?.origin === "saved" ? "current saved label" : "not saved"}</span></div>
              <div className="candidate-value">{draft?.frame === view.current && draft.label === "unset" ? `Invalid animation index ${draft.digits} (use 0–31)` : candidateText(candidate?.label ?? null)}{draft?.digits?.length === 1 && draft.frame === view.current && Number(draft.digits) <= 3 && <span className="dim"> · {draft.digits}_</span>}</div>
              <div className="candidate-actions">
                <IconButton icon="check" label={replaced ? "Replace saved label" : "Confirm candidate"} className={`confirm-label${replaced ? " replace" : ""}`} disabled={!candidateConfirmation(candidate) || ws.opening || ws.transferring} onClick={confirmCandidate} title={replaced ? `Replace the saved label (${candidateText(replaced)}) with this candidate · Enter · saves and advances · Undo restores it` : "Confirm this candidate · Enter · saves and advances"}>{replaced ? "Replace" : "Confirm"} <kbd>↵</kbd></IconButton>
                <IconButton icon="copy" label="Use displayed preview as candidate" disabled={!previewSprite} onClick={() => previewSprite && stageSprite(previewSprite)} title="Select the displayed preview as the candidate; does not save" />
              </div>
              <div className="atlas-state preview-state"><b>Preview</b><span>{previewSprite ? spriteText(previewSprite) : "Mask off"}</span></div>
              <div className="atlas-state guess-state"><b>Time guess</b><span>{view.suggestion ? spriteText(view.suggestion) : "Unavailable"}</span></div>
              {view.suggestion && <div className="prediction-source">Extrapolated from <button onClick={() => { setPlayback(STOPPED); void act({ type: "goTo", frame: view.suggestion!.from_frame }); }}>labeled frame {view.suggestion.from_frame}</button>{view.suggestion.alt_row !== null && <span> · alternate row {view.suggestion.alt_row}</span>}</div>}
              <div className="atlas-state saved-state"><b>Saved</b><span>{view.label === "unset" ? "Unreviewed" : candidateText(view.label)}</span></div>
              {view.label_sources?.length ? <div className="atlas-state"><b>Source</b><span>{view.label_sources.map(s=>LABEL_SOURCE_NAMES[s]).join(" + ")}</span></div> : null}
              <div className="atlas-legend"><span className="preview-state">P Preview</span><span className="candidate-state">C Candidate</span><span className="guess-state">T Time guess</span><span className="saved-state">✓ Saved</span></div>
              <div className="candidate-help">Click selects · Ctrl+click previews only · Confirm saves</div>
            </div>
            <div className="picker-box" ref={pickerBoxRef} onDoubleClick={(e) => e.ctrlKey && resetZoom("picker")}>
              <Picker extraSources={extraSources}
                onAlternative={(sprite,ctrl)=>{setPlayback(STOPPED);if(!ctrl)stageSprite(sprite);videoPreviewRef.current?.selectSprite(sprite);}}
                onEdgesChange={setAtlasEdges}
                onAbsenceChange={label => { activeAbsence.current=label; }}
                onNoFire={label => { setPlayback(STOPPED); setDraft({ frame: view.current, label, origin: "picked" }); }}
                filter={atlasFilter} onFilterChange={setAtlasFilter}
                view={view}
                candidate={candidate?.label ?? null}
                preview={previewSprite}
                cell={clampSize(pickerCellSize(layout.sideWidth) * zooms.picker, 16, 240)}
                onCell={(col, row, ctrlKey) => { setPlayback(STOPPED); selectAtlasCell(ctrlKey, col, row,
                  (sprite) => videoPreviewRef.current?.selectSprite(sprite) ?? false,
                  (col, row) => { const sprite = atlasSprite(col, row); if (sprite) stageSprite(sprite); }); }}
              />
            </div>
          </aside>
        </main>
      )}

      <ImagesTab active={tab === "images"} backend={backend} />
      {showKeys && (
        <div className="keys">
          {KEY_HELP.map(([k, d]) => (
            <div key={k}>
              <kbd>{k}</kbd><span>{d}</span>
            </div>
          ))}
        </div>
      )}
      {showSettings && <SettingsPanel extraSources={extraSources} onExtraSources={changeExtraSources} settings={ws.settings} onSet={ws.setSetting} onClose={() => setShowSettings(false)} />}
      {showUpdates && <UpdatesDialog localVersion={appVersion} auto={updates.state.settings.auto} lastCheckMs={updates.state.settings.lastCheckMs} status={statusOf(updates.state.result, updates.state.checking)} message={updates.state.result?.state === "error" ? updates.state.result.message : null} release={updates.state.result?.state === "available" ? updates.state.result.release : null} nowMs={Date.now()} onAuto={updates.controller.setAuto} onCheck={() => void updates.controller.check(true)} onOpen={updates.controller.open} onClose={() => setShowUpdates(false)} />}
      {showCredits && <Credits onClose={() => setShowCredits(false)} />}
      {showLink && <OpenLink backend={backend} initialUrl={/^https?:\/\//i.test(path.trim()) ? path : ""} onClose={() => setShowLink(false)} onOpen={async downloaded => { setShowLink(false); await openVideo(downloaded); }} />}
      {showAutomation && view && <AutomationTools key={ws.videoPath} backend={backend} videoPath={ws.videoPath} onApply={ws.applyAutomation} onReview={(frame)=>{jumpToLabel(frame);setShowAutomation(false);}} onClose={()=>setShowAutomation(false)} />}
    </div>
  );
}
