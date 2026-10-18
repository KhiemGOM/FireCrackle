import { afterEach, expect, it, vi } from "vitest";
import { copyComparisonProof, copyFormattedComparisonProof, createComparisonProof, downloadComparisonProof, proofCrop, proofLayout, proofOpacity, squareProofCrop, type ProofMask } from "./comparisonProof";
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
it("expands animation crops to a square without cutting off the fire", () => {
  expect(squareProofCrop(1920, 1080, {x: 888, y: 488, width: 64, height: 84})).toEqual({x: 878, y: 488, width: 84, height: 84});
  expect(squareProofCrop(100, 100, {x: 0, y: 0, width: 20, height: 40})).toEqual({x: 0, y: 0, width: 40, height: 40});
  expect(squareProofCrop(1920, 1080, {x: 0, y: 400, width: 1920, height: 300})).toEqual({x: 0, y: -420, width: 1920, height: 1920});
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

function downloadFixture() {
  const draws = vi.fn(), captions = vi.fn(), snapshots: number[] = [];
  const canvas = {width: 0, height: 0, getContext: () => ({drawImage: draws, fillText: captions, fillRect: vi.fn()}),
    toBlob: (done: (blob: Blob) => void, type: string) => {snapshots.push(draws.mock.calls.length); done(new Blob([String(draws.mock.calls.length)], {type}));}};
  vi.stubGlobal("document", {createElement: () => canvas});
  vi.stubGlobal("window", {__TAURI_INTERNALS__: {}});
  vi.stubGlobal("XMLSerializer", class {serializeToString() {return "<svg/>";}});
  vi.stubGlobal("Image", class {onload?: () => void; set src(_: string) {this.onload?.();}});
  const svg = {querySelector: (selector: string) => selector === "polygon, image" ? {} : null, querySelectorAll: () => [], cloneNode: () => svg, removeAttribute: vi.fn(), setAttribute: vi.fn()} as unknown as SVGSVGElement;
  const picture = {complete: true, naturalWidth: 1920, naturalHeight: 1080} as HTMLImageElement;
  const mask = {svg, description: "Quad · row 6 · sheet 0 · normal", opacity: 0.8, details: "H.264 · 1080p", bounds: {x: 900, y: 500, width: 40, height: 60}};
  native.save.mockResolvedValue("D:/proof/output"); native.invoke.mockResolvedValue(undefined);
  return {picture, mask, snapshots, captions, canvas};
}
it.each(["gif", "webp"] as const)("sends one square picture with fading overlay and static annotations for %s", async format => {
  const {picture, mask, snapshots, captions, canvas} = downloadFixture();
  expect(await downloadComparisonProof(picture, [mask], "Frame 8094", format)).toBe(true);
  expect(native.save).toHaveBeenCalledWith({defaultPath: `comparison-proof.${format}`, filters: [{name: format.toUpperCase(), extensions: [format]}]});
  expect(native.invoke).toHaveBeenCalledWith("save_comparison_proof", {path: "D:/proof/output", format, png: [50], base: [49]});
  expect(snapshots).toEqual([1, 2]); // one original picture frozen, then overlay added in exactly the same place
  expect(captions.mock.calls.map(call => call[0])).toContain("Opacity 0–80% · H.264 · 1080p");
  expect(captions.mock.calls.map(call => call[0])).toContain(mask.description);
  expect(canvas.width).toBeLessThanOrEqual(2048); expect(canvas.height).toBeLessThanOrEqual(2048);
  expect(canvas.width).toBe(784); expect(canvas.height).toBe(784);
  expect(captions.mock.calls.map(call => call[0])).toContain("Frame 8094");
  expect(captions.mock.calls.map(call => call[0])).not.toContain("After · mask comparison");
});
it.each(["png", "jpeg"] as const)("saves %s as a still with the same source details", async format => {
  const {picture, mask, snapshots} = downloadFixture();
  await downloadComparisonProof(picture, [mask], "Frame 8094", format);
  expect(native.invoke).toHaveBeenCalledWith("save_comparison_proof", {path: "D:/proof/output", format, png: [51], base: null});
  expect(snapshots).toEqual([3]);
});
it("does not write or claim success when the save dialog is cancelled", async () => {
  const {picture, mask} = downloadFixture(); native.save.mockResolvedValue(null);
  expect(await downloadComparisonProof(picture, [mask], "Frame 8094", "webp")).toBe(false);
  expect(native.invoke).not.toHaveBeenCalled();
});
it.each(["webp", "gif", "jpeg"] as const)("copies the actual %s file without opening a save dialog", async format => {
  const {picture, mask, snapshots} = downloadFixture();
  await copyFormattedComparisonProof(picture, [mask], "Frame 8094", format);
  expect(native.invoke).toHaveBeenCalledWith("copy_formatted_comparison_proof", {format, png: format === "jpeg" ? [51] : [50], base: format === "jpeg" ? null : [49]});
  expect(native.save).not.toHaveBeenCalled();
  expect(snapshots).toEqual(format === "jpeg" ? [3] : [1, 2]);
});
it("keeps PNG copying as image pixels, without a save dialog", async () => {
  const {picture, mask} = downloadFixture();
  await copyFormattedComparisonProof(picture, [mask], "Frame 8094", "png");
  expect(native.invoke).toHaveBeenCalledWith("copy_comparison_proof", {png: [51]});
  expect(native.save).not.toHaveBeenCalled();
});
