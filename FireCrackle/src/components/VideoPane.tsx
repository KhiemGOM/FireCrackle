import {useUndoState} from "../hooks/useUndoState";
import type {LabelUndo} from "../lib/labelUndo";
import {ANIMATION_ATLASES,soulFire,type AnimationAtlas} from "../lib/animationAtlases";
import { useEffect, useImperativeHandle, useRef, useState, type PointerEvent, type Ref } from "react";
import { useWheel } from "../hooks/useWheel";
import type { Backend, View } from "../lib/api";
import { IDENTITY, clampView, panView, rotateView, wheelFactor, zoomAt, type Box, type ViewXform } from "../lib/zoom";
import { isFire, type Label } from "../lib/grid";
import { formatTimecode } from "../lib/timecode";
import { HudOverlay } from "./HudOverlay";
import { hudRowFromLabel, stepHudRow } from "../lib/hudOverlay";
import { FireQuadMask } from "./FireQuadMask";
import { Fire3DOverlay } from "./Fire3DOverlay";
import { Fire3DBar } from "./Fire3DBar";
import { Fire3DWorldPane } from "./Fire3DWorldPane";
import { useFire3D } from "../lib/useFire3D";
import { IconButton } from "./Icon";
import { DEFAULT_QUAD, type ManualQuad } from "../lib/quadMask";
import { readFrameQuads, recalledQuad, rememberQuad, sameQuad, writeFrameQuads } from "../lib/frameQuads";
import { framePreview, previewSprite, spriteWithSheet, labelSprite, type PreviewSprite } from "../lib/firePreview";
import { compressionGeometry } from "../lib/compressionPreview";
import { readMaskState, writeMaskState, type MaskState } from "../lib/maskState";
import { parallelizeQuad } from "../lib/quadTransform";
import { QuadMatchControls } from "./QuadMatchControls";
import {refineFireQuads} from "../lib/quadRefine";
import { VideoRuler } from "./VideoRuler";
import { DEFAULT_RULER, readRuler, rulerUnit, scaleRulerUnit, writeRuler, type RulerState } from "../lib/ruler";
import type { AtlasEdges, EdgeFilter } from "../lib/atlasFilter";
import { AnimationControls } from "./AnimationControls";
import { readPreferences, writePreferences } from "../lib/preferences";
import { readVideoView, writeVideoView } from "../lib/viewState";
import { OpacityControl } from "./OpacityControl";
import { scopedStorage } from "../lib/scopedStorage";
import { VideoRotation } from "./VideoRotation";
import { copyFormattedComparisonProof, downloadComparisonProof, type ProofMask, type ProofAction } from "../lib/comparisonProof";
import { ComparisonProofButton } from "./ComparisonProofButton";
import { spriteText } from "../lib/labelCandidate";
import { DEFAULT_VEIL_OPTIONS, VEIL_MODES, type VeilMode, type VeilOptions } from "../lib/veil";
import { exactFrameBytes, nativeFrame, pngSize, showsExactFrame } from "../lib/exactFrame";
import { canvasFrameIo, losslessFrameIo, processFrame } from "../lib/veilFrame";
import { portalPreview, guiScreenCoverage, guiWorldCoverage } from "../lib/portalPreview";
import { correctFrame } from "../lib/comparisonPost";
import { enhance, hasEnhancement } from "../lib/post/pipeline";
import type { PostSettings } from "../lib/post/settings";
import type { PortalMode } from "../lib/portal";
import { GuiMaskOverlay, GuiMaskPanel, useGuiMask } from "./GuiMaskControls";
import { GUI_ASSUMPTION, veilScreenEvidence } from "../lib/guiMask";
import { JumpBox } from "./JumpBox";
import { DEFAULT_BUFFER_SETTINGS, FrameBuffer, type BufferSettings } from "../lib/frameBuffer";
import { domBufferIo } from "../lib/frameBufferDom";
import {previewFrames} from "../lib/guiThumbnailCache";
import {photoPreview} from "../lib/imagePreview";
import { shouldShowLate } from "../lib/lateFrame";
import { correctsNow } from "../lib/correctionGate";
import { dispatchToolKey, resetToolKeys, type ToolAction } from "../lib/toolKeys";
import { blocksVideoToolKeys, focusVideoViewport, videoToolContextAvailable } from "../lib/shortcutFocus";
import { failureMessage } from "../lib/appErrors";

export interface VideoPreviewHandle {
  /** True when an enabled preview consumes the selection without a label write. */
  selectSprite: (sprite: PreviewSprite) => boolean;
  /** The user confirmed this frame: keep where the quad mask sits on it, so showing it again puts the mask back. */
  rememberQuad: () => void;
}

export function describeLabel(label: Label): string {
  if (label === "unset") return "unlabelled";
  if (label === "no_fire") return "no fire";
  if (label === "skip") return "skipped";
  if("no_texture" in label)return `No ${ANIMATION_ATLASES[label.no_texture.atlas].name.toLowerCase()}`;
  if("fire_pair" in label)return `Fire row ${label.fire_pair.normal.row} · Soul fire row ${label.fire_pair.soul.row}${label.fire_pair.normal.row===label.fire_pair.soul.row?"":" · CONFLICT"}`;
  if("texture" in label)return spriteText({...label.texture,sheet:label.texture.atlas.endsWith("_0")?0:1});
  const { sheet, row, mirrored } = label.fire;
  return `row ${row} · sheet ${sheet} · ${mirrored ? "mirrored" : "normal"}`;
}

function labelClass(label: Label): string {
  if(typeof label==="object"&&"no_texture" in label)return "skip";
  if (isFire(label)||typeof label==="object") return "fire";
  return label;
}

interface Props {
  undoHistory?: LabelUndo;
  firstPersonAllowed?: boolean;
  stillImage?: { name: string; url: string; file?: Blob };
  storageScope?: string;
  stateStorage?: Pick<Storage, "getItem" | "setItem">;
  atlasEdges?: AtlasEdges | null;
  onAnimationStart?: () => void;
  videoKey?: string;
  atlasFilter?: EdgeFilter;
  backend: Backend;
  view: View;
  onError: (message: string) => void;
  /** The image element finished loading this frame; media time may advance. */
  onFramePresented?: (frame: number) => void;
  previewRef?: Ref<VideoPreviewHandle>;
  onPreviewChange?: (sprite:PreviewSprite|null)=>void;
  onMatchCandidate?: (sprite:PreviewSprite)=>void;
  onStep?: (frames: number) => void;
  /** Jump to a frame typed in the status bar (a frame number or HH:MM:SS|FF). */
  onGoTo?: (frame: number) => void;
  /** Which way the video is playing and how fast (the look-ahead buffer follows it). */
  motion?: { dir: -1 | 0 | 1; speed: number };
  /** The `label.buffer_*` settings. */
  bufferSettings?: BufferSettings;
  /** Thresholds for undoing the GUI veil (the settings); the validated defaults when absent. */
  veil?: VeilOptions;
  /** The post-processing settings the picture is drawn with (the Enhance panel). When given, veil and portal come from them and this pane shows no selects of its own. */
  post?: PostSettings;
  /** Reports what the portal stage found, so the Enhance panel can show it. */
  onPortalStatus?: (status: string) => void;
  /** Reports the phase and opacity the automatic portal fit found, so the Enhance panel can start the manual values from them. */
  onPortalFit?: (fit: { phase: number; opacity: number }) => void;
}

/** The current frame, with its number, time and label over it. */
export function VideoPane({ undoHistory, firstPersonAllowed = true, backend, view, onError, onFramePresented, previewRef, onPreviewChange, onMatchCandidate, onStep, onGoTo, motion, bufferSettings, atlasFilter, videoKey, atlasEdges = null, onAnimationStart, stillImage, storageScope, stateStorage, veil, post, onPortalStatus, onPortalFit }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [shown, setShown] = useState<number | null>(null);
  const token = useRef(0);
  const urlRef = useRef<string | null>(null);
  // the object URL of the lossless full-resolution frame, while it is the picture shown
  const exactRef = useRef<string | null>(null);
  // true while `url` is an object URL of the frame buffer (the buffer revokes it, not this component)
  const urlFromBuffer = useRef(false);
  // the frame on screen and the playhead as the loaders see them (a load that finishes late asks whether it still counts)
  const shownRef = useRef<number | null>(null);
  const currentRef = useRef(view.current);
  currentRef.current = view.current;
  // Frames are fetched and decoded ahead of the playhead (lib/frameBuffer.ts); the readout shows what playback did.
  const motionRef = useRef({ dir: 0 as -1 | 0 | 1, speed: 1 });
  motionRef.current = { dir: motion?.dir ?? 0, speed: motion?.speed ?? 1 };
  // corrections (veil, portal, Enhance) and the GUI mask are for a paused picture: while playing they cannot keep up and
  // every corrected frame would be too late to show (lib/correctionGate.ts)
  const playing = (motion?.dir ?? 0) !== 0;
  const bufferWanted = bufferSettings ?? DEFAULT_BUFFER_SETTINGS;
  const bufferKey = `${bufferWanted.ahead}|${bufferWanted.behind}|${bufferWanted.decodeAhead}|${bufferWanted.parallel}`;
  // created in an effect, not memoised: React StrictMode runs an effect's cleanup before its second run
  const [buffer, setBuffer] = useState<FrameBuffer | null>(null);
  const toolStorage = storageScope ? scopedStorage(storageScope, stateStorage) : stateStorage;
  const restored = useRef<MaskState | null>(null);
  if (!restored.current) restored.current = readMaskState(toolStorage);
  const saved = restored.current;
  const [hudRequested, setHudEnabled] = useUndoState(saved.hudEnabled,undoHistory,'video.hudRequested');
  const hudEnabled = firstPersonAllowed && hudRequested;
  const [hudRow, setHudRow] = useUndoState(saved.hudRow,undoHistory,'video.hudRow');
  const [hudFov, setHudFov] = useUndoState(saved.hudFov,undoHistory,'video.hudFov');
  const [manualEnabled, setManualEnabled] = useUndoState(saved.manualEnabled,undoHistory,'video.manualEnabled');
  const [manualQuad, setManualQuad] = useUndoState<ManualQuad>(saved.manualQuad,undoHistory,'video.manualQuad');
  const [manualSheet, setManualSheet] = useUndoState<0 | 1>(saved.manualSheet,undoHistory,'video.manualSheet');
  const [manualRow, setManualRow] = useUndoState(saved.manualRow,undoHistory,'video.manualRow');
  const [manualAtlas,setManualAtlas]=useUndoState<AnimationAtlas|undefined>(saved.manualAtlas,undoHistory,'video.manualAtlas');
  const manualRows=manualAtlas?ANIMATION_ATLASES[manualAtlas].rows:32;
  const [manualMirrored, setManualMirrored] = useUndoState(saved.manualMirrored,undoHistory,'video.manualMirrored');
  const [manualOpacity, setManualOpacity] = useUndoState(saved.manualOpacity,undoHistory,'video.manualOpacity');
  const [pixelGrid, setPixelGrid] = useUndoState(saved.pixelGrid,undoHistory,'video.pixelGrid');
  const [compressionEnabled, setCompressionEnabled] = useUndoState(saved.compressionEnabled,undoHistory,'video.compressionEnabled');
  const [compressionHeight, setCompressionHeight] = useUndoState(saved.compressionHeight,undoHistory,'video.compressionHeight');
  const [compressionQuality, setCompressionQuality] = useUndoState(saved.compressionQuality,undoHistory,'video.compressionQuality');
  const [hudOpacity, setHudOpacity] = useUndoState(saved.hudOpacity,undoHistory,'video.hudOpacity');
  useEffect(() => {
    writeMaskState({ hudEnabled, hudRow, hudFov, hudOpacity, manualEnabled, manualQuad, manualSheet, manualAtlas, manualRow, manualMirrored, manualOpacity, pixelGrid, compressionEnabled, compressionHeight, compressionQuality }, toolStorage);
  }, [hudEnabled, hudRow, hudFov, hudOpacity, manualEnabled, manualQuad, manualSheet, manualAtlas, manualRow, manualMirrored, manualOpacity, pixelGrid, compressionEnabled, compressionHeight, compressionQuality]);
  useEffect(() => {
    if (!manualEnabled && !hudEnabled) return;
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.defaultPrevented || e.isComposing || !videoToolContextAvailable(frameRef.current, document)) return;
      const shortcut = e.key.toLowerCase();
      if (!["p", "e"].includes(shortcut) || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat || blocksVideoToolKeys(target)) return;
      if (shortcut === "p" && !manualEnabled) return;
      e.preventDefault();
      if (shortcut === "e") (manualEnabled ? setManualOpacity : setHudOpacity)(current => current > 0 ? 0 : 1);
      else setManualQuad(parallelizeQuad);
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [manualEnabled, hudEnabled]);
  useEffect(()=> {
    onPreviewChange?.(manualEnabled?{...(manualAtlas?{atlas:manualAtlas}:{}),sheet:manualSheet,row:manualRow,mirrored:manualMirrored}
      :hudEnabled?{sheet:1,row:hudRow,mirrored:false}:null);
  },[manualEnabled,manualSheet,manualAtlas,manualRow,manualMirrored,hudEnabled,hudRow,onPreviewChange]);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const labelRow = hudRowFromLabel(view.label);
  const delivery = imageSize.width > 0 ? compressionGeometry(imageSize.width,imageSize.height,compressionHeight,manualQuad) : null;
  const restoredRuler = useRef<RulerState | null>(null);
  if (!restoredRuler.current) restoredRuler.current = readRuler(toolStorage);
  const [ruler, setRuler] = useUndoState(restoredRuler.current,undoHistory,'video.ruler');
  const unitPixels = rulerUnit(ruler.points, imageSize.width, imageSize.height);
  useEffect(() => { writeRuler(ruler, toolStorage); }, [ruler]);
  const resizeRulerUnit = (pixels: number) => setRuler(current => ({ ...current, points: scaleRulerUnit(current.points, pixels, imageSize.width, imageSize.height) }));
  const [rulerSelected, setRulerSelected] = useState(false);
  const [matchingEnabled, setMatchingEnabled] = useUndoState(saved.manualEnabled && readPreferences(toolStorage).matchOpen,undoHistory,'video.matchingEnabled');
  useEffect(() => { writePreferences({ matchOpen: matchingEnabled }, toolStorage); }, [matchingEnabled]);
  const [animationOpen, setAnimationOpen] = useUndoState(saved.manualEnabled && readPreferences(toolStorage).animationOpen,undoHistory,'video.animationOpen');
  const [animationStop, setAnimationStop] = useState(0);
  useEffect(() => { writePreferences({ animationOpen }, toolStorage); }, [animationOpen]);
  const [ownVeilMode, setVeilMode] = useUndoState<VeilMode>(() => readPreferences(toolStorage).veilMode,undoHistory,'video.ownVeilMode');
  useEffect(() => { writePreferences({ veilMode: ownVeilMode }, toolStorage); }, [ownVeilMode]);
  const [veilApplied, setVeilApplied] = useState(false);
  const [ownPortalMode, setPortalMode] = useUndoState<PortalMode>(() => readPreferences(toolStorage).portalMode,undoHistory,'video.ownPortalMode');
  useEffect(() => { writePreferences({ portalMode: ownPortalMode }, toolStorage); }, [ownPortalMode]);
  const [portalStatus, setPortalStatus] = useState("");
  // with post-processing settings the Enhance panel decides; without them the two selects below do
  const veilMode = post ? post.veil : ownVeilMode;
  const portalMode = post ? post.portal : ownPortalMode;
  const enhanceOn = !!post && hasEnhancement(post);
  const enhanceKey = enhanceOn ? JSON.stringify([post!.order, post!.stages]) : "";
  const manualPortal = post && post.portal === "manual" ? post.portalManual : undefined;
  const portalManualKey = manualPortal ? `${manualPortal.phase}|${manualPortal.opacity}` : "";
  const [enhanceApplied, setEnhanceApplied] = useState(false);
  const reportPortalStatus = (status: string) => { setPortalStatus(status); onPortalStatus?.(status); };
  // GUI mask: videos only (photos have no project to keep the vanilla answer in)
  const [guiMaskOn, setGuiMaskOn] = useUndoState(false,undoHistory,'video.guiMaskOn');
  const guiMask = useGuiMask(backend, view.current, !stillImage && !playing && shown === view.current && !!url, (guiMaskOn || portalMode === "auto" || veilMode === "auto") && !stillImage);
  const veilOptions = veil ?? DEFAULT_VEIL_OPTIONS;
  const veilKey = `${veilOptions.minShare}|${veilOptions.margin}|${veilOptions.slack}`;

  // the four tools, shared by the buttons and the keys (Q, H, M, U; M then 1-3)
  const [findToken, setFindToken] = useState(0);
  const [matchPick, setMatchPick] = useState<{ index: number; n: number } | null>(null);
  const [refineBusy,setRefineBusy]=useState<string|null>(null);
  const [refineStatus,setRefineStatus]=useState<{key:string;text:string}|null>(null);
  const refineAbort=useRef<AbortController|null>(null);
  const alignmentKey=(q:ManualQuad)=>JSON.stringify([url,view.current,shown,playing,manualEnabled,manualAtlas,manualSheet,manualRow,manualMirrored,q]);
  const refineKey=alignmentKey(manualQuad),refineLatest=useRef(refineKey);refineLatest.current=refineKey;
  const canRefine=manualEnabled&&(!manualAtlas||soulFire(manualAtlas))&&!!url&&shown===view.current&&!playing;
  useEffect(()=>()=>{refineAbort.current?.abort();},[refineKey]);
  async function sourceForMatch(signal:AbortSignal):Promise<{url:string;dispose?:()=>void}> {
    if(stillImage)return {url:stillImage.url};
    const {bytes}=buffer?await buffer.load(view.current,signal):{bytes:await backend.frame(view.current)};
    if(signal.aborted)throw new DOMException("Alignment cancelled","AbortError");
    const original=URL.createObjectURL(new Blob([bytes],{type:"image/jpeg"}));
    return {url:original,dispose:()=>URL.revokeObjectURL(original)};
  }
  async function refineSelected() {
    if(!canRefine||refineBusy===refineKey)return;
    refineAbort.current?.abort();const controller=new AbortController();refineAbort.current=controller;
    const start=refineKey;setRefineBusy(start);let source:{url:string;dispose?:()=>void}|undefined;
    try{
      source=await sourceForMatch(controller.signal);
      const [answer]=await refineFireQuads(source.url,[{quad:manualQuad,sprite:{atlas:manualAtlas,sheet:manualSheet,row:manualRow,mirrored:manualMirrored}}],manualAtlas&&soulFire(manualAtlas)?"soul":"normal",controller.signal);
      if(controller.signal.aborted||refineLatest.current!==start)return;
      if(answer.changed)setManualQuad(answer.quad);
      setRefineStatus({key:alignmentKey(answer.quad),text:answer.changed?"Alignment refined":"Alignment unchanged"});
    }catch(error){if(!controller.signal.aborted&&refineLatest.current===start)onError(`Refine alignment: ${failureMessage(error)}`);}
    finally{source?.dispose?.();if(refineAbort.current===controller)setRefineBusy(null);}
  }
  function toggleRuler() { setRuler(current => ({ ...current, enabled: !current.enabled })); }
  useEffect(() => { if (!firstPersonAllowed) { if(undoHistory)undoHistory.ignore(()=>setHudEnabled(false));else setHudEnabled(false); } }, [firstPersonAllowed]);
  function toggleFirstPerson() {
    if (!firstPersonAllowed) return;
    setAnimationOpen(false);
    setMatchingEnabled(false);
    setHudEnabled(!hudEnabled);
    if (!hudEnabled) { setManualAtlas(undefined); setManualEnabled(false); const next = framePreview(view); if (next) setHudRow(next.row); }
  }
  function toggleQuad() {
    setManualEnabled(!manualEnabled);
    if (!manualEnabled) setFire3dOn(false);
    if (manualEnabled) setMatchingEnabled(false);
    if (manualEnabled) setAnimationOpen(false);
    if (!manualEnabled) { setHudEnabled(false); const next = framePreview(view); if (next) { setManualAtlas(next.atlas); setManualSheet(next.sheet); setManualRow(next.row); setManualMirrored(next.mirrored); } }
  }
  function toggleMatcher() {
    if(manualAtlas&&!soulFire(manualAtlas))return;
    if (!matchingEnabled) setAnimationOpen(false);
    setMatchingEnabled(!matchingEnabled);
    if (!matchingEnabled) { setManualEnabled(true); setHudEnabled(false); }
  }
  /** M toggles the matcher; opening also asks for the first match run. */
  function runMatcher() {
    if(manualAtlas&&!soulFire(manualAtlas))return;
    if (matchingEnabled) { setMatchingEnabled(false); return; }
    if (!matchingEnabled) { setAnimationOpen(false); setMatchingEnabled(true); setManualEnabled(true); setHudEnabled(false); }
    setFindToken(n => n + 1);
  }
  /** 3D quad: its own tool, drawing its own textured planes instead of the quad mask (they share the sprite). */
  function toggleFire3d() {
    const next = !fire3dOn;
    setFire3dOn(next);
    if (!next) return;
    if (!manualEnabled) { const p = framePreview(view); if (p) { setManualAtlas(p.atlas); setManualSheet(p.sheet); setManualRow(p.row); setManualMirrored(p.mirrored); } }
    setManualEnabled(false); setMatchingEnabled(false); setAnimationOpen(false); setHudEnabled(false);
  }
  const runTool = (action: ToolAction) => {
    if (action.type === "quad") toggleQuad();
    else if (action.type === "firstPerson") toggleFirstPerson();
    else if (action.type === "matcher") runMatcher();
    else if (action.type === "ruler") toggleRuler();
    else if (action.type === "fire3d") toggleFire3d();
    else if (action.type === "refine") void refineSelected();
    else setMatchPick(current => ({ index: action.index, n: (current?.n ?? 0) + 1 }));
  };
  const toolsRef = useRef(runTool);
  toolsRef.current = runTool;
  useEffect(() => {
    const handle = (type: "down" | "up") => (e: KeyboardEvent) => {
      // a release always counts (a held M must never get stuck); a press only when this pane is showing and no dialog is open
      const pane = frameRef.current;
      if (type === "down" && (e.defaultPrevented || e.isComposing || !videoToolContextAvailable(pane, document))) return;
      const target = e.target as HTMLElement | null;
      const result = dispatchToolKey({ key: e.key, type, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, shiftKey: e.shiftKey, repeat: e.repeat,
        targetEditable: blocksVideoToolKeys(target) });
      if (!result.consumed) return;
      e.preventDefault();
      e.stopPropagation();
      if (result.action) toolsRef.current(result.action);
    };
    const down = handle("down"), up = handle("up");
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", resetToolKeys); // the release of a held M may never arrive
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", resetToolKeys);
      resetToolKeys();
    };
  }, []);

  function selectPreview(sprite: PreviewSprite): boolean {
    setAnimationStop(value => value + 1);
    const mode = sprite.atlas || manualEnabled ? "manual" : hudEnabled ? "firstPerson" : "none";
    if(sprite.atlas){setManualEnabled(true);setHudEnabled(false);setMatchingEnabled(false);setAnimationOpen(false);}
    const next = previewSprite(mode, sprite);
    if (!next) return false;
    if (mode === "manual") {
      setManualAtlas(next.atlas);
      setManualSheet(next.sheet);
      setManualRow(next.row);
      setManualMirrored(next.mirrored);
    } else setHudRow(next.row);
    return true;
  }
  // Where the quad mask was when each frame was confirmed (video frames only; a photo has no such history).
  const frameQuads = useRef<Map<number, ManualQuad> | null>(null);
  if (!frameQuads.current) frameQuads.current = readFrameQuads(stillImage ? undefined : videoKey, toolStorage);
  const quadNow = useRef({ frame: view.current, quad: manualQuad, enabled: manualEnabled });
  quadNow.current = { frame: view.current, quad: manualQuad, enabled: manualEnabled };
  function rememberCurrentQuad() {
    const now = quadNow.current;
    if (stillImage || !now.enabled) return;
    frameQuads.current = rememberQuad(frameQuads.current ?? new Map(), now.frame, now.quad);
    writeFrameQuads(videoKey, frameQuads.current, toolStorage);
  }
  useImperativeHandle(previewRef, () => ({ selectSprite: selectPreview, rememberQuad: rememberCurrentQuad }));

  const previousFrame = useRef(view.current);
  useEffect(() => {
    if (previousFrame.current === view.current) return;
    previousFrame.current = view.current;
    const next = framePreview(view);
    if (next) { if(undoHistory)undoHistory.ignore(()=>selectPreview(next));else selectPreview(next); }
  }, [view.current, view.suggestion, view.label, manualEnabled, hudEnabled]);

  // (declared here, after the first effects: VideoPane.interaction.test picks those by position)
  useEffect(() => {
    if (stillImage) { setBuffer(null); return; }
    const created = new FrameBuffer(view.frame_count, domBufferIo((n) => backend.frame(n)), bufferWanted);
    setBuffer(created);
    return () => created.dispose();
  }, [backend, videoKey, view.frame_count, !!stillImage]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { buffer?.setSettings(bufferWanted); }, [buffer, bufferKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const mine = ++token.current;
    const cancel = new AbortController();
    // a paused, uncorrected picture is then replaced by the lossless full-resolution frame
    // a paused video frame is then replaced by the lossless full-resolution frame; corrections run again on it
    const upgrade = (frame: number, correcting: boolean) => {
      if (!backend.exactFrame || !showsExactFrame({ playing, stillImage: !!stillImage, corrected: false })) return;
      void exactFrameBytes({ frame, load: backend.exactFrame, signal: cancel.signal, isCurrent: () => mine === token.current && shownRef.current === frame }).then(async bytes => {
        const size = bytes && pngSize(bytes);
        if (!bytes || !size) return;
        const png = new Blob([bytes], { type: "image/png" });
        const made = correcting ? await correct(bytes, png, losslessFrameIo, size) : null;
        if (mine !== token.current || shownRef.current !== frame) return;
        present(made ?? { blob: png, applied: false }, true);
      });
    };
    const guiCoverage = stillImage ? undefined : guiWorldCoverage(guiMask, view.current), guiReady = !!guiCoverage;
    const screenCoverage = stillImage ? undefined : guiScreenCoverage(guiMask, view.current);
    const correcting = correctsNow({ playing, veilMode, portalMode, enhance: enhanceOn });
    const runPortal = portalMode !== "off" && correcting;
    let guiProtected = false;
    if (runPortal) reportPortalStatus(guiReady && portalMode === "auto" ? "Checking portal · GUI protected…" : "Checking portal · entire frame…");
    else reportPortalStatus(playing && portalMode !== "off" ? "Applied when playback is paused" : "");
    // Small cached placeholders first; tools keep waiting for the original frame.
    let quickReady: Promise<void> | null = null;
    if (!playing && shownRef.current !== view.current && (stillImage?.file || (!stillImage && backend.previewThumbnail && !buffer?.has(view.current)))) {
      const quick = stillImage?.file ? photoPreview(stillImage.file, 512) : previewFrames(backend).get(view.current, () => mine === token.current);
      quickReady = quick.then(preview => {
        if (mine !== token.current || shownRef.current === view.current) return;
        const old=urlRef.current,fromBuffer=urlFromBuffer.current;
        urlRef.current=preview;urlFromBuffer.current=false;shownRef.current=null;
        setUrl(preview);setShown(null);
        if(old&&!fromBuffer)URL.revokeObjectURL(old);
      }).catch(()=>{});
    }
    if (stillImage && veilMode === "off" && portalMode === "off" && !enhanceOn) {
      const showOriginal=()=>{
        if(mine!==token.current)return;
        if(urlRef.current&&!urlFromBuffer.current)URL.revokeObjectURL(urlRef.current);
        urlRef.current=null;urlFromBuffer.current=false;shownRef.current=view.current;
        setUrl(stillImage.url);setShown(view.current);setVeilApplied(false);setEnhanceApplied(false);
      };
      if(quickReady)void quickReady.then(() => new Promise<void>(resolve => {
        const image=new Image();image.onload=()=>resolve();image.onerror=()=>resolve();image.src=stillImage.url;
      })).then(showOriginal);else showOriginal();
      return () => { ++token.current; cancel.abort(); };
    }
    if (!stillImage && buffer) {
      buffer.prefetch(view.current, motionRef.current);
      if (!correcting) {
        // no picture correction: show the frame buffer's own, already decoded, object URL
        const frame = view.current;
        const loadFull=()=>{
          if(cancel.signal.aborted)return Promise.reject(new Error("cancelled"));
          return buffer.load(frame,cancel.signal);
        };
        loadFull().then(() => {
          // the playhead moved on while this frame was on its way: it is still shown when it is newer than the picture
          // on screen and not too far behind (lib/lateFrame.ts), so a slow moment slows the picture, not freezes it
          const late = mine !== token.current;
          if (late && !shouldShowLate({ frame, shown: shownRef.current, current: currentRef.current, dir: motionRef.current.dir, maxLag: bufferWanted.lateShow ?? 0 })) return;
          const next = buffer.urlFor(frame);
          if (!next) return;
          buffer.show(frame);
          const old = urlRef.current, oldFromBuffer = urlFromBuffer.current;
          urlRef.current = next; urlFromBuffer.current = true;
          shownRef.current = frame;
          setUrl(next); setShown(frame); setVeilApplied(false); setEnhanceApplied(false);
          if (old && !oldFromBuffer) URL.revokeObjectURL(old);
          if (!late) upgrade(frame, false);
        }).catch((e) => mine === token.current && onError(`Could not decode frame ${frame}: ${failureMessage(e)}`));
        return () => { ++token.current; cancel.abort(); };
      }
    }
    // Undo veil and portal and enhance one picture. `size` is a full-resolution picture's: the GUI mask and screen
    // evidence, made from the scaled display frame, are stretched to it (another shape gets none).
    // the shared correction (lib/comparisonPost.ts correctFrame), with this frame's GUI mask fitted to the picture
    async function correct(bytes: ArrayBuffer, original: Blob, io: typeof canvasFrameIo, size?: { width: number; height: number }) {
      const evidence = guiMask.maskFrame === view.current ? veilScreenEvidence(guiMask.reply) : undefined;
      const made = await correctFrame({ bytes, original, mode: veilMode, veil: veilOptions, io, size, mask: { evidence, gui: guiCoverage, screen: screenCoverage },
        portal: runPortal ? async (image, world) => {
          const fit = await portalPreview(image, cancel.signal, portalMode === "auto" ? world : undefined, manualPortal);
          if (!manualPortal && mine === token.current) onPortalFit?.({ phase: fit.phase, opacity: fit.opacity });
          return fit;
        } : undefined,
        enhance: enhanceOn ? image => enhance(image, post!) : undefined });
      guiProtected = made.guiProtected && portalMode === "auto";
      return made;
    }
    function present(made: Awaited<ReturnType<typeof processFrame>>, exact: boolean) {
      if (made.error) onError(`Picture correction: ${made.error}`);
      if (runPortal) reportPortalStatus(made.error ? "Could not undo portal" : made.portalApplied ? `Portal undone${guiProtected ? " · GUI protected" : " · entire frame"}` : "No confident portal fit");
      const next = URL.createObjectURL(made.blob);
      const old = urlRef.current, oldFromBuffer = urlFromBuffer.current;
      urlRef.current = next; urlFromBuffer.current = false; exactRef.current = exact ? next : null;
      shownRef.current = view.current;
      setUrl(next);
      setShown(view.current);
      setVeilApplied(made.applied);
      setEnhanceApplied(!!made.enhanced);
      if (old && !oldFromBuffer) URL.revokeObjectURL(old);
    }
    // the picture to show: the frame (or photo) as it is, or with the GUI veil undone (the original on any failure)
    const source: Promise<{ bytes: ArrayBuffer; original: Blob; fromBuffer: boolean }> = stillImage
      ? fetch(stillImage.url).then(async (r) => { const original = await r.blob(); return { bytes: await original.arrayBuffer(), original, fromBuffer: false }; })
      : (buffer ? buffer.load(view.current,cancel.signal) : backend.frame(view.current).then(bytes=>({bytes,fromBuffer:false})))
        .then(({ bytes, fromBuffer }) => ({ bytes, original: new Blob([bytes], { type: "image/jpeg" }), fromBuffer }));
    source
      .then(async ({ bytes, original }) => {
        const made = await correct(bytes, original, canvasFrameIo);
        if (mine !== token.current) return; // a newer frame was asked for meanwhile
        present(made, false);
        if (!stillImage) upgrade(view.current, true);
      })
      .catch((e) => mine === token.current && onError(`Could not decode frame ${view.current}: ${failureMessage(e)}`));
    return () => { ++token.current; cancel.abort(); };
  }, [backend, buffer, view.current, stillImage?.url, veilMode, veilKey, portalMode, portalManualKey, enhanceKey, playing, guiMask.maskFrame, guiMask.reply, guiMask.pixels, guiMask.screen]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      if (urlRef.current && !urlFromBuffer.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  // zoom (wheel, around the cursor) and pan (left-drag) of the picture
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [xf, setXf] = useState<ViewXform>(readVideoView(videoKey, stateStorage));
  useEffect(() => { writeVideoView(videoKey, xf, stateStorage); }, [videoKey, xf]);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const boxOf = (): Box => {
    const r = frameRef.current?.getBoundingClientRect();
    return { w: r?.width ?? 0, h: r?.height ?? 0 };
  };

  useWheel(frameRef, (e) => {
    const r = frameRef.current?.getBoundingClientRect();
    if (!r) return false;
    setXf((v) => zoomAt(v, e.clientX - r.left, e.clientY - r.top, wheelFactor(e.deltaY), boxOf()));
    return true;
  });

  // Resize preserves free zoom/pan; only invalid numeric values are repaired.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setXf((v) => clampView(v, boxOf())));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function panDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault(); // Keep native image/text dragging from cancelling pointer capture.
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY };
  }
  function panMove(e: PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    dragRef.current = { x: e.clientX, y: e.clientY };
    setXf((v) => panView(v, dx, dy, boxOf()));
  }
  function panUp() {
    dragRef.current = null;
  }

  const [proofBusy, setProofBusy] = useState(false);
  const [proofCopied, setProofCopied] = useState<string | undefined>(undefined);
  useEffect(() => { if (!proofCopied) return; const timer = setTimeout(() => setProofCopied(undefined), 2000); return () => clearTimeout(timer); }, [proofCopied]);
  // Showing a confirmed frame again (stepping, a jump, pausing on it) puts the quad mask back where it was confirmed.
  // Only when the frame, the mask or playback changes, so dragging the mask on a frame is never undone, and not while
  // playing, where the mask would jump with every frame.
  const recallKey = useRef("");
  useEffect(() => {
    const key = `${view.current}|${manualEnabled}|${playing}`;
    if (recallKey.current === key) return;
    recallKey.current = key;
    if (stillImage || !manualEnabled || playing) return;
    const remembered = recalledQuad(frameQuads.current ?? new Map(), view.current);
    if (!remembered || sameQuad(remembered, manualQuad)) return;
    if (undoHistory) undoHistory.ignore(() => setManualQuad(remembered)); else setManualQuad(remembered);
  }, [view.current, manualEnabled, playing]); // eslint-disable-line react-hooks/exhaustive-deps
  async function comparisonProof(action: ProofAction) {
    if (proofBusy) return;
    setProofBusy(true); setProofCopied(undefined); setAnimationStop(value => value + 1); onAnimationStart?.();
    try {
      const picture = frameRef.current?.querySelector<HTMLImageElement>(".video-zoom > img");
      const svg = frameRef.current?.querySelector<SVGSVGElement>(manualEnabled ? "svg.fire-quad-mask" : "svg.hud-overlay");
      if (!picture || !svg || shown !== view.current || picture.getAttribute("src") !== url) throw Error("Wait for the picture and mask to load.");
      const sprite = manualEnabled ? { atlas: manualAtlas, sheet: manualSheet, row: manualRow, mirrored: manualMirrored } : { sheet: 1, row: hudRow, mirrored: false };
      const xs = manualQuad.map(([x]) => x * imageSize.width), ys = manualQuad.map(([, y]) => y * imageSize.height);
      const mask: ProofMask = { svg, ...(manualEnabled ? {bounds: {x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys)}} : {}), description: `${manualEnabled ? "Quad" : "First-person"} · ${spriteText(sprite)}`,
        opacity: manualEnabled ? manualOpacity : hudOpacity,
        details: manualEnabled ? (compressionEnabled && !manualAtlas ? `H.264 · ${compressionHeight}p` : undefined) : `FOV ${hudFov}°` };
      const source = stillImage?.name ?? `Frame ${view.current} · ${formatTimecode(view.pts, view.fps)}`;
      if (action.destination === "copy") {
        await copyFormattedComparisonProof(picture, [mask], source, action.format);
        setProofCopied("Copied!");
      } else if (await downloadComparisonProof(picture, [mask], source, action.format)) setProofCopied("Saved!");
    } catch (error) { onError(`Comparison proof: ${failureMessage(error)}`); }
    finally { setProofBusy(false); }
  }
  // 3D quad mode of the manual quad: camera from the automatic guess + clicked corners, fire placed in 3D
  const [fire3dOn, setFire3dOn] = useState(false);
  const fire3d = useFire3D(stillImage ? stillImage.url : String(view.current),
    () => stillImage ? (stillImage.file ? Promise.resolve(stillImage.file) : fetch(stillImage.url).then(r => r.blob())) : nativeFrame(backend, view.current),
    fire3dOn, !!manualAtlas && soulFire(manualAtlas));
  const s = view.suggestion;
  // the sprite: shared by the quad mask and the 3D quad
  const spriteControls = <>
          {manualAtlas&&<><strong>{ANIMATION_ATLASES[manualAtlas].name}</strong><button onClick={()=>setManualAtlas(undefined)}>Fire atlas</button></>}
          <label>Sheet <select aria-label="Manual mask sheet" value={manualSheet} onChange={(e) => {const next=spriteWithSheet({atlas:manualAtlas,sheet:manualSheet,row:manualRow,mirrored:manualMirrored},Number(e.target.value) as 0|1);setManualAtlas(next.atlas);setManualSheet(next.sheet);setManualRow(next.row);}}><option value={0}>{manualAtlas?.startsWith("water")||manualAtlas?.startsWith("lava")?"Still":"0"}</option><option value={1}>{manualAtlas?.startsWith("water")||manualAtlas?.startsWith("lava")?"Flowing":"1"}</option></select></label>
          <IconButton icon="left" label="Previous manual mask row" onClick={() => setManualRow((r) => (r-1+manualRows)%manualRows)} />
          <label>Row <input aria-label="Manual mask row" type="number" min={0} max={manualRows-1} value={manualRow} onChange={(e) => { const n = e.target.valueAsNumber; if (Number.isInteger(n) && n >= 0 && n < manualRows) setManualRow(n); }} /></label>
          <IconButton icon="right" label="Next manual mask row" onClick={() => setManualRow((r) => (r+1)%manualRows)} />
          <label><input type="checkbox" checked={manualMirrored} onChange={(e) => setManualMirrored(e.target.checked)} /> Mirrored</label>
          <OpacityControl groupLabel="Mask opacity" toggleLabel="Toggle manual mask opacity"
            sliderLabel="Manual mask opacity" value={manualOpacity} onChange={setManualOpacity} />
          <label><input type="checkbox" checked={pixelGrid} onChange={(e) => setPixelGrid(e.target.checked)} /> Pixel grid</label>
  </>;
  return (
    <div className="video-pane">
      <div className="video-split">
      <div
        className="video-frame zoomed"
        ref={frameRef}
        tabIndex={0}
        role="region"
        aria-label={stillImage ? "Image viewer" : "Video viewer"}
        onPointerDownCapture={e => focusVideoViewport({button: e.button, target: e.target as HTMLElement, currentTarget: e.currentTarget})}
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
        onPointerDown={panDown}
        onPointerMove={panMove}
        onPointerUp={panUp}
        onPointerCancel={panUp}
        onLostPointerCapture={panUp}
        onDoubleClick={() => setXf(IDENTITY)}
        title="scroll to zoom · drag to move · hold Shift for rotation · double-click to reset"
      >
        <div
          className="video-zoom"
          style={{ transform: `translate(${xf.x}px, ${xf.y}px) rotate(${xf.angle ?? 0}deg) scale(${xf.scale})` }}
        >
          {url ? <img src={url} className={playing ? undefined : "crisp"} alt={stillImage?.name ?? `frame ${shown ?? ""}`} onError={() => onError(stillImage ? `Could not open image: ${stillImage.name}` : "Could not display frame")} draggable={false} onLoad={(e) => { setImageSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight }); if (!stillImage && shown !== null && e.currentTarget.getAttribute("src") === urlRef.current) onFramePresented?.(shown); }} /> : <div className="placeholder">decoding…</div>}
          {hudEnabled && shown === view.current && url && imageSize.width > 0 && <HudOverlay {...imageSize} zoom={xf.scale} row={hudRow} fov={hudFov} opacity={hudOpacity} pixelGrid={pixelGrid} />}
          {manualEnabled && shown === view.current && url && imageSize.width > 0 && <FireQuadMask {...imageSize} atlas={manualAtlas} sheet={manualSheet} row={manualRow} mirrored={manualMirrored}
            opacity={manualOpacity} quad={manualQuad} onQuad={setManualQuad} pixelGrid={pixelGrid} zoom={xf.scale}
            placementEnabled={!ruler.enabled || !rulerSelected} frameUrl={url} compression={compressionEnabled && !manualAtlas ? {height:compressionHeight,quality:compressionQuality} : undefined} />}
          {fire3dOn && (stillImage || shown === view.current) && url && imageSize.width > 0 && <Fire3DOverlay fire={fire3d} {...imageSize} zoom={xf.scale}
            sprite={{ atlas: manualAtlas, sheet: manualSheet, row: manualRow, mirrored: manualMirrored, opacity: manualOpacity, pixelGrid }} />}
          {ruler.enabled && url && imageSize.width > 0 && <VideoRuler {...imageSize} zoom={xf.scale} points={ruler.points} locked={ruler.locked} onSelect={setRulerSelected} onChange={points => setRuler(current => ({ ...current, points }))} />}
          {guiMaskOn && !stillImage && <GuiMaskOverlay state={guiMask} frame={view.current} />}
        </div>
        <VideoRotation frameRef={frameRef} onRotate={(degrees, x, y) => setXf(current => rotateView(current, x, y, degrees))} />
        {(xf.scale !== 1 || xf.x !== 0 || xf.y !== 0 || !!xf.angle) && <div className="zoom-tag video-view-controls">
          <span>{Number(xf.scale.toPrecision(3))}×{xf.angle ? ` · ${Number(xf.angle.toFixed(1))}°` : ""} · double-click to reset</span>
          {!!xf.angle && <IconButton icon="reset" label="Reset video rotation" title="Reset video rotation to 0°" onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} onClick={() => setXf(current => rotateView(current, boxOf().w / 2, boxOf().h / 2, -(current.angle ?? 0)))}>Unrotate</IconButton>}
        </div>}
        {shown !== view.current && url && <div className="loading-tag">loading frame {view.current}…</div>}
        {veilApplied && shown === view.current && <div className="veil-tag" title="The darkening behind an open screen is reversed on this picture">GUI veil undone</div>}
        {enhanceApplied && shown === view.current && <div className="veil-tag enhance-tag" aria-label="Picture enhanced" title="Post-processing is applied to this picture; detection and exports use the original frame">Enhanced</div>}
        {!stillImage && <div className={`label-chip ${labelClass(view.label)}`}>{describeLabel(view.label)}</div>}
        {view.typed_pending !== null && <div className="typed-chip">row: {view.typed_pending}_</div>}
        {s && (
          <div className="suggest-chip" title={`Time-based guess from frame ${s.from_frame}; not confirmed`}>
            Time guess · sheet {s.sheet} · row {s.row}
            {s.alt_row !== null && <span className="alt"> (or {s.alt_row})</span>}
            {s.mirrored ? " · mirrored" : ""} · unconfirmed
          </div>
        )}
      </div>
      {fire3dOn && <Fire3DWorldPane fire={fire3d} />}
      </div>
      <div className="hud-controls video-tools" role="group" aria-label={stillImage ? "Image tools" : "Video tools"} onKeyDown={(e) => e.stopPropagation()}>
        <IconButton icon="quad" label="Toggle manual fire quad mask" title="Quad mask · Q" aria-pressed={manualEnabled} aria-expanded={manualEnabled} onClick={toggleQuad}>Quad mask <kbd>Q</kbd></IconButton>
        <IconButton icon="cube" label="Toggle 3D quad" title="3D quad · D: solve the camera from block corners and place the fire in 3D; its planes are drawn with the chosen sprite" aria-pressed={fire3dOn} aria-expanded={fire3dOn} onClick={toggleFire3d}>3D quad <kbd>D</kbd></IconButton>
        <IconButton icon="fire" label="Toggle first-person fire" disabled={!firstPersonAllowed} title={firstPersonAllowed ? "First-person fire · H" : "First-person burning uses normal fire only"} aria-pressed={hudEnabled} aria-expanded={hudEnabled} onClick={toggleFirstPerson}>First-person fire <kbd>H</kbd></IconButton>
        <IconButton icon="zoomIn" label="Toggle sprite matching tool" disabled={!!manualAtlas&&!soulFire(manualAtlas)} title="M: open/find or close matcher · Hold M while opening + 1–3: preview matches" aria-pressed={matchingEnabled} aria-expanded={matchingEnabled} onClick={toggleMatcher}>Match <kbd>M</kbd><kbd>M+1-3</kbd></IconButton>
        <IconButton icon="ruler" label="Toggle calibrated ruler" title="Ruler · U" aria-pressed={ruler.enabled} aria-expanded={ruler.enabled} onClick={toggleRuler}>Ruler <kbd>U</kbd></IconButton>
        <span className="tool-spacer" aria-hidden="true" />
        <IconButton icon="play" label="Toggle sprite animation tool" aria-pressed={animationOpen} aria-expanded={animationOpen} onClick={() => {
          setAnimationOpen(!animationOpen);
          if (!animationOpen) { setManualEnabled(true); setHudEnabled(false); }
        }}>Animation</IconButton>
        {!stillImage && <IconButton icon="layers" label="Toggle GUI mask" title={GUI_ASSUMPTION} aria-pressed={guiMaskOn} aria-expanded={guiMaskOn} onClick={() => setGuiMaskOn(on => !on)}>GUI mask</IconButton>}
        {!post && <label className="veil-mode" title="Reverse the darkening Minecraft draws behind an open screen (pause menu, inventory): Auto preserves detected GUI pixels; Always undo processes every pixel. Thresholds are in Settings.">Veil <select aria-label="Undo GUI veil" value={veilMode} onChange={(e) => setVeilMode(e.target.value as VeilMode)}>{VEIL_MODES.map((m) => <option key={m} value={m}>{m === "off" ? "Off" : m === "auto" ? "Auto-undo" : "Always undo"}</option>)}</select></label>}
        {!post && <label className="veil-mode" title="Assumes portal rendering compatible with vanilla Minecraft 1.16.5. Custom textures or shaders may affect the result. Auto protects GUI pixels when a mask is available; otherwise processes the entire frame. Viewing correction only.">Portal <select aria-label="Undo portal overlay" value={portalMode} onChange={e => setPortalMode(e.target.value as PortalMode)}><option value="off">Off</option><option value="auto">Auto-undo</option></select></label>}
        {!post && portalMode === "auto" && <span className="hud-hint" role="status">{portalStatus}</span>}
        <ComparisonProofButton label="Comparison proof" disabled={!url || shown !== view.current || imageSize.width <= 0 || (!manualEnabled && !hudEnabled)} busy={proofBusy} feedback={proofCopied} onExport={action => void comparisonProof(action)} />
      </div>
      {ruler.enabled && <div className="hud-controls ruler-controls" aria-label="Ruler settings" onKeyDown={(e) => e.stopPropagation()}>
          <label><input type="checkbox" checked={ruler.locked} onChange={e => setRuler(current => ({ ...current, locked: e.target.checked }))} /> Lock unit</label>
          <label>1 unit = <input className="ruler-unit-input" aria-label="Video pixels per ruler unit" type="number" min={0.01} step={0.25} disabled={ruler.locked || unitPixels <= 0} value={unitPixels > 0 ? Number(unitPixels.toFixed(3)) : ""} onChange={e => resizeRulerUnit(e.target.valueAsNumber)} /> video px</label>
          <IconButton icon="zoomOut" label="Shrink ruler unit" disabled={ruler.locked || unitPixels <= 0} onClick={() => resizeRulerUnit(unitPixels / 1.1)} />
          <IconButton icon="zoomIn" label="Enlarge ruler unit" disabled={ruler.locked || unitPixels <= 0} onClick={() => resizeRulerUnit(unitPixels * 1.1)} />
          <IconButton icon="reset" label="Reset ruler calibration" disabled={ruler.locked} onClick={() => setRuler({ ...DEFAULT_RULER, enabled: true })} />
          <span className="hud-hint">Ctrl: lock unit · locked 0: move / 1: rotate · select 0 or 1 + Alt+click: place · drag line: move</span>
      </div>}
      {hudEnabled && <div className="hud-controls" aria-label="First-person fire settings" onKeyDown={(e) => e.stopPropagation()}>
          <IconButton icon="left" label="Previous HUD row" onClick={() => setHudRow((r) => stepHudRow(r, -1))} />
          <label>Row <input aria-label="HUD animation index" type="number" min={0} max={31} value={hudRow} onChange={(e) => { const n = e.target.valueAsNumber; if (Number.isInteger(n) && n >= 0 && n < 32) setHudRow(n); }} /></label>
          <IconButton icon="right" label="Next HUD row" onClick={() => setHudRow((r) => stepHudRow(r, 1))} />
          <IconButton icon="copy" label="Use frame label for first-person preview" disabled={labelRow === null || shown !== view.current} onClick={() => labelRow !== null && setHudRow(labelRow)} />
          <label>FOV <select aria-label="HUD view" value={hudFov} onChange={(e) => setHudFov(Number(e.target.value))}><option value={70}>70° · normal</option><option value={60}>60° · submerged</option></select></label>
          <OpacityControl groupLabel="First-person opacity" toggleLabel="Toggle first-person opacity"
            sliderLabel="First-person fire opacity" value={hudOpacity} onChange={setHudOpacity} />
          <span className="hud-hint">Ctrl+click atlas to preview · follows the next frame's guess</span>
          <label><input type="checkbox" checked={pixelGrid} onChange={(e) => setPixelGrid(e.target.checked)} /> Pixel grid</label>
      </div>}
      {manualEnabled && <div className="hud-controls" aria-label="Quad mask settings" onKeyDown={(e) => e.stopPropagation()}>
          {spriteControls}
          <IconButton icon="reset" label="Reset quad corners" onClick={() => setManualQuad(DEFAULT_QUAD)} />
          <IconButton icon="parallel" label="Make quad a parallelogram" title="Make a parallelogram · P · keeps the center" onClick={() => setManualQuad(parallelizeQuad)} />
          <IconButton icon="fit" label="Refine alignment" title="Refine alignment · G · keeps the selected sprite" disabled={!canRefine||refineBusy===refineKey} aria-busy={refineBusy===refineKey} onClick={()=>void refineSelected()} />
          {refineStatus?.key===refineKey&&<span className="hud-hint" role="status">{refineStatus.text}</span>}
          <label title="FFmpeg encodes all 32 fire rows at their video-relative pixel size on white, using H.264 at 60 fps. Only the extracted fire is displayed. This is a real codec stress test, not YouTube's exact encoding recipe."><input type="checkbox" disabled={!!manualAtlas} checked={compressionEnabled && !manualAtlas} onChange={e=>setCompressionEnabled(e.target.checked)} /> FFmpeg compression</label>
          {compressionEnabled && <>
            <label>Resolution <select aria-label="Compression resolution" value={compressionHeight} onChange={e=>setCompressionHeight(Number(e.target.value))}>
              <option value={2160}>2160p</option><option value={1440}>1440p</option><option value={1080}>1080p</option><option value={720}>720p</option><option value={480}>480p</option><option value={360}>360p</option>
            </select></label>
            <label>Damage <select aria-label="Compression damage" value={compressionQuality} onChange={e=>setCompressionQuality(Number(e.target.value))}>
              <option value={0.8}>Light · CRF 20</option><option value={0.45}>Medium · CRF 28</option><option value={0.15}>Heavy · CRF 36</option><option value={0.05}>Extreme · CRF 42</option>
            </select></label>
            {delivery && <span className="hud-hint">{delivery.width}×{delivery.height} frame · quad ≈{delivery.quadWidth.toFixed(1)}×{delivery.quadHeight.toFixed(1)} px · simulated output pixels · zoom only magnifies</span>}
            <span className="hud-hint">H.264 · 4:2:0 · 60 fps · animated fire on white · extracted mask only</span>
          </>}
          <IconButton icon="copy" label="Use frame label for manual mask" disabled={!labelSprite(view.label)} onClick={() => {const sprite=labelSprite(view.label);if(sprite)selectPreview(sprite);}} />
          <span className="hud-hint">Shift: resize / rotate · P: parallelogram · G: refine alignment · Ctrl+drag: move all · select corner + Alt+click: place</span>
      </div>}
      {fire3dOn && <div className="hud-controls fire3d-controls" aria-label="3D quad settings">
        <Fire3DBar fire={fire3d} sprite={spriteControls} />
      </div>}
      {animationOpen && manualEnabled && <div className="hud-controls" aria-label="Sprite animation settings" onKeyDown={e => e.stopPropagation()}>
        <AnimationControls current={{atlas:manualAtlas,sheet:manualSheet,row:manualRow,mirrored:manualMirrored}} edges={atlasEdges} filter={atlasFilter} frame={view.current} stopToken={animationStop} disabled={shown !== view.current || !url}
          onStart={() => { setMatchingEnabled(false); onAnimationStart?.(); }} onPreview={sprite => { const preview=()=>{setManualAtlas(sprite.atlas);setManualSheet(sprite.sheet);setManualRow(sprite.row);setManualMirrored(sprite.mirrored);};if(undoHistory)undoHistory.ignore(preview);else preview(); }} />
      </div>}
      {matchingEnabled && (!manualAtlas||soulFire(manualAtlas)) && <div className="hud-controls" aria-label="Sprite matching settings" onKeyDown={e=>e.stopPropagation()}>
        {url ? <QuadMatchControls material={manualAtlas&&soulFire(manualAtlas)?"soul":"normal"} frameUrl={url} sourceFrame={sourceForMatch} quad={manualQuad} filter={atlasFilter} disabled={shown!==view.current||playing} runToken={findToken} pick={matchPick} onPreview={candidate=> {
          setManualAtlas(candidate.atlas);setManualSheet(candidate.sheet);setManualRow(candidate.row);setManualMirrored(candidate.mirrored);setManualQuad(candidate.quad);
          onMatchCandidate?.({atlas:candidate.atlas,sheet:candidate.sheet,row:candidate.row,mirrored:candidate.mirrored});
        }} /> : <span className="hud-hint">Open a video to match sprites</span>}
      </div>}
      {guiMaskOn && !stillImage && <div className="hud-controls" aria-label="GUI mask settings" onKeyDown={e => e.stopPropagation()}>
        <GuiMaskPanel state={guiMask} frame={view.current} />
      </div>}
      <div className="video-meta">
        <span className="frame-step-controls" role="group" aria-label={stillImage ? "Photo navigation" : "Frame navigation"}>
          <IconButton icon="left" label={stillImage ? "Previous photo" : "Previous frame"} disabled={!onStep || view.current <= 0} onClick={() => onStep?.(-1)} />
          <IconButton icon="right" label={stillImage ? "Next photo" : "Next frame"} disabled={!onStep || view.current >= view.frame_count - 1} onClick={() => onStep?.(1)} />
        </span>
        {stillImage ? <><span>Photo {view.current + 1} / {view.frame_count}</span><span className="image-name" title={stillImage.name}>{stillImage.name}</span><span>{imageSize.width} × {imageSize.height} px</span></> : <>{onGoTo
          ? <JumpBox current={view.current} frameCount={view.frame_count} pts={view.pts} fps={view.fps} onJump={onGoTo}
              locate={backend.joltFrame && videoKey ? (seconds) => backend.joltFrame!(videoKey, seconds) : undefined} />
          : <><span>
          frame <b>{view.current}</b> / {view.frame_count - 1}
        </span>
        <span>{formatTimecode(view.pts, view.fps)}</span></>}
        <span>{view.fps.toFixed(2)} fps</span>
        <span>
          labelled <b>{view.labelled_count}</b>
        </span>
        <span className={view.flag_count > 0 ? "warn" : ""}>flags {view.flag_count}</span>
        {url && url === exactRef.current && <span title="This paused frame is shown losslessly at the video's own resolution">full quality · {imageSize.width} × {imageSize.height}</span>}</>}
      </div>
    </div>
  );
}
