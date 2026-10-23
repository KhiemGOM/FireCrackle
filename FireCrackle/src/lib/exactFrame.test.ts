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

import { PAUSE_SETTLE_MS, PausedExact } from "./exactFrame";
describe("the paused frame's full-quality picture across pauses, steps and re-runs", () => {
  function setup() {
    const paused = new PausedExact();
    const load = vi.fn(async (_frame: number) => PNG);
    const ask = (frame: number, extra: Partial<Parameters<PausedExact["bytes"]>[0]> = {}) =>
      paused.bytes({ video: "a.mkv", frame, load, signal: new AbortController().signal, isCurrent: () => true, ...extra });
    return { paused, load, ask };
  }
  /** The request, once the pause has settled. */
  const settled = async <T,>(p: Promise<T>) => { await vi.advanceTimersByTimeAsync(PAUSE_SETTLE_MS); return p; };

  it("waits only a short settle when playback stops, not a frame step's wait: pausing is not a frame step", async () => {
    expect(PAUSE_SETTLE_MS).toBeLessThan(EXACT_DELAY_MS / 2);
    const { paused, load, ask } = setup();
    paused.playing();
    const bytes = ask(7);
    await vi.advanceTimersByTimeAsync(PAUSE_SETTLE_MS - 1);
    expect(load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledExactlyOnceWith(7);
    expect(await bytes).toBe(PNG);
  });

  it("takes the last playback step landing just after the pause as the paused frame: only it loads, with no step wait", async () => {
    const { paused, load, ask } = setup();
    paused.playing();
    const first = new AbortController();
    const dropped = ask(7, { signal: first.signal });
    await vi.advanceTimersByTimeAsync(PAUSE_SETTLE_MS / 2);
    first.abort(); // the step that was on its way when Space was pressed moved the playhead to 8
    const landed = ask(8);
    await vi.advanceTimersByTimeAsync(PAUSE_SETTLE_MS);
    expect(load.mock.calls.map(c => c[0])).toEqual([8]);
    expect([await dropped, await landed]).toEqual([null, PNG]);
  });

  it("settles the same way for the first frame shown (a video just opened)", async () => {
    const { load, ask } = setup();
    void ask(0);
    await vi.advanceTimersByTimeAsync(PAUSE_SETTLE_MS);
    expect(load).toHaveBeenCalledOnce();
  });

  it("still waits when stepping to another frame, so stepping never queues a decode per step", async () => {
    const { paused, load, ask } = setup();
    paused.playing();
    await settled(ask(7));
    const steps = [8, 9, 10].map(frame => { const c = new AbortController(); return { c, got: ask(frame, { signal: c.signal }) }; });
    steps.slice(0, 2).forEach(s => s.c.abort()); // each step replaces the one before within the wait
    await vi.advanceTimersByTimeAsync(EXACT_DELAY_MS - 1);
    expect(load.mock.calls.map(c => c[0])).toEqual([7]);
    await vi.advanceTimersByTimeAsync(1);
    expect(load.mock.calls.map(c => c[0])).toEqual([7, 10]);
    expect([await steps[0].got, await steps[1].got, await steps[2].got]).toEqual([null, null, PNG]);
  });

  it("gives a re-run on the same frame (its GUI mask arrived, a setting changed) the picture already fetched, without waiting", async () => {
    const { paused, load, ask } = setup();
    paused.playing();
    await settled(ask(7));
    expect(paused.has("a.mkv", 7)).toBe(true);
    const again = ask(7);
    await vi.advanceTimersByTimeAsync(0);
    expect(await again).toBe(PNG);
    expect(load).toHaveBeenCalledOnce();
  });

  it("shares a load still on its way with the re-run, even though the first run was cancelled", async () => {
    const { paused, ask } = setup();
    let finish!: (b: ArrayBuffer) => void;
    const load = vi.fn((_f: number) => new Promise<ArrayBuffer>(r => { finish = r; }));
    paused.playing();
    const first = new AbortController();
    const dropped = ask(7, { load, signal: first.signal });
    await vi.advanceTimersByTimeAsync(PAUSE_SETTLE_MS);
    first.abort(); // the effect re-ran
    const rerun = ask(7, { load });
    expect(paused.has("a.mkv", 7)).toBe(true);
    finish(PNG);
    expect([await dropped, await rerun]).toEqual([null, PNG]);
    expect(load).toHaveBeenCalledOnce();
  });

  it("goes back to the frame just fetched at once after a step away", async () => {
    const { paused, load, ask } = setup();
    paused.playing();
    await settled(ask(7));
    const away = new AbortController();
    void ask(8, { signal: away.signal });
    away.abort();
    const back = ask(7);
    await vi.advanceTimersByTimeAsync(0);
    expect(await back).toBe(PNG);
    expect(load).toHaveBeenCalledOnce();
  });

  it("never gives one video's picture for another video's frame", async () => {
    const { paused, load, ask } = setup();
    paused.playing();
    await settled(ask(7));
    expect(paused.has("b.mkv", 7)).toBe(false);
    paused.playing();
    await settled(ask(7, { video: "b.mkv" }));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps nothing without a video to tell pictures apart", async () => {
    const { paused, load, ask } = setup();
    paused.playing();
    expect(await settled(ask(7, { video: undefined }))).toBe(PNG);
    expect(paused.has(undefined, 7)).toBe(false);
    expect(await ask(7, { video: undefined })).toBe(PNG);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps nothing from a failed or invalid decode: the next request tries again", async () => {
    const { paused, ask } = setup();
    paused.playing();
    expect(await settled(ask(7, { load: vi.fn(async () => { throw Error("ffmpeg failed"); }) }))).toBeNull();
    expect(paused.has("a.mkv", 7)).toBe(false);
    expect(await ask(7, { load: vi.fn(async () => new Uint8Array([0xff, 0xd8]).buffer) })).toBeNull();
    expect(paused.has("a.mkv", 7)).toBe(false);
    const load = vi.fn(async () => PNG);
    expect(await ask(7, { load })).toBe(PNG);
    expect(load).toHaveBeenCalledOnce();
  });

  it("drops a picture that is no longer wanted, and never loads for a request cancelled before it began", async () => {
    const { paused, load, ask } = setup();
    paused.playing();
    expect(await settled(ask(7, { isCurrent: () => false }))).toBeNull();
    const c = new AbortController(); c.abort();
    paused.playing();
    expect(await ask(9, { signal: c.signal })).toBeNull();
    expect(load.mock.calls.map(call => call[0])).toEqual([7]);
  });
});
