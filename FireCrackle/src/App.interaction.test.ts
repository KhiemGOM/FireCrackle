import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { PREFERENCES_KEY } from "./lib/preferences";
const fixture = vi.hoisted(() => ({
  backend: { mock: true, pickVideo: vi.fn(async ():Promise<string|null> => null) }, act: vi.fn(async (_action: unknown) => {}), view: {} as any,
  updates: {} as any,
  post: {} as any,
  states: [] as any[], refs: [] as Array<{current: any}>, stateCursor: 0, refCursor: 0, effectCursor: 0,
  effects: [] as Array<{ deps?: unknown[]; cleanup?: void | (() => void) }>, pending: [] as Array<() => void>,
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const i = fixture.stateCursor++;
    if (!(i in fixture.states)) fixture.states[i] = typeof initial === "function" ? initial() : initial;
    return [fixture.states[i], (next: any) => { fixture.states[i] = typeof next === "function" ? next(fixture.states[i]) : next; }];
  },
  useRef: (initial: unknown) => fixture.refs[fixture.refCursor++] ??= {current: initial},
  useCallback: (fn: unknown) => fn,
  useEffect: (setup: () => void | (() => void), deps?: unknown[]) => {
    const i = fixture.effectCursor++, old = fixture.effects[i];
    if (old && deps && old.deps && deps.length === old.deps.length && deps.every((v, j) => Object.is(v, old.deps![j]))) return;
    fixture.pending.push(() => { old?.cleanup?.(); fixture.effects[i] = { deps, cleanup: setup() }; });
  },
}));
vi.mock("./lib/api", async original => ({ ...await original<typeof import("./lib/api")>(), createBackend: async () => fixture.backend }));
vi.mock("./hooks/useWorkspace", () => ({ messageOf: (error:unknown) => error instanceof Error ? error.message : String(error), useWorkspace: () => ({ view: fixture.view, act: fixture.act, busy: {current: false}, flags: [], settings: [], version: 0, save: vi.fn(), opening: false, clearError: vi.fn() }) }));
vi.mock("./hooks/useLayout", () => ({ useLayout: () => ({ layout: { sideWidth: 600, videoHeight: 400, flagsHeight: 120 }, set: vi.fn(), reset: vi.fn() }) }));
vi.mock("./hooks/usePanelZooms", () => ({ usePanelZooms: () => ({ zooms: {picker: 1, flags: 1}, wheel: vi.fn(), reset: vi.fn() }) }));
vi.mock("./hooks/useWheel", () => ({ useWheel: () => {} }));
vi.mock("./hooks/useUpdates", () => ({ useUpdates: () => fixture.updates }));
vi.mock("./hooks/usePostSettings", () => ({ usePostSettings: () => fixture.post }));
import App from "./App";
import { Picker } from "./components/Picker";
import { VideoPane } from "./components/VideoPane";
import { PlaybackButton } from "./components/PlaybackButton";
import { ImagesTab } from "./components/ImagesTab";
import { MiscToolsTab } from "./components/MiscToolsTab";
import { UpdateBanner } from "./components/UpdateBanner";
import { UpdatesDialog } from "./components/UpdatesDialog";
import { EnhancePanel } from "./components/EnhancePanel";
import { DEFAULT_POST, type PostSettings } from "./lib/post/settings";
import { parseRelease } from "./lib/updateCheck";
import { version as appVersion } from "../package.json";

type Element = ReactElement<Record<string, any>>;
function find(node: Element, test: (e: Element) => boolean): Element | undefined {
  if (test(node)) return node;
  for (const child of [node.props.children].flat(Infinity)) if (child && typeof child === "object" && "props" in child) {
    const match = find(child, test); if (match) return match;
  }
}
function render() {
  fixture.stateCursor = fixture.refCursor = fixture.effectCursor = 0; fixture.pending = [];
  const tree = App() as Element;
  fixture.pending.forEach(run => run());
  return { tree, picker: find(tree, e => e.type === Picker)!, video: find(tree, e => e.type === VideoPane)!, confirm: find(tree, e => e.props.label === "Confirm candidate")!, noFire: find(tree, e => e.props.label === "Choose no fire")! };
}
function key(key: string, mods: Record<string,unknown> = {}) {
  const event=Object.assign(new Event("keydown", {cancelable: true}), {key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, repeat: false,...mods});
  window.dispatchEvent(event);
  return event;
}
beforeEach(() => {
  fixture.backend.pickVideo.mockReset().mockResolvedValue(null);
  fixture.act.mockClear(); fixture.states = [fixture.backend, null]; fixture.refs = []; fixture.effects = [];
  fixture.updates = updatesFixture(null);
  fixture.post = postFixture();
  fixture.view = { current: 10, frame_count: 100, fps: 30, pts: 1 / 3, label: "unset", pick: {sheet: 1, mirrored: false}, suggestion: {sheet: 1, row: 7, mirrored: false, alt_row: 8, from_frame: 1}, typed_pending: null, labelled_count: 1, flag_count: 0, warnings: [], save_error: null };
  const target = new EventTarget();
  vi.stubGlobal("window", {
    addEventListener: (type: string, listener: EventListener, capture = false) => target.addEventListener(type, listener, {capture}),
    removeEventListener: (type: string, listener: EventListener, capture = false) => target.removeEventListener(type, listener, {capture}),
    dispatchEvent: (event: Event) => target.dispatchEvent(event),
  });
});
it('places Misc tools between Phase and Images and passes the same active video',()=>{
 let ui=render();const nav=find(ui.tree,e=>e.type==='nav')!;
 const labels=(nav.props.children as Element[]).filter(e=>e.type==='button').map(e=>[e.props.children].flat().filter(c=>typeof c==='string').join('').trim());
 expect(labels).toEqual(['Home','Label','Phase','Misc tools','Images']);
 find(nav,e=>e.type==='button'&&[e.props.children].flat().includes(' Misc tools'))!.props.onClick();ui=render();
 const misc=find(ui.tree,e=>e.type===MiscToolsTab)!;expect(misc.props.view).toBe(fixture.view);expect(misc.props.backend).toBe(fixture.backend);
 expect(ui.video).toBeUndefined();key('ArrowRight');key('Enter');expect(fixture.act).not.toHaveBeenCalled();
 misc.props.onOpenFrame(20);expect(fixture.act).toHaveBeenCalledWith({type:'goTo',frame:20});
 expect(render().video).toBeDefined();
});

it('shows a failed native video chooser as a visible error with a path workaround',async()=>{
 fixture.backend.pickVideo.mockRejectedValue(new Error('GTK chooser failed'));
 const ui=render();find(ui.tree,e=>e.props.label==='Open video')!.props.onClick();
 await Promise.resolve();await Promise.resolve();
 const alert=find(render().tree,e=>e.props.role==='alert')!;
 expect(alert).toBeDefined();
 expect(alert.props.children[0]).toContain('GTK chooser failed');
 expect(alert.props.children[0]).toContain('paste the video path');
});

it('does not treat cancelling the native video chooser as an error',async()=>{
 const ui=render();find(ui.tree,e=>e.props.label==='Open video')!.props.onClick();
 await Promise.resolve();await Promise.resolve();
 expect(find(render().tree,e=>e.props.role==='alert')).toBeUndefined();
});
afterEach(() => { fixture.effects.forEach(e => e?.cleanup?.()); vi.unstubAllGlobals(); });

it("opens Images before loading a video and keeps its component mounted across workspace tabs", () => {
  fixture.view = null;
  let ui = render();
  const imagesTab = find(ui.tree, e => e.type === "button" && [e.props.children].flat().includes(" Images"))!;
  expect(imagesTab).toBeDefined(); imagesTab.props.onClick(); ui = render();
  expect(find(ui.tree, e => e.type === ImagesTab)!.props.active).toBe(true);
  expect(ui.video).toBeUndefined(); expect(ui.confirm).toBeUndefined();
  find(ui.tree, e => e.type === "button" && [e.props.children].flat().includes(" Label"))!.props.onClick(); ui = render();
  expect(find(ui.tree, e => e.type === ImagesTab)!.props.active).toBe(false);
});

it("does not send video navigation or confirmation hotkeys while Images is selected", () => {
  let ui = render();
  find(ui.tree, e => e.type === "button" && [e.props.children].flat().includes(" Images"))!.props.onClick(); ui = render();
  key("ArrowRight"); key("Enter"); key("ArrowLeft");
  expect(fixture.act).not.toHaveBeenCalled();
  const videoActions = find(ui.tree, e => String(e.props.className).includes("video-top-actions"))!;
  expect(videoActions.props.inert).toBe(true);
  expect(videoActions.props["aria-hidden"]).toBe(true);
});

it("atlas clicks and preview-only Ctrl clicks never save or advance; Confirm saves the staged choice", () => {
  let ui = render();
  const preview = vi.fn(() => true); ui.video.props.previewRef.current = { selectSprite: preview };
  ui.picker.props.onCell(2, 31, false);
  expect(fixture.act).not.toHaveBeenCalled();
  ui = render(); expect(ui.picker.props.candidate).toEqual({fire: {sheet: 0, row: 31, mirrored: true}});
  ui.picker.props.onCell(1, 9, true);
  expect(fixture.act).not.toHaveBeenCalled();
  ui = render(); expect(ui.picker.props.candidate.fire.row).toBe(31);
  ui.confirm.props.onClick();
  expect(fixture.act).toHaveBeenCalledExactlyOnceWith({type: "clickCell", col: 2, row: 31});
});
it("forward navigation never auto-confirms and Enter confirms typed rows only explicitly", () => {
  render(); key("ArrowRight");
  expect(fixture.act).toHaveBeenCalledExactlyOnceWith({type: "step", frames: 1});
  fixture.act.mockClear(); key("3"); render(); key("1"); render();
  expect(fixture.act).not.toHaveBeenCalled(); key("Enter");
  expect(fixture.act).toHaveBeenCalledExactlyOnceWith({type: "clickCell", col: 1, row: 31});
});
it("manual frame arrows navigate without saving the candidate", () => {
  const ui = render();
  ui.video.props.onStep(-1);
  ui.video.props.onStep(1);
  expect(fixture.act.mock.calls).toEqual([[{type: "step", frames: -1}], [{type: "step", frames: 1}]]);
});
it("reserves Enter and frame arrows before focused widget handlers, including Shift", () => {
  render();
  const widget = vi.fn();
  window.addEventListener("keydown",widget);
  expect(key("ArrowRight").defaultPrevented).toBe(true);
  expect(key("ArrowLeft",{shiftKey:true}).defaultPrevented).toBe(true);
  expect(fixture.act.mock.calls).toEqual([[{type:"step",frames:1}],[{type:"bigStep",dir:-1}]]);
  fixture.act.mockClear();
  expect(key("Enter").defaultPrevented).toBe(true);
  expect(fixture.act).toHaveBeenCalledExactlyOnceWith({type:"acceptSuggestion"});
  fixture.act.mockClear();
  expect(key("Enter",{repeat:true}).defaultPrevented).toBe(true);
  expect(fixture.act).not.toHaveBeenCalled();
  expect(widget).not.toHaveBeenCalled();
  key("q");
  expect(widget).toHaveBeenCalledOnce();
});
it("R flips and adjacent T switches sheets without saving or advancing", () => {
  let ui=render();
  key("r");ui=render();
  expect(ui.picker.props.candidate).toEqual({fire:{sheet:1,row:7,mirrored:true}});
  key("t");ui=render();
  expect(ui.picker.props.candidate).toEqual({fire:{sheet:0,row:7,mirrored:true}});
  expect(fixture.act).not.toHaveBeenCalled();
  ui.confirm.props.onClick();
  expect(fixture.act).toHaveBeenCalledExactlyOnceWith({type:"clickCell",col:2,row:7});
});
it("up/down step and wrap animation phases while preserving sheet and mirror without saving", () => {
  let ui = render();
  ui.picker.props.onCell(3, 0, false); ui = render();
  key("ArrowUp"); ui = render();
  expect(ui.picker.props.candidate).toEqual({fire:{sheet:1,row:31,mirrored:true}});
  key("ArrowDown"); ui = render();
  expect(ui.picker.props.candidate).toEqual({fire:{sheet:1,row:0,mirrored:true}});
  ui.video.props.onPreviewChange({sheet:0,row:14,mirrored:false}); ui = render();
  key("ArrowDown"); ui = render();
  expect(ui.picker.props.candidate).toEqual({fire:{sheet:0,row:15,mirrored:false}});
  expect(fixture.act).not.toHaveBeenCalled();
});

it("No fire is a reviewed marker saved only after confirmation", () => {
  let ui = render(); ui.picker.props.onNoFire("no_fire");
  expect(fixture.act).not.toHaveBeenCalled(); ui = render();
  expect(ui.picker.props.candidate).toBe("no_fire"); ui.confirm.props.onClick();
  expect(fixture.act).toHaveBeenCalledExactlyOnceWith({type: "noFire"});
});
it("saves only the selected source's absence on confirmation",()=>{
 const label={no_texture:{atlas:"water_still"}};
 let ui=render();ui.picker.props.onNoFire(label);
 expect(fixture.act).not.toHaveBeenCalled();ui=render();
 expect(ui.picker.props.candidate).toEqual(label);ui.confirm.props.onClick();
 expect(fixture.act).toHaveBeenCalledExactlyOnceWith({type:"setLabel",label});
});
it("shares the atlas edge filters with video matching without labeling", () => {
  let ui=render();
  ui.picker.props.onFilterChange({left:3,right:7});
  ui=render();
  expect(ui.picker.props.filter).toEqual({left:3,right:7});
  expect(ui.video.props.atlasFilter).toBe(ui.picker.props.filter);
  expect(fixture.act).not.toHaveBeenCalled();
  ui.picker.props.onFilterChange({left:null,right:null});
  expect(render().video.props.atlasFilter).toEqual({left:null,right:null});
});
it("restores saved filters and persists edits for the next launch", () => {
  let saved=JSON.stringify({atlasFilter:{left:0,right:5},tab:"label",matchOnlyFiltered:false});
  vi.stubGlobal("localStorage", {getItem:(key:string)=>key===PREFERENCES_KEY?saved:null,setItem:(key:string,value:string)=>{if(key===PREFERENCES_KEY)saved=value;}});
  let ui=render();
  expect(ui.picker.props.filter).toEqual({left:0,right:5});
  ui.picker.props.onFilterChange({left:2,right:null});
  ui=render();
  expect(JSON.parse(saved)).toMatchObject({atlasFilter:{left:2,right:null},matchOnlyFiltered:false});
});

// ---------------------------------------------------------------- the update banner and dialog

const newer = parseRelease({
  tag_name: "v9.9.9", html_url: "https://github.com/KhiemGOM/FireCrackle/releases/tag/v9.9.9", body: "Notes", draft: false, prerelease: false,
  assets: [{ name: "FireCrackle-9.9.9-windows-x64.zip", size: 1, browser_download_url: "https://github.com/KhiemGOM/FireCrackle/releases/download/v9.9.9/FireCrackle-9.9.9-windows-x64.zip" }],
})!;

function updatesFixture(banner: typeof newer | null, over: Record<string, unknown> = {}) {
  const controller = { open: vi.fn(), skip: vi.fn(), later: vi.fn(), setAuto: vi.fn(), check: vi.fn(async () => {}) };
  const result = banner ? { state: "available" as const, release: banner } : null;
  return {
    banner, controller,
    state: { settings: { auto: true, lastCheckMs: null, skipped: null }, result, checking: false, laterHidden: false, kind: "windows_portable", ...over },
  };
}
const updatesButton = (tree: Element) => find(tree, e => e.props.label === "Software updates");

it("shows no update banner when there is nothing newer", () => {
  const { tree } = render();
  expect(find(tree, e => e.type === UpdateBanner)).toBeUndefined();
});

it("shows the banner for a newer release, with this version, this install kind and its handlers", () => {
  fixture.updates = updatesFixture(newer);
  const banner = find(render().tree, e => e.type === UpdateBanner)!;
  expect(banner).toBeDefined();
  expect(banner.props.release).toBe(newer);
  expect(banner.props.localVersion).toBe(appVersion);
  expect(banner.props.kind).toBe("windows_portable");
  banner.props.onOpen("https://github.com/KhiemGOM/FireCrackle/releases/tag/v9.9.9");
  banner.props.onSkip();
  banner.props.onLater();
  expect(fixture.updates.controller.open).toHaveBeenCalledExactlyOnceWith("https://github.com/KhiemGOM/FireCrackle/releases/tag/v9.9.9");
  expect(fixture.updates.controller.skip).toHaveBeenCalledOnce();
  expect(fixture.updates.controller.later).toHaveBeenCalledOnce();
});

it("has a Software updates button that opens the dialog, and the dialog closes again", () => {
  fixture.updates = updatesFixture(null);
  let ui = render();
  expect(find(ui.tree, e => e.type === UpdatesDialog)).toBeUndefined();
  updatesButton(ui.tree)!.props.onClick();
  ui = render();
  const dialog = find(ui.tree, e => e.type === UpdatesDialog)!;
  expect(dialog).toBeDefined();
  expect(dialog.props.localVersion).toBe(appVersion);
  expect(dialog.props.auto).toBe(true);
  dialog.props.onClose();
  expect(find(render().tree, e => e.type === UpdatesDialog)).toBeUndefined();
});

it("What's new on the banner opens the same dialog", () => {
  fixture.updates = updatesFixture(newer);
  const ui = render();
  find(ui.tree, e => e.type === UpdateBanner)!.props.onDetails();
  expect(find(render().tree, e => e.type === UpdatesDialog)).toBeDefined();
});

it("the dialog's switch, check and open go to the update controller, and it shows the result", () => {
  fixture.updates = updatesFixture(newer, { checking: false });
  updatesButton(render().tree)!.props.onClick();
  const dialog = find(render().tree, e => e.type === UpdatesDialog)!;
  dialog.props.onAuto(false);
  dialog.props.onCheck();
  dialog.props.onOpen("https://github.com/KhiemGOM/FireCrackle/releases/tag/v9.9.9");
  expect(fixture.updates.controller.setAuto).toHaveBeenCalledExactlyOnceWith(false);
  expect(fixture.updates.controller.check).toHaveBeenCalledExactlyOnceWith(true);
  expect(fixture.updates.controller.open).toHaveBeenCalledOnce();
  expect(dialog.props.status).toBe("available");
  expect(dialog.props.release).toBe(newer);
});

it("the dialog shows a failed check's message and a running check", () => {
  fixture.updates = updatesFixture(null, { result: { state: "error", reason: "offline", message: "Could not reach GitHub. Are you offline?" } });
  updatesButton(render().tree)!.props.onClick();
  let dialog = find(render().tree, e => e.type === UpdatesDialog)!;
  expect(dialog.props.status).toBe("error");
  expect(dialog.props.message).toContain("Could not reach GitHub");
  fixture.updates = updatesFixture(null, { checking: true });
  dialog = find(render().tree, e => e.type === UpdatesDialog)!;
  expect(dialog.props.status).toBe("checking");
});

it("the Software updates button is there with or without a loaded video, and says when an update waits", () => {
  fixture.view = null;
  fixture.updates = updatesFixture(newer);
  const button = updatesButton(render().tree)!;
  expect(button).toBeDefined();
  expect([button.props.children].flat().join(" ")).toContain("Update");
  fixture.updates = updatesFixture(null);
  expect([updatesButton(render().tree)!.props.children].flat().filter(Boolean).join(" ")).not.toContain("Update");
});

// ---------------------------------------------------------------- the Enhance panel in the right side

function postFixture(settings: PostSettings = DEFAULT_POST, over: Record<string, unknown> = {}) {
  return { settings, picture: settings, selected: "veil", setSelected: vi.fn(), change: vi.fn(), toggle: vi.fn(), reset: vi.fn(), portalStatus: "", setPortalStatus: vi.fn(), portalFit: null, setPortalFit: vi.fn(), toggleKey: "v", userPresets: [], presetName: "", setPresetName: vi.fn(), savePreset: vi.fn(), deletePreset: vi.fn(), ...over };
}
const sideButton = (tree: Element, label: string) => find(tree, e => e.props["aria-label"] === label);

it("shows a Label / Enhance switch above the right side, with Label chosen and no Enhance panel at first", () => {
  const { tree } = render();
  expect(sideButton(tree, "Show label tools")!.props["aria-pressed"]).toBe(true);
  expect(sideButton(tree, "Show Enhance panel")!.props["aria-pressed"]).toBe(false);
  expect(find(tree, e => e.type === EnhancePanel)).toBeUndefined();
});

it("opens the Enhance panel in the right side with the post settings, and keeps the label tools mounted", () => {
  fixture.post = postFixture({ ...DEFAULT_POST, veil: "auto" }, { selected: "tone" });
  sideButton(render().tree, "Show Enhance panel")!.props.onClick();
  const ui = render();
  const panel = find(ui.tree, e => e.type === EnhancePanel)!;
  expect(panel).toBeDefined();
  expect(panel.props.settings).toBe(fixture.post.settings);
  expect(panel.props.selected).toBe("tone");
  expect(panel.props.onSelect).toBe(fixture.post.setSelected);
  expect(panel.props.onChange).toBe(fixture.post.change);
  expect(panel.props.onReset).toBe(fixture.post.reset);
  expect(find(ui.tree, e => e.type === "aside")!.props.className).toContain("enhancing");
  expect(ui.picker).toBeDefined(); // the picker stays mounted, so its state survives a visit to Enhance
});

it("goes back to the label tools from the Enhance panel", () => {
  sideButton(render().tree, "Show Enhance panel")!.props.onClick();
  sideButton(render().tree, "Show label tools")!.props.onClick();
  const ui = render();
  expect(find(ui.tree, e => e.type === EnhancePanel)).toBeUndefined();
  expect(find(ui.tree, e => e.type === "aside")!.props.className).not.toContain("enhancing");
});

it("keeps the post-processing on/off out of the tab row: it lives inside the Enhance panel", () => {
  fixture.post = postFixture({ ...DEFAULT_POST, enabled: false });
  let ui = render();
  expect(sideButton(ui.tree, "Toggle post-processing")).toBeUndefined();
  expect(find(ui.tree, e => e.props.className === "side-switch")).toBeDefined();
  sideButton(ui.tree, "Show Enhance panel")!.props.onClick();
  ui = render();
  expect(sideButton(ui.tree, "Toggle post-processing")).toBeUndefined();
  const panel = find(ui.tree, e => e.type === EnhancePanel)!;
  expect(panel.props.settings.enabled).toBe(false);
  panel.props.onChange({ ...panel.props.settings, enabled: true }); // the panel's own switch goes through the settings hook
  expect(fixture.post.change).toHaveBeenCalledWith({ ...DEFAULT_POST, enabled: true });
});

it("gives the video the picture settings and a place to report the portal status", () => {
  const picture = { ...DEFAULT_POST, veil: "on" as const };
  fixture.post = postFixture(DEFAULT_POST, { picture });
  const { video } = render();
  expect(video.props.post).toBe(picture);
  expect(video.props.onPortalStatus).toBe(fixture.post.setPortalStatus);
});

it("hands the last portal fit between the video and the Enhance panel", () => {
  fixture.post = postFixture(DEFAULT_POST, { portalFit: { phase: 20, opacity: 0.39 }, selected: "portal" });
  const { video } = render();
  expect(video.props.onPortalFit).toBe(fixture.post.setPortalFit);
  sideButton(render().tree, "Show Enhance panel")!.props.onClick();
  const panel = find(render().tree, e => e.type === EnhancePanel)!;
  expect(panel.props.portalFit).toEqual({ phase: 20, opacity: 0.39 });
});

it("never runs the playhead ahead of the picture during slow delivery or after a seek", async () => {
  vi.useFakeTimers({toFake:["setInterval","clearInterval","performance"]});
  try {
    let ui=render();key(" ");ui=render();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fixture.act).not.toHaveBeenCalled();
    expect(ui.video.props.onFramePresented).toBeTypeOf("function");
    fixture.act.mockImplementation(async (action:any)=>{fixture.view.current+=action.frames;});
    ui.video.props.onFramePresented(10);
    await vi.advanceTimersByTimeAsync(80);
    expect(fixture.act).toHaveBeenCalledTimes(1);
    expect(Math.abs((fixture.act.mock.calls[0][0] as any).frames)).toBeLessThanOrEqual(1);
    ui=render();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fixture.act).toHaveBeenCalledTimes(1);
    fixture.view={...fixture.view,current:70};ui=render();
    ui.video.props.onFramePresented(11); // a stale seek result cannot unlock playback
    await vi.advanceTimersByTimeAsync(1000);
    expect(fixture.act).toHaveBeenCalledTimes(1);
  } finally {vi.useRealTimers();fixture.act.mockImplementation(async()=>{});}
});

it("keeps the selected playback speed through Play and Space pause/resume", () => {
  vi.useFakeTimers();
  try {
    let ui=render();
    find(ui.tree,e=>e.type===PlaybackButton)!.props.onSpeed(.25);
    ui=render();expect(find(ui.tree,e=>e.type===PlaybackButton)!.props.speed).toBe(.25);
    find(ui.tree,e=>e.type===PlaybackButton)!.props.onToggle();
    ui=render();expect(ui.video.props.motion).toEqual({dir:1,speed:.25});
    key(' ');ui=render();expect(ui.video.props.motion.dir).toBe(0);
    expect(find(ui.tree,e=>e.type===PlaybackButton)!.props.speed).toBe(.25);
    key(' ');ui=render();expect(ui.video.props.motion).toEqual({dir:1,speed:.25});
    find(ui.tree,e=>e.type===PlaybackButton)!.props.onSpeed(.5);
    ui=render();expect(ui.video.props.motion).toEqual({dir:1,speed:.5});
  } finally {vi.useRealTimers();}
});

it("hands the saved presets and their handlers to the Enhance panel", () => {
  const userPresets = [{ id: "user-1", name: "Night", stages: { tone: { gamma: 1.4 } } }];
  fixture.post = postFixture(DEFAULT_POST, { userPresets, presetName: "Cav" });
  sideButton(render().tree, "Show Enhance panel")!.props.onClick();
  const panel = find(render().tree, e => e.type === EnhancePanel)!;
  expect(panel.props.userPresets).toBe(userPresets);
  expect(panel.props.presetName).toBe("Cav");
  expect(panel.props.onPresetName).toBe(fixture.post.setPresetName);
  expect(panel.props.onSavePreset).toBe(fixture.post.savePreset);
  expect(panel.props.onDeletePreset).toBe(fixture.post.deletePreset);
});
