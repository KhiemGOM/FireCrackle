import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
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
import { SettingsPanel } from "./components/SettingsPanel";
import { Splitter } from "./components/Splitter";
import { Timeline } from "./components/Timeline";
import { VideoPane, type VideoPreviewHandle } from "./components/VideoPane";
import { VideoNotes } from "./components/VideoNotes";
import { selectAtlasCell, atlasSprite, type PreviewSprite } from "./lib/firePreview";
import { candidateConfirmation, candidateDigit, candidateText, currentCandidate, spriteText, type CandidateDraft } from "./lib/labelCandidate";
import { isFire } from "./lib/grid";
import { stepHudRow } from "./lib/hudOverlay";
import { useLayout } from "./hooks/useLayout";
import { usePanelZooms } from "./hooks/usePanelZooms";
import { useWheel } from "./hooks/useWheel";
import { useWorkspace } from "./hooks/useWorkspace";
import { FLAGS_LIMITS, SIDE_LIMITS, VIDEO_LIMITS, clampSize, pickerCellSize, upperBound } from "./lib/layout";
import { STOPPED, keyInfo, nextPlayback, playbackTick, toUiAction, type Playback } from "./lib/actions";
import { createBackend, settingValue, LABEL_SOURCE_NAMES, type Backend } from "./lib/api";
import { actionFor, isGlobalKey } from "./lib/keymap";
import type { AtlasEdges, EdgeFilter } from "./lib/atlasFilter";
import { readPreferences, writePreferences } from "./lib/preferences";

const KEY_HELP: Array<[string, string]> = [
  ["← →", "previous / next frame (hold to repeat)"],
  ["↑ ↓", "previous / next animation phase"],
  ["Shift + ← →", "big step"],
  ["Home / End", "first / last frame"],
  ["Space · L · J · K", "play / faster forward / faster backward / stop"],
  ["0–9", "choose a candidate animation index; nothing is saved yet"],
  ["Enter", "confirm the candidate and advance"],
  ["R · T", "flip candidate · switch fire sheet 0/1"],
  ["X · Shift+X", "choose no fire · skip, then confirm"],
  ["Backspace · Ctrl+Z", "clear · undo"],
  ["Ctrl+S", "save labels and current video position"],
  ["N · Shift+N", "next / previous unlabelled"],
  ["F · Shift+F", "next / previous flag"],
  ["Esc", "discard the selected candidate"],
  ["Atlas click", "select candidate and preview; Confirm/Enter saves it"],
  ["Ctrl + atlas click", "select sprite for the enabled fire preview without labeling"],
  ["Ctrl + quad drag", "move all four corners together"],
  ["Hold Shift", "quad transform box: corners resize proportionally, edges resize one axis, top handle rotates"],
  ["P", "make the manual quad a parallelogram"],
  ["E", "toggle active fire preview opacity 0% / 100%"],
  ["Select corner + Alt+click", "place that corner at the click, including outside the image; Esc deselects"],
];

export default function App() {
  const [backend, setBackend] = useState<Backend | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  useEffect(() => {
    createBackend().then(setBackend).catch((e) => setStartupError(String(e)));
  }, []);

  const ws = useWorkspace(backend);
  const { view, act } = ws;
  const [playback, setPlayback] = useState<Playback>(STOPPED);
  const [showSettings, setShowSettings] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [showCredits, setShowCredits] = useState(false);
  const [showAutomation,setShowAutomation]=useState(false);
  const [path, setPath] = useState("");
  const [showLink, setShowLink] = useState(false);
  const [home, setHome] = useState(false);
  const [tab, setTab] = useState<"label" | "phase" | "images">(readPreferences().tab);
  const { layout, set: setLayout, reset: resetLayout } = useLayout();
  const workareaRef = useRef<HTMLElement | null>(null);
  const { zooms, wheel: zoomWheel, reset: resetZoom } = usePanelZooms();
  const pickerBoxRef = useRef<HTMLDivElement | null>(null);
  const videoPreviewRef = useRef<VideoPreviewHandle | null>(null);
  const [draft, setDraft] = useState<CandidateDraft | null>(null);
  const [previewSprite, setPreviewSprite] = useState<PreviewSprite | null>(null);
  const [atlasFilter, setAtlasFilter] = useState<EdgeFilter>(readPreferences().atlasFilter);
  const [atlasEdges, setAtlasEdges] = useState<AtlasEdges | null>(null);
  useEffect(() => { writePreferences({ tab, atlasFilter }); }, [tab, atlasFilter]);
  const candidate = view ? currentCandidate(view, draft) : null;
  const candidatePick = candidate && isFire(candidate.label) ? candidate.label.fire : view?.pick;
  const stageSprite = useCallback((sprite: PreviewSprite) => {
    if (!view) return;
    setPlayback(STOPPED);
    setDraft({ frame: view.current, label: { fire: sprite }, origin: "picked" });
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
    if (draft && draft.frame === view?.current && isFire(draft.label)) videoPreviewRef.current?.selectSprite(draft.label.fire as PreviewSprite);
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
  const typeTimeout = settingValue(ws.settings, "label.row_type_timeout_ms", 700);

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
      // Reserve navigation/confirmation before focused inputs and buttons handle them.
      if (isGlobalKey(e)) {
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
        setDraft({ frame: view!.current, label: a.type === "noFire" ? "no_fire" : "skip", origin: "picked" });
        return;
      }
      if (a.type === "cancelTyping") { setDraft(null); return; }
      if (a.type === "stepPhase") {
        const sprite = previewSprite ?? (candidate && isFire(candidate.label) ? candidate.label.fire : { ...view!.pick, row: 0 });
        stageSprite({ ...sprite, sheet: sprite.sheet as 0 | 1, row: stepHudRow(sprite.row, a.dir) });
        return;
      }
      if (a.type === "toggleSheet" || a.type === "toggleMirror") {
        const pick = candidatePick ?? view!.pick;
        stageSprite({ sheet: (a.type === "toggleSheet" ? 1 - pick.sheet : pick.sheet) as 0 | 1, mirrored: a.type === "toggleMirror" ? !pick.mirrored : pick.mirrored, row: candidate && isFire(candidate.label) ? candidate.label.fire.row : 0 });
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

  // playback: one timer; ticks are skipped while the previous step is still in flight
  const fps = view?.fps ?? 0;
  useEffect(() => {
    const tick = playbackTick(fps, playback, minTick);
    if (!tick) return;
    const id = setInterval(() => {
      if (!ws.busy.current) void act({ type: "step", frames: tick.frames });
    }, tick.intervalMs);
    return () => clearInterval(id);
  }, [fps, playback, minTick, act, ws.busy]);

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
  async function openVideo(path: string, frame = 0) {
    setPlayback(STOPPED);
    setDraft(null);
    setPreviewSprite(null);
    setTab("label");
    if (await ws.open(path, frame)) setHome(false);
  }

  async function chooseVideo() {
    if (!backend) return;
    const picked = await backend.pickVideo();
    if (picked) await openVideo(picked);
  }

  if (startupError) return <div className="fatal">Could not start: {startupError}</div>;
  if (!backend) return <div className="fatal">starting…</div>;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img className="brand-icon" src="/favicon.png" alt="" draggable={false} />
          FireCrackle
          {backend.mock && <span className="tag mock">mock backend</span>}
        </div>
        <nav className="tabs" aria-label="Workspace tabs">
          <button className={tab !== "images" && (!view || home) ? "on" : ""} onClick={() => { setTab("label"); setHome(true); }}><Icon name="home" /> Home</button>
          <button className={tab === "label" && view && !home ? "on" : ""} disabled={!view} onClick={() => { setTab("label"); setHome(false); }}><Icon name="label" /> Label</button>
          <button className={tab === "phase" && !home ? "on" : ""} disabled={!view} onClick={() => { setTab("phase"); setHome(false); }}><Icon name="chart" /> Phase{view && view.flag_count > 0 && <span className="count">{view.flag_count}</span>}</button>
          <button className={tab === "images" ? "on" : ""} onClick={() => { setTab("images"); setShowKeys(false); }}><Icon name="folder" /> Images</button>
        </nav>
        <div className="top-actions">
          <IconButton icon="folder" label={ws.opening ? "Opening video…" : "Open video"} onClick={() => void chooseVideo()} disabled={ws.opening} />
          <button onClick={() => { setPlayback(STOPPED); setShowLink(true); }} disabled={ws.opening}>Open link</button>
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
              <IconButton icon="fire" label="Optional automation tools" onClick={() => {setPlayback(STOPPED);setShowAutomation(true);}}>Auto label</IconButton>
              <IconButton icon="settings" label="Settings" onClick={() => setShowSettings(true)} />
            </div>
          )}
          <IconButton icon="info" label="Credits" onClick={() => setShowCredits(true)} />
        </div>
      </header>

      <ToolSetupNotice backend={backend} />
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
        <PhaseTab key={ws.videoPath} videoKey={ws.videoPath} backend={backend} view={view} version={ws.version} onJump={jumpToLabel} />
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
            <VideoPane key={ws.videoPath} videoKey={ws.videoPath} backend={backend} view={view} atlasFilter={atlasFilter} atlasEdges={atlasEdges} onAnimationStart={() => setPlayback(STOPPED)} previewRef={videoPreviewRef} onPreviewChange={setPreviewSprite} onMatchCandidate={stageSprite} onStep={(frames) => { setPlayback(STOPPED); void act({ type: "step", frames }); }} onError={(m) => console.error(m)} />
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
          <aside className="right">
            <div className="pick-state">
              <IconButton icon="layers" label={`Toggle candidate sheet · current sheet ${candidatePick?.sheet ?? view.pick.sheet}`} className={candidatePick?.sheet === 1 ? "on" : ""} onClick={() => stageSprite({ sheet: (1 - (candidatePick?.sheet ?? view.pick.sheet)) as 0 | 1, row: candidate && isFire(candidate.label) ? candidate.label.fire.row : 0, mirrored: candidatePick?.mirrored ?? view.pick.mirrored })} title="Switch between fire sheets 0 and 1 · T · selects a candidate; Confirm saves">
                {candidatePick?.sheet ?? view.pick.sheet}
              </IconButton>
              <IconButton icon="mirror" label="Mirror candidate" aria-pressed={candidatePick?.mirrored ?? view.pick.mirrored} className={candidatePick?.mirrored ? "on" : ""} onClick={() => stageSprite({ sheet: (candidatePick?.sheet ?? view.pick.sheet) as 0 | 1, row: candidate && isFire(candidate.label) ? candidate.label.fire.row : 0, mirrored: !(candidatePick?.mirrored ?? view.pick.mirrored) })} title="Flip the candidate sprite horizontally · R · Confirm saves">
                {candidatePick?.mirrored ? "mirrored" : "normal"}
              </IconButton>
              <IconButton icon="skip" label="Choose skip" onClick={() => { setPlayback(STOPPED); setDraft({ frame: view.current, label: "skip", origin: "picked" }); }} title="Mark this frame to skip · Shift+X · then Confirm" />
              <IconButton icon="erase" label="Clear label" onClick={() => void act({ type: "clear" })} title="Remove this frame's saved label immediately, making it unreviewed · Backspace · Undo restores it" />
            </div>
            <div className="candidate-panel">
              <div className="candidate-heading"><strong>Candidate</strong><span>{candidate?.origin === "guess" ? "time guess · not saved" : candidate?.origin === "saved" ? "current saved label" : "not saved"}</span></div>
              <div className="candidate-value">{draft?.frame === view.current && draft.label === "unset" ? `Invalid animation index ${draft.digits} (use 0–31)` : candidateText(candidate?.label ?? null)}{draft?.digits?.length === 1 && draft.frame === view.current && Number(draft.digits) <= 3 && <span className="dim"> · {draft.digits}_</span>}</div>
              <div className="candidate-actions">
                <IconButton icon="check" label="Confirm candidate" className="confirm-label" disabled={!candidateConfirmation(candidate) || ws.opening || ws.transferring} onClick={confirmCandidate} title="Confirm this candidate · Enter · saves and advances">Confirm <kbd>↵</kbd></IconButton>
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
              <Picker
                onEdgesChange={setAtlasEdges}
                onNoFire={() => { setPlayback(STOPPED); setDraft({ frame: view.current, label: "no_fire", origin: "picked" }); }}
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
              <kbd>{k}</kbd> {d}
            </div>
          ))}
        </div>
      )}
      {showSettings && <SettingsPanel settings={ws.settings} onSet={ws.setSetting} onClose={() => setShowSettings(false)} />}
      {showCredits && <Credits onClose={() => setShowCredits(false)} />}
      {showLink && <OpenLink backend={backend} initialUrl={/^https?:\/\//i.test(path.trim()) ? path : ""} onClose={() => setShowLink(false)} onOpen={async downloaded => { setShowLink(false); await openVideo(downloaded); }} />}
      {showAutomation && view && <AutomationTools key={ws.videoPath} backend={backend} videoPath={ws.videoPath} onApply={ws.applyAutomation} onClose={()=>setShowAutomation(false)} />}
    </div>
  );
}
