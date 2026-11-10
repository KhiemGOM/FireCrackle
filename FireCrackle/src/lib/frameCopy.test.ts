import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./proofExport", () => ({ copyPicture: vi.fn(async (picture: Blob | Promise<Blob>) => { await picture; }), savePicture: vi.fn(async () => true) }));
vi.mock("./canvas", () => ({
  loadImageBytes: vi.fn(async () => ({ naturalWidth: 640, naturalHeight: 360 })),
  canvasBlob: vi.fn(async () => new Blob([png(640, 360)], { type: "image/png" })),
}));
import { copyPicture, savePicture } from "./proofExport";
import { canvasBlob, loadImageBytes } from "./canvas";
import { copyFrame, copyFrameKey, frameFilename, framePng, saveFrame } from "./frameCopy";

/** A PNG header that says `width` × `height` (enough for pngSize). */
function png(width: number, height: number): ArrayBuffer {
  const bytes = new Uint8Array(24), view = new DataView(bytes.buffer);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  view.setUint32(16, width); view.setUint32(20, height);
  return bytes.buffer;
}
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer;
const drawImage = vi.fn();

beforeEach(() => {
  vi.mocked(copyPicture).mockClear(); vi.mocked(savePicture).mockClear(); vi.mocked(canvasBlob).mockClear(); vi.mocked(loadImageBytes).mockClear(); drawImage.mockClear();
  vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage }) }) });
});
afterEach(() => vi.unstubAllGlobals());

const key = (extra: Partial<Parameters<typeof copyFrameKey>[0]> = {}) =>
  copyFrameKey({ key: "C", ctrlKey: true, metaKey: false, altKey: false, shiftKey: true, repeat: false, blocked: false, ...extra });

describe("the copy-frame shortcut", () => {
  it("is Ctrl+Shift+C, whatever case the key arrives in, and Cmd counts as Ctrl", () => {
    expect(key()).toBe(true);
    expect(key({ key: "c" })).toBe(true);
    expect(key({ ctrlKey: false, metaKey: true })).toBe(true);
  });
  it("leaves plain Ctrl+C (text copy), C, Shift+C and Ctrl+Alt+Shift+C alone", () => {
    expect(key({ shiftKey: false })).toBe(false);
    expect(key({ ctrlKey: false })).toBe(false);
    expect(key({ ctrlKey: false, shiftKey: false })).toBe(false);
    expect(key({ altKey: true })).toBe(false);
    expect(key({ key: "V" })).toBe(false);
  });
  it("does not fire again while held, or while typing in a field", () => {
    expect(key({ repeat: true })).toBe(false);
    expect(key({ blocked: true })).toBe(false);
  });
});

describe("the picture of a frame", () => {
  it("is the video's own full-resolution PNG of that frame, untouched", async () => {
    const exact = png(2560, 1440);
    const backend = { exactFrame: vi.fn(async () => exact), frame: vi.fn(async () => JPEG) };
    const picture = await framePng({ backend, frame: 42 });
    expect(backend.exactFrame).toHaveBeenCalledExactlyOnceWith(42);
    expect(backend.frame).not.toHaveBeenCalled();
    expect(picture).toMatchObject({ width: 2560, height: 1440, native: true });
    expect(picture.png.type).toBe("image/png");
    expect(new Uint8Array(await picture.png.arrayBuffer())).toEqual(new Uint8Array(exact));
    expect(canvasBlob).not.toHaveBeenCalled();
  });
  it("falls back to the display picture, converted to PNG, when the full-resolution frame fails", async () => {
    const backend = { exactFrame: vi.fn(async () => { throw Error("decoder busy"); }), frame: vi.fn(async () => JPEG) };
    const picture = await framePng({ backend, frame: 3 });
    expect(backend.frame).toHaveBeenCalledExactlyOnceWith(3);
    expect(picture).toMatchObject({ width: 640, height: 360, native: false });
    expect(picture.png.type).toBe("image/png");
    expect(drawImage).toHaveBeenCalledOnce();
  });
  it("converts the display picture of a backend without full-resolution frames", async () => {
    const picture = await framePng({ backend: { frame: vi.fn(async () => JPEG) }, frame: 0 });
    expect(picture).toMatchObject({ width: 640, height: 360, native: false });
  });
  it("is the image itself in the Images tab: a PNG file as it is, anything else converted", async () => {
    const file = new Blob([png(800, 600)], { type: "image/png" });
    expect(await framePng({ still: { name: "shot.png", url: "blob:shot", file } })).toMatchObject({ png: file, width: 800, height: 600, native: true });
    vi.stubGlobal("fetch", vi.fn(async () => ({ blob: async () => new Blob([JPEG], { type: "image/jpeg" }) })));
    expect(await framePng({ still: { name: "shot.jpg", url: "blob:shot" } })).toMatchObject({ width: 640, height: 360, native: true });
    expect(fetch).toHaveBeenCalledWith("blob:shot");
  });
  it("reports a picture that cannot be encoded instead of copying nothing", async () => {
    vi.mocked(canvasBlob).mockRejectedValueOnce(Error("Could not encode the frame."));
    await expect(framePng({ backend: { frame: async () => JPEG }, frame: 1 })).rejects.toThrow("Could not encode the frame.");
  });
});

describe("copying and saving", () => {
  it("copies the PNG and says which frame and size it was", async () => {
    const backend = { exactFrame: async () => png(1920, 1080), frame: async () => JPEG };
    expect(await copyFrame({ backend, frame: 12 })).toBe("Copied frame 12 · 1920 × 1080");
    const sent = await vi.mocked(copyPicture).mock.calls[0][0];
    expect(sent.type).toBe("image/png");
  });
  it("says when only the display picture could be copied", async () => {
    expect(await copyFrame({ backend: { frame: async () => JPEG }, frame: 5 })).toBe("Copied frame 5 · 640 × 360 (display quality)");
  });
  it("hands the clipboard the picture's promise at once, so the browser keeps the click's permission", () => {
    void copyFrame({ backend: { frame: async () => JPEG }, frame: 5 });
    expect(copyPicture).toHaveBeenCalledOnce();
  });
  it("fails with the clipboard's own reason", async () => {
    vi.mocked(copyPicture).mockRejectedValueOnce(Error("Clipboard is busy. Try copying again."));
    await expect(copyFrame({ backend: { frame: async () => JPEG }, frame: 5 })).rejects.toThrow("Clipboard is busy");
  });
  it("saves under a name for the frame, and reports a cancelled dialog", async () => {
    const backend = { exactFrame: async () => png(4, 4), frame: async () => JPEG };
    expect(await saveFrame({ backend, frame: 9 })).toBe("Saved frame 9");
    expect(vi.mocked(savePicture).mock.calls[0][1]).toBe("frame-9.png");
    vi.mocked(savePicture).mockResolvedValueOnce(false);
    expect(await saveFrame({ backend, frame: 9 })).toBeNull();
  });
  it("names files after the frame or the image", () => {
    expect(frameFilename({ backend: { frame: async () => JPEG }, frame: 123 })).toBe("frame-123.png");
    expect(frameFilename({ still: { name: "my shot.jpg", url: "" } })).toBe("my shot.png");
    expect(frameFilename({ still: { name: "", url: "" } })).toBe("image.png");
  });
});
