import { afterEach, expect, it, vi } from "vitest";
import { copyComparisonProof, createComparisonProof, proofCrop, proofLayout, proofOpacity, type ProofMask } from "./comparisonProof";
const native = vi.hoisted(() => ({ save: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: native.save }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("keeps tiny captions readable and bounds huge photos without distorting them", () => {
  const tiny = proofLayout(16, 16); expect(tiny.panelWidth).toBeGreaterThanOrEqual(360);
  const huge = proofLayout(16000, 8000); expect(huge.panelWidth).toBe(4096); expect(huge.panelHeight).toBe(2048);
  expect(() => proofLayout(0, 1080)).toThrow("not ready");
});
it("crops around the aligned fire with context and clips to the source frame", () => {
  expect(proofCrop(1920, 1080, [{x: 900, y: 500, width: 40, height: 60}])).toEqual({x: 888, y: 488, width: 64, height: 84});
  expect(proofCrop(100, 100, [{x: -10, y: 5, width: 30, height: 40}])).toEqual({x: 0, y: 0, width: 28, height: 53});
  expect(proofCrop(1920, 1080, [])).toEqual({x: 0, y: 0, width: 1920, height: 1080});
  expect(() => proofCrop(100, 100, [{x: 150, y: 20, width: 10, height: 10}])).toThrow("outside");
  expect(() => proofCrop(100, 100, [{x: NaN, y: 20, width: 10, height: 10}])).toThrow("invalid");
  const union = proofCrop(1000, 1000, [{x: 100, y: 400, width: 100, height: 100}, {x: 800, y: 400, width: 100, height: 100}]);
  expect(union.x).toBe(0); expect(union.width).toBe(1000); // Both HUD flames must be included.
});
it.each([true, false])("uses identical source crops for both pictures and the rendered mask (explicit bounds: %s)", async explicit => {
  const drawImage = vi.fn(), fillText = vi.fn();
  const context = {drawImage, fillText, fillRect: vi.fn()};
  const canvas = {width: 0, height: 0, getContext: () => context, toBlob: (done: (blob: Blob) => void) => done(new Blob(["png"], {type: "image/png"}))};
  vi.stubGlobal("document", {createElement: () => canvas});
  vi.stubGlobal("XMLSerializer", class {serializeToString() {return "<svg/>";}});
  vi.stubGlobal("Image", class {onload?: () => void; set src(_: string) {this.onload?.();}});
  const polygon = {getAttribute: () => "900,500 940,500 940,560 900,560"};
  const svg = {querySelector: (selector: string) => selector === "polygon, image" ? polygon : null, querySelectorAll: (selector: string) => selector === "polygon" ? [polygon] : [], cloneNode: () => svg, removeAttribute: vi.fn(), setAttribute: vi.fn()} as unknown as SVGSVGElement;
  const picture = {complete: true, naturalWidth: 1920, naturalHeight: 1080} as HTMLImageElement;
  const mask: ProofMask = {svg, description: "Quad · row 6 · sheet 0 · normal", opacity: 1, ...(explicit ? {bounds: {x: 900, y: 500, width: 40, height: 60}} : {})};
  expect((await createComparisonProof(picture, [mask], "Frame 8094")).type).toBe("image/png");
  expect(drawImage).toHaveBeenCalledTimes(3);
  for (const call of drawImage.mock.calls) expect(call.slice(1, 5)).toEqual([888, 488, 64, 84]);
  expect(drawImage.mock.calls[0][5]).toBe(0);
  expect(drawImage.mock.calls[1].slice(5)).toEqual(drawImage.mock.calls[2].slice(5));
  expect(drawImage.mock.calls[0].slice(6)).toEqual(drawImage.mock.calls[1].slice(6));
  expect(fillText.mock.calls.some(call => String(call[0]).includes("crop 888,488 · 64×84 source px"))).toBe(true);
  expect(fillText.mock.calls.some(call => call[0] === mask.description)).toBe(true);
});
it("shows a temporarily hidden mask in proof and keeps a visible mask's chosen opacity", () => {
  expect(proofOpacity(0)).toBe(1); expect(proofOpacity(0.6)).toBe(0.6);
});
it("copies generated PNG bytes through the native clipboard with no save dialog", async () => {
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} }); native.invoke.mockResolvedValue(undefined);
  await copyComparisonProof(new Blob([new Uint8Array([137,80,78,71])],{type:"image/png"}));
  expect(native.invoke).toHaveBeenCalledWith("copy_comparison_proof",{png:[137,80,78,71]});
  expect(native.save).not.toHaveBeenCalled();
});
it("surfaces clipboard errors without falling back to file saving", async () => {
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });native.invoke.mockRejectedValue(Error("Clipboard busy"));
  await expect(copyComparisonProof(new Blob(["image"]))).rejects.toThrow("Clipboard busy");
  expect(native.save).not.toHaveBeenCalled();
});
it("starts browser image copying while the proof is still rendering",async()=>{
  vi.stubGlobal("window",{});const write=vi.fn(async()=>{});vi.stubGlobal("navigator",{clipboard:{write}});
  const item=vi.fn(function(this:any,data:any){this.data=data;});vi.stubGlobal("ClipboardItem",item);
  const pending=new Promise<Blob>(()=>{});await copyComparisonProof(pending);
  expect(item).toHaveBeenCalledWith({"image/png":pending});expect(write).toHaveBeenCalledOnce();expect(native.save).not.toHaveBeenCalled();
});
it("reports unsupported clipboard rather than downloading a file",async()=>{
  vi.stubGlobal("window",{});vi.stubGlobal("ClipboardItem",undefined);
  await expect(copyComparisonProof(new Blob(["image"]))).rejects.toThrow("clipboard is unavailable");expect(native.save).not.toHaveBeenCalled();
});
