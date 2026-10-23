import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXACT_DELAY_MS, exactFrameUrl, nativeFrame, showsExactFrame } from "./exactFrame";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).buffer;
let made: Blob[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  made = [];
  vi.stubGlobal("URL", { createObjectURL: (blob: Blob) => { made.push(blob); return `blob:exact-${made.length}`; } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function request(extra: Partial<Parameters<typeof exactFrameUrl>[0]> = {}) {
  const load = vi.fn(async (_frame: number) => PNG);
  return { load, signal: new AbortController().signal, isCurrent: () => true, frame: 7, ...extra, ...(extra.load ? {} : { load }) };
}

describe("loading the full-quality paused frame", () => {
  it("waits a moment, then loads that frame and gives a PNG object URL", async () => {
    const r = request();
    const url = exactFrameUrl(r);
    expect(r.load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(EXACT_DELAY_MS);
    expect(r.load).toHaveBeenCalledExactlyOnceWith(7);
    expect(await url).toBe("blob:exact-1");
    expect(made[0].type).toBe("image/png");
  });

  it("never decodes when the frame changes during the wait (stepping through frames)", async () => {
    const controller = new AbortController();
    const r = request({ signal: controller.signal });
    const url = exactFrameUrl(r);
    await vi.advanceTimersByTimeAsync(EXACT_DELAY_MS / 2);
    controller.abort();
    await vi.advanceTimersByTimeAsync(EXACT_DELAY_MS);
    expect(await url).toBeNull();
    expect(r.load).not.toHaveBeenCalled();
  });

  it("drops a picture that arrives after the playhead moved on or playback started", async () => {
    let current = true;
    const r = request({ isCurrent: () => current, load: vi.fn(async () => { current = false; return PNG; }) });
    const url = exactFrameUrl(r);
    await vi.advanceTimersByTimeAsync(EXACT_DELAY_MS);
    expect(await url).toBeNull();
    expect(made).toEqual([]);
  });

  it("drops a picture whose request was cancelled while decoding", async () => {
    const controller = new AbortController();
    const r = request({ signal: controller.signal, load: vi.fn(async () => { controller.abort(); return PNG; }) });
    const url = exactFrameUrl(r);
    await vi.advanceTimersByTimeAsync(EXACT_DELAY_MS);
    expect(await url).toBeNull();
    expect(made).toEqual([]);
  });

  it("keeps the current picture when the decode fails or returns something that is not a PNG", async () => {
    const failed = exactFrameUrl(request({ load: vi.fn(async () => { throw new Error("ffmpeg failed"); }) }));
    const junk = exactFrameUrl(request({ load: vi.fn(async () => new Uint8Array([0xff, 0xd8, 0xff]).buffer) }));
    const empty = exactFrameUrl(request({ load: vi.fn(async () => new ArrayBuffer(0)) }));
    await vi.advanceTimersByTimeAsync(EXACT_DELAY_MS);
    expect([await failed, await junk, await empty]).toEqual([null, null, null]);
    expect(made).toEqual([]);
  });
});

describe("when the full-quality frame replaces the display JPEG", () => {
  it("only on a paused video frame that no correction changed", () => {
    expect(showsExactFrame({ playing: false, stillImage: false, corrected: false })).toBe(true);
    expect(showsExactFrame({ playing: true, stillImage: false, corrected: false })).toBe(false);
    expect(showsExactFrame({ playing: false, stillImage: true, corrected: false })).toBe(false);
    expect(showsExactFrame({ playing: false, stillImage: false, corrected: true })).toBe(false);
  });
});

import { pngSize } from "./exactFrame";
describe("the size of a full-quality frame", () => {
  it("is read from its PNG header", () => {
    const png = new Uint8Array(24); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(png.buffer).setUint32(16, 2560); new DataView(png.buffer).setUint32(20, 1440);
    expect(pngSize(png.buffer)).toEqual({ width: 2560, height: 1440 });
  });
  it("is unknown for anything else", () => {
    expect(pngSize(new Uint8Array([1, 2, 3]).buffer)).toBeNull();
  });
});

it('the native frame is the exact PNG, or the display JPEG when exact frames are unavailable or fail', async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer, jpeg = new Uint8Array([0xff, 0xd8]).buffer;
  const frame = vi.fn(async () => jpeg);
  const exact = await nativeFrame({ frame, exactFrame: vi.fn(async () => png) }, 7);
  expect([exact.type, exact.size]).toEqual(["image/png", 4]);
  expect(frame).not.toHaveBeenCalled();
  const display = await nativeFrame({ frame }, 7);
  expect([display.type, display.size]).toEqual(["image/jpeg", 2]);
  const failed = await nativeFrame({ frame, exactFrame: vi.fn(async () => { throw Error("decode failed"); }) }, 7);
  expect(failed.type).toBe("image/jpeg");
  await expect(nativeFrame({ frame: vi.fn(async () => { throw Error("no video"); }) }, 7)).rejects.toThrow("no video");
});
