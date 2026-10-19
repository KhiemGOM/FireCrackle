import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
const hooks = vi.hoisted(() => ({ states: [] as unknown[], refs: [] as Array<{current: unknown}>, si: 0, ri: 0, effects: [] as Array<() => void | (() => void)> }));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const i = hooks.si++; if (!(i in hooks.states)) hooks.states[i] = initial;
    return [hooks.states[i], (next: unknown) => { hooks.states[i] = typeof next === "function" ? next(hooks.states[i]) : next; }];
  },
  useRef: (initial: unknown) => hooks.refs[hooks.ri++] ??= {current: initial},
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
}));
import { Picker } from "./Picker";
import type { View } from "../lib/api";
import type { Label } from "../lib/grid";
import type { EdgeFilter } from "../lib/atlasFilter";

type Element = ReactElement<Record<string, any>>;
it('defaults to Fire + Soul fire and hides fluids after an alternate was selected',()=>{
 hooks.states[0]='water_flow';hooks.si=hooks.ri=0;
 const root=Picker({view,cell:40,onCell});
 expect(all(root,e=>e.props['aria-label']==='Animation atlas')).toHaveLength(1);
 expect(all(root,e=>e.props['aria-label']==='Soul fire')).toHaveLength(1);
 expect(all(root,e=>e.props['aria-label']==='Flowing water')).toHaveLength(0);
 expect(all(root,e=>e.props['aria-label']==='Choose no fire')).toHaveLength(1);
 expect(all(root,e=>e.type==='button'&&e.props.className?.startsWith('cell'))).toHaveLength(128);
});
function all(node: Element, test: (e: Element) => boolean): Element[] {
  const children = [node.props.children].flat(Infinity).filter((x): x is Element => !!x && typeof x === "object" && "props" in x);
  return [...(test(node) ? [node] : []), ...children.flatMap(child => all(child, test))];
}
const onCell = vi.fn();
const onNoFire = vi.fn();
const onAlternative = vi.fn();
const view = { label: "unset", suggestion: null } as View;
let cleanup: Array<void | (() => void)> = [];
function render(candidate:Label = {fire: {sheet: 1, row: 0, mirrored: false}}, filter?: EdgeFilter, onFilterChange?: (filter: EdgeFilter) => void) {
  hooks.si = hooks.ri = 0; hooks.effects = [];
  const tree = Picker({ extraSources: true, view, cell: 40, onCell, onNoFire, onAlternative, candidate, filter, onFilterChange });
  return {
    tree,
    cells: all(tree, e => e.type === "button" && e.props.className?.startsWith("cell")),
    input: (side: string) => all(tree, e => e.props["aria-label"] === `${side} edge fire pixels`)[0],
    whiteInput: (bound: string) => all(tree, e => e.props["aria-label"] === `${bound} bottom white pixels`)[0],
    reset: all(tree, e => e.props.label === "Clear sprite pixel filters")[0],
    alerts: all(tree, e => e.props.role === "alert"),
    noFire: all(tree, e => e.props["aria-label"] === "Choose no fire")[0],
  };
}
beforeEach(() => {
  hooks.states = []; hooks.refs = []; onCell.mockClear();
  const data = [new Uint8ClampedArray(16 * 512 * 4), new Uint8ClampedArray(16 * 512 * 4)];
  for (let sheet = 0; sheet < 2; sheet++) {
    for (let y = 0; y < (sheet ? 2 : 3); y++) data[sheet][(y * 16) * 4 + 3] = 255;
    for (let y = 0; y < (sheet ? 9 : 7); y++) data[sheet][(y * 16 + 15) * 4 + 3] = 255;
    for (let x = 3; x < (sheet ? 5 : 8); x++) data[sheet].set([255, 255, 255, 255], (15 * 16 + x) * 4);
  }
  vi.stubGlobal("Image", class {
    naturalWidth = 16; naturalHeight = 512; onload?: () => void; onerror?: () => void; source = "";
    set src(value: string) { this.source = value; this.onload?.(); }
  });
  vi.stubGlobal("document", { createElement: () => {
    let sheet = 0;
    return { getContext: () => ({ drawImage: (image: {source: string}) => { sheet = image.source.includes("fire_0") ? 0 : 1; }, getImageData: () => ({data: data[sheet]}) }) };
  } });
});
it("keeps the same adaptive grid and controls through fire and soul switches",()=>{
 let ui=render();
 const picker=()=>all(ui.tree,e=>e.props.className==="picker picker-adaptive")[0];
 const choose=(name:string)=>all(ui.tree,e=>e.type==="button"&&e.props['aria-label']===name)[0].props.onClick();
 // Same observer target and shared grid structure remain mounted; size state survives every family.
 hooks.states[2]={width:700,height:800};
 ui=render();const fireLayout=picker().props.style;
 expect(ui.cells).toHaveLength(128);
 choose('Soul fire');ui=render();
 expect(ui.cells).toHaveLength(128);expect(picker().props.style).toEqual(fireLayout);
 expect(ui.input('Left')).toBeDefined();expect(ui.whiteInput('Minimum')).toBeDefined();
 expect(ui.cells[0].props.onContextMenu).toBeTypeOf('function');
 choose('Fire');ui=render();expect(picker().props.style).toEqual(fireLayout);expect(ui.cells).toHaveLength(128);
});
it("separates fluid sources and absence labels, with no inactive source cells or filters",()=>{
 let ui=render();
 for(const [name,atlas,count,sheet] of [
  ['Still lava','lava_still',40,0],['Flowing lava','lava_flow',32,1],
  ['Still water','water_still',64,0],['Flowing water','water_flow',64,1],
 ] as const){
  all(ui.tree,e=>e.type==='button'&&e.props['aria-label']===name)[0].props.onClick();ui=render();
  expect(ui.cells).toHaveLength(count);
  expect(ui.input('Left')).toBeUndefined();
  expect(ui.whiteInput('Minimum')).toBeUndefined();
  onAlternative.mockClear();ui.cells[0].props.onClick({ctrlKey:false});
  expect(onAlternative).toHaveBeenCalledWith({atlas,sheet,row:0,mirrored:false},false);
  const button=all(ui.tree,e=>e.props['aria-label']===`Choose no ${atlas.startsWith('water')?'water':'lava'}`)[0];
  onNoFire.mockClear();button.props.onClick();
  expect(onNoFire).toHaveBeenCalledWith({no_texture:{atlas}});
  ui.cells[0].props.onContextMenu({preventDefault:vi.fn(),stopPropagation:vi.fn()});
  expect(render().cells[0].props.className).not.toContain('manual-filter-miss');
 }
});
it("does not read stale shorter-sheet pixel counts while switching to water",()=>{
 let ui=render();
 all(ui.tree,e=>e.type==='button'&&e.props['aria-label']==='Flowing lava')[0].props.onClick();
 // A shorter atlas may still be in state during the first render after a switch.
 hooks.states[8]=[Array(16).fill({left:1,right:1}),Array(16).fill({left:1,right:1})];
 ui=render();
 all(ui.tree,e=>e.type==='button'&&e.props['aria-label']==='Still water')[0].props.onClick();
 expect(()=>render()).not.toThrow();
 expect(render().cells).toHaveLength(64);
});
it("filters bottom white inclusively, keeps dimmed sprites clickable, and clears both bounds", async () => {
  render(); cleanup = hooks.effects.map(effect => effect());
  await Promise.resolve(); await Promise.resolve();
  let ui = render();
  ui.whiteInput("Minimum").props.onChange({target: {value: "2"}});
  ui = render(); ui.whiteInput("Maximum").props.onChange({target: {value: "5"}});
  ui = render();
  expect(ui.cells.filter(e => !e.props.className.includes("edge-filter-miss"))).toHaveLength(4);
  ui.whiteInput("Minimum").props.onChange({target: {value: "5"}});
  ui = render();
  const matching = ui.cells.filter(e => !e.props.className.includes("edge-filter-miss"));
  expect(matching).toHaveLength(2); // normal and mirrored; exact min=max is inclusive
  expect(matching[0].props.title).toContain("bottom white 5");
  const dimmed = ui.cells.find(e => e.props.className.includes("edge-filter-miss"))!;
  onCell.mockClear(); dimmed.props.onClick({ctrlKey: false});
  expect(onCell).toHaveBeenCalledOnce();
  ui.whiteInput("Maximum").props.onChange({target: {value: "4"}});
  ui = render();
  expect(ui.alerts).toHaveLength(1);
  expect(ui.cells.every(e => e.props.className.includes("edge-filter-miss"))).toBe(true);
  ui.reset.props.onClick(); ui = render();
  expect(ui.whiteInput("Minimum").props.value).toBe("");
  expect(ui.whiteInput("Maximum").props.value).toBe("");
  expect(ui.cells.every(e => !e.props.className.includes("edge-filter-miss"))).toBe(true);
  ui.whiteInput("Maximum").props.onChange({target: {value: "0"}});
  expect(render().cells.filter(e => !e.props.className.includes("edge-filter-miss"))).toHaveLength(124);
});
it("preserves white bounds through edge edits and manual exclusions in shared filter state", () => {
  let filter: EdgeFilter = {left: null, right: null, bottomWhiteMin: 5, bottomWhiteMax: 8};
  const update = (next: EdgeFilter) => {filter = next;};
  let ui = render(undefined, filter, update);
  ui.input("Left").props.onChange({target: {value: "3"}});
  ui = render(undefined, filter, update);
  ui.cells[0].props.onContextMenu({preventDefault: vi.fn(), stopPropagation: vi.fn()});
  expect(filter).toMatchObject({left: 3, bottomWhiteMin: 5, bottomWhiteMax: 8, excluded: [0]});
  ui = render(undefined, filter, update); ui.reset.props.onClick();
  expect(filter).toMatchObject({left: null, right: null, bottomWhiteMin: null, bottomWhiteMax: null, excluded: [0]});
});
it("offers a compact No fire choice alongside filters without occupying a sprite cell", () => {
  const ui = render("no_fire");
  expect(ui.cells).toHaveLength(128);
  expect(ui.noFire.props["aria-pressed"]).toBe(true);
  expect(ui.noFire.props.title).toContain("Confirm/Enter");
  onNoFire.mockClear();
  ui.noFire.props.onClick();
  expect(onNoFire).toHaveBeenCalledOnce();
});
it("right-click toggles a visual/manual exclusion while left-click remains available", () => {
  let ui=render();
  const event={preventDefault:vi.fn(),stopPropagation:vi.fn()};
  onCell.mockClear();
  ui.cells[0].props.onContextMenu(event);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(onCell).not.toHaveBeenCalled();
  ui=render();
  expect(ui.cells[0].props.className).toContain("manual-filter-miss");
  expect(ui.cells[0].props.disabled).toBeUndefined();
  ui.cells[0].props.onClick({ctrlKey:false});
  expect(onCell).toHaveBeenCalledOnce();
  ui.cells[0].props.onContextMenu(event);
  expect(render().cells[0].props.className).not.toContain("manual-filter-miss");
});
afterEach(() => { cleanup.forEach(stop => stop?.()); cleanup = []; vi.unstubAllGlobals(); });

it("visually filters exact outermost counts while keeping every cell and click working", async () => {
  render(); cleanup = hooks.effects.map(effect => effect());
  await Promise.resolve(); await Promise.resolve();
  let ui = render();
  expect(ui.cells).toHaveLength(128);
  expect(ui.input("Left").type).toBe("input");
  expect(ui.input("Left").props).toMatchObject({type: "number", min: 0, max: 16, placeholder: "Any", value: ""});
  ui.input("Left").props.onChange({target: {value: "3"}});
  ui.input("Right").props.onChange({target: {value: "7"}});
  ui = render();
  const matching = ui.cells.filter(e => !e.props.className.includes("edge-filter-miss"));
  expect(matching).toHaveLength(1);
  expect(matching[0].props.title).toContain("Edge pixels: left 3 · right 7");
  const dimmed = ui.cells.find(e => e.props["aria-label"].startsWith("row 0, sheet 1, normal"))!;
  expect(dimmed.props.className).toContain("edge-filter-miss");
  expect(dimmed.props.className).toContain("atlas-candidate");
  expect(dimmed.props.disabled).toBeUndefined();
  expect(dimmed.props["aria-disabled"]).toBeUndefined();
  dimmed.props.onClick({ctrlKey: false}); dimmed.props.onClick({ctrlKey: true});
  expect(onCell.mock.calls).toEqual([[1, 0, false], [1, 0, true]]);
  ui.reset.props.onClick();
  expect(render().cells.every(e => !e.props.className.includes("edge-filter-miss"))).toBe(true);
  ui = render();
  ui.input("Left").props.onChange({target: {value: "0"}});
  expect(render().input("Left").props.value).toBe(0);
  ui = render(); ui.input("Left").props.onChange({target: {value: ""}});
  expect(render().cells.every(e => !e.props.className.includes("edge-filter-miss"))).toBe(true);
});

it("filters soul's own shifted pixels, mirrors edges, and isolates source settings", async () => {
  let ui=render();
  ui.input("Left").props.onChange({target:{value:"7"}});
  ui=render();
  all(ui.tree,e=>e.props['aria-label']==='Soul fire')[0].props.onClick();
  ui=render();
  expect(ui.input("Left").props.value).toBe("");
  cleanup=hooks.effects.map(effect=>effect());
  await Promise.resolve();await Promise.resolve();
  ui=render();
  // Test sheet 0's pixel row 0 maps to normalized animation row 16.
  const own=ui.cells.find(e=>e.props['aria-label'].startsWith('row 16, sheet 0, normal'))!;
  expect(own.props.title).toMatch(/left 3.*right 7.*bottom white 5/);
  const mirrored=ui.cells.find(e=>e.props['aria-label'].startsWith('row 16, sheet 0, mirrored'))!;
  expect(mirrored.props.title).toMatch(/left 7.*right 3/);
  ui.input("Left").props.onChange({target:{value:"3"}});ui=render();
  ui.whiteInput("Minimum").props.onChange({target:{value:"5"}});ui=render();
  expect(ui.cells.filter(e=>!e.props.className.includes('edge-filter-miss'))).toHaveLength(1);
  const kept=ui.cells.find(e=>!e.props.className.includes('edge-filter-miss'))!;
  kept.props.onContextMenu({preventDefault:vi.fn(),stopPropagation:vi.fn()});ui=render();
  expect(ui.cells.every(e=>e.props.className.includes('edge-filter-miss'))).toBe(true);
  const rejected=ui.cells.find(e=>e.props.className.includes('manual-filter-miss'))!;
  onAlternative.mockClear();rejected.props.onClick({ctrlKey:false});
  expect(onAlternative).toHaveBeenCalledWith({atlas:'soul_fire_0',sheet:0,row:16,mirrored:false},false);
  all(ui.tree,e=>e.props['aria-label']==='Fire')[0].props.onClick();ui=render();
  expect(ui.input("Left").props.value).toBe(7);
  expect(ui.cells.every(e=>!e.props.className.includes('manual-filter-miss'))).toBe(true);
  all(ui.tree,e=>e.props['aria-label']==='Soul fire')[0].props.onClick();ui=render();
  expect(ui.input("Left").props.value).toBe(3);
  expect(ui.whiteInput("Minimum").props.value).toBe(5);
  ui.reset.props.onClick();ui=render();
  all(ui.tree,e=>e.props['aria-label']==='Fire')[0].props.onClick();
  expect(render().input("Left").props.value).toBe(7);
});

it("reports first-person availability immediately when changing atlas tabs", () => {
  const report=vi.fn();
  function draw(){hooks.si=hooks.ri=0;hooks.effects=[];return Picker({extraSources:true,view,cell:40,onCell,onFirstPersonAllowedChange:report});}
  let root=draw();
  const reportEffect=()=>hooks.effects.find(effect=>effect.toString().includes("onFirstPersonAllowedChange"))!();
  reportEffect();expect(report).toHaveBeenLastCalledWith(true);
  all(root,e=>e.props['aria-label']==='Soul fire')[0].props.onClick();root=draw();
  reportEffect();expect(report).toHaveBeenLastCalledWith(false);
  all(root,e=>e.props['aria-label']==='Fire')[0].props.onClick();draw();
  reportEffect();expect(report).toHaveBeenLastCalledWith(true);
});
