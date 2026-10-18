import {afterEach, expect, it, vi} from "vitest";
import type {ReactElement} from "react";
const hooks = vi.hoisted(() => ({open: false, setOpen: vi.fn()}));
vi.mock("react", async original => ({...await original<typeof import("react")>(), useState: () => [hooks.open, hooks.setOpen], useEffect: () => {}, useId: () => "proof-menu", useRef: () => ({current: null})}));
import {ComparisonProofButton, proofOptions} from "./ComparisonProofButton";
type Element = ReactElement<Record<string, any>>;
function nodes(node: Element): Element[] {return [node, ...[node.props.children].flat(Infinity).filter(child => child && typeof child === "object" && "props" in child).flatMap(nodes)];}
afterEach(() => {hooks.open = false; vi.clearAllMocks();});
it("defaults the main button to lossless WebP and keeps format selection separate", () => {
  const onExport = vi.fn();
  const tree = nodes(ComparisonProofButton({disabled: false, busy: false, onExport}));
  tree.find(node => node.props.label === "Comparison proof")!.props.onClick();
  expect(onExport).toHaveBeenCalledExactlyOnceWith({format: "webp", destination: "copy"});
  expect(tree.find(node => node.props.label === "Comparison proof")!.props.icon).toBe("copy");
  expect(tree.find(node => node.props.label === "Comparison proof")!.props["data-owns-keys"]).toBe("true");
  const trigger = tree.find(node => node.props["aria-haspopup"] === "menu")!;
  trigger.props.onClick(); expect(hooks.setOpen).toHaveBeenCalled();
  expect(onExport).toHaveBeenCalledOnce();
});
it("pairs every format's copy action with its own save icon", () => {
  hooks.open = true; const onExport = vi.fn();
  const tree = nodes(ComparisonProofButton({disabled: false, busy: false, onExport}));
  const options = tree.filter(node => node.props.role === "menuitem");
  expect(options.every(node => node.props["data-owns-keys"] === "true")).toBe(true);
  expect(options.map(node => node.props["aria-label"])).toEqual(proofOptions.flatMap(option => [`Copy ${option.format.toUpperCase()}`, `Save ${option.format.toUpperCase()}`]));
  expect(options.filter((_, i) => i % 2 === 0).map(node => node.props.children)).toEqual(proofOptions.map(option => option.text));
  options.forEach(node => node.props.onClick());
  expect(onExport.mock.calls.map(call => call[0])).toEqual(proofOptions.flatMap(option => [{format: option.format, destination: "copy"}, {format: option.format, destination: "save"}]));
});
it("disables both halves during export and supports Escape dismissal", () => {
  hooks.open = true;
  const tree = nodes(ComparisonProofButton({disabled: false, busy: true, onExport: vi.fn()}));
  expect(tree.find(node => node.props.label === "Comparison proof")!.props.disabled).toBe(true);
  expect(tree.find(node => node.props["aria-haspopup"] === "menu")!.props.disabled).toBe(true);
  const event = {key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn()};
  tree.find(node => node.props.role === "menuitem")!.props.onKeyDown(event);
  expect(event.preventDefault).toHaveBeenCalledOnce(); expect(event.stopPropagation).toHaveBeenCalledOnce(); expect(hooks.setOpen).toHaveBeenCalledWith(false);
});
