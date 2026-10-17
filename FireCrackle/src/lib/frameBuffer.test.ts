import { describe, expect, it, vi } from "vitest";
import { FrameBuffer, type BufferIo, type BufferSettings } from "./frameBuffer";

const SETTINGS: BufferSettings = { ahead: 6, behind: 2, decodeAhead: 2, parallel: 3 };

/** A fake io whose fetches stay pending until the test settles them. */
function rig(frameCount = 1000, settings: Partial<BufferSettings> = {}, hold = false) {
  const pending = new Map<number, { resolve: (b: ArrayBuffer) => void; reject: (e: Error) => void }>();
  const fetched: number[] = [];
  let inflight = 0;
  let maxInflight = 0;
  let urlSeq = 0;
  const urls = new Map<string, number>();
  const revoked: string[] = [];
  const decoded: string[] = [];
  const io: BufferIo = {
    fetch: (frame) =>
      new Promise<ArrayBuffer>((resolve, reject) => {
        fetched.push(frame);
        inflight++;
        maxInflight = Math.max(maxInflight, inflight);
        pending.set(frame, {
          resolve: (b) => { inflight--; pending.delete(frame); resolve(b); },
          reject: (e) => { inflight--; pending.delete(frame); reject(e); },
        });
      }),
    createUrl: (bytes) => { const u = `blob:${++urlSeq}`; urls.set(u, new Uint8Array(bytes)[0]); return u; },
    revokeUrl: (u) => { revoked.push(u); },
    predecode: async (u) => { decoded.push(u); },
  };
  // the planner tests run without the hold; the "hold" tests at the end turn it on
  const buffer = new FrameBuffer(frameCount, io, { ...SETTINGS, ...settings }, hold);
  const bytes = (frame: number) => new Uint8Array([frame % 256]).buffer;
  const settle = async (frame: number) => { pending.get(frame)!.resolve(bytes(frame)); await tick(); };
  const fail = async (frame: number, message = "boom") => { pending.get(frame)!.reject(new Error(message)); await tick(); };
  return { buffer, io, pending, fetched, urls, revoked, decoded, bytes, settle, fail, maxInflight: () => maxInflight, inflight: () => inflight };
}
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const FWD = { dir: 1 as const, speed: 1 };
const BACK = { dir: -1 as const, speed: 1 };
const PAUSED = { dir: 0 as const, speed: 1 };

describe("load", () => {
  it("fetches a frame once and serves it from the buffer afterwards", async () => {
    const r = rig();
    const first = r.buffer.load(5);
    r.pending.get(5)!.resolve(r.bytes(5));
    expect(await first).toMatchObject({ fromBuffer: false });
    expect(new Uint8Array((await first).bytes)[0]).toBe(5);
    const second = await r.buffer.load(5);
    expect(second.fromBuffer).toBe(true);
    expect(r.fetched).toEqual([5]);
    expect(r.buffer.has(5)).toBe(true);
  });

  it("shares one fetch between concurrent loads of the same frame", async () => {
    const r = rig();
    const a = r.buffer.load(7);
    const b = r.buffer.load(7);
    r.pending.get(7)!.resolve(r.bytes(7));
    await Promise.all([a, b]);
    expect(r.fetched).toEqual([7]);
  });

  it("refuses frames outside the video without fetching", async () => {
    const r = rig(100);
    await expect(r.buffer.load(-1)).rejects.toThrow();
    await expect(r.buffer.load(100)).rejects.toThrow();
    await expect(r.buffer.load(1.5)).rejects.toThrow();
    await expect(r.buffer.load(NaN)).rejects.toThrow();
    expect(r.fetched).toEqual([]);
  });

  it("has nothing to load in a video without frames", async () => {
    const r = rig(0);
    await expect(r.buffer.load(0)).rejects.toThrow();
    r.buffer.prefetch(0, FWD);
    expect(r.fetched).toEqual([]);
  });

  it("rejects a failed fetch, caches nothing, and fetches again next time", async () => {
    const r = rig();
    const p = r.buffer.load(3);
    p.catch(() => {});
    await r.fail(3, "decode failed");
    await expect(p).rejects.toThrow("decode failed");
    expect(r.buffer.has(3)).toBe(false);
    const again = r.buffer.load(3);
    r.pending.get(3)!.resolve(r.bytes(3));
    await again;
    expect(r.fetched).toEqual([3, 3]);
  });
});

describe("prefetch: what and in which order", () => {
  it("playing forward fetches the frames ahead, nearest first, never behind", async () => {
    const r = rig();
    r.buffer.prefetch(100, FWD);
    expect(r.fetched).toEqual([101, 102, 103]);
    await r.settle(101);
    expect(r.fetched).toEqual([101, 102, 103, 104]);
    await r.settle(102); await r.settle(103); await r.settle(104);
    await r.settle(105); await r.settle(106);
    expect(r.fetched).toEqual([101, 102, 103, 104, 105, 106]); // ahead = 6
    expect(r.fetched.every((f) => f > 100)).toBe(true);
  });

  it("playing backward fetches behind the playhead only", () => {
    const r = rig();
    r.buffer.prefetch(100, BACK);
    expect(r.fetched).toEqual([99, 98, 97]);
  });

  it("paused fetches both sides, nearest first, the frame ahead before the one behind", () => {
    const r = rig();
    r.buffer.prefetch(100, PAUSED);
    expect(r.fetched).toEqual([101, 99, 102]);
  });

  it("never has more than `parallel` fetches in flight", async () => {
    const r = rig(1000, { parallel: 2, ahead: 20 });
    r.buffer.prefetch(100, FWD);
    for (let f = 101; f <= 120; f++) { expect(r.inflight()).toBeLessThanOrEqual(2); if (r.pending.has(f)) await r.settle(f); }
    expect(r.maxInflight()).toBe(2);
  });

  it("at speed 4 fetches every 4th frame, which are the ones that will be shown", () => {
    const r = rig(1000, { ahead: 6 });
    r.buffer.prefetch(100, { dir: 1, speed: 4 });
    expect(r.fetched).toEqual([104, 108, 112]);
  });

  it("skips frames already buffered and does not fetch the one being shown again", async () => {
    const r = rig();
    const shown = r.buffer.load(100); await r.settle(100); await shown;
    r.buffer.prefetch(100, FWD);
    await r.settle(101);
    r.buffer.prefetch(100, FWD);
    expect(r.fetched.filter((f) => f === 100)).toHaveLength(1);
    expect(r.fetched.filter((f) => f === 101)).toHaveLength(1);
  });

  it("stays inside the video at both ends", async () => {
    const end = rig(100);
    end.buffer.prefetch(99, FWD);
    expect(end.fetched).toEqual([]);
    end.buffer.prefetch(97, FWD);
    expect(end.fetched).toEqual([98, 99]);
    const start = rig(100);
    start.buffer.prefetch(0, BACK);
    expect(start.fetched).toEqual([]);
    start.buffer.prefetch(1, BACK);
    expect(start.fetched).toEqual([0]);
  });

  it("fetches nothing ahead when ahead is 0 and survives odd settings", () => {
    const none = rig(1000, { ahead: 0 });
    none.buffer.prefetch(100, FWD);
    expect(none.fetched).toEqual([]);
    const odd = rig(1000, { ahead: NaN, behind: -1, decodeAhead: Infinity, parallel: 0 });
    expect(() => odd.buffer.prefetch(100, FWD)).not.toThrow();
    expect(odd.fetched.length).toBeLessThanOrEqual(1); // parallel is at least 1
  });
});

describe("prefetch: changes of direction and place", () => {
  it("drops queued work for the old direction when playback reverses", async () => {
    const r = rig();
    r.buffer.prefetch(100, FWD);
    expect(r.fetched).toEqual([101, 102, 103]);
    r.buffer.prefetch(100, BACK);
    await r.settle(101); // a slot frees up: the next fetch is behind, not 104
    expect(r.fetched.slice(3)).toEqual([99]);
  });

  it("discards what an old place was still fetching after a seek", async () => {
    const r = rig(10000);
    r.buffer.prefetch(100, FWD);
    r.buffer.prefetch(5000, FWD);
    await r.settle(101); await r.settle(102); await r.settle(103);
    expect([101, 102, 103].some((f) => r.buffer.has(f))).toBe(false);
    expect(r.fetched.slice(3).every((f) => f > 5000)).toBe(true);
  });

  it("evicts frames outside the window and revokes their URLs", async () => {
    const r = rig();
    for (const f of [90, 95, 100, 101, 102]) { const p = r.buffer.load(f); await r.settle(f); await p; }
    r.buffer.urlFor(90); r.buffer.urlFor(95);
    const [u90, u95] = [r.buffer.urlFor(90)!, r.buffer.urlFor(95)!];
    r.buffer.prefetch(100, PAUSED); // window is [98, 106]
    expect(r.buffer.has(90)).toBe(false);
    expect(r.buffer.has(95)).toBe(false);
    expect(r.buffer.has(100)).toBe(true);
    expect(r.buffer.has(102)).toBe(true);
    expect(r.revoked).toEqual(expect.arrayContaining([u90, u95]));
  });

  it("never revokes the URL on screen, until another frame is shown", async () => {
    const r = rig();
    const p = r.buffer.load(95); await r.settle(95); await p;
    const url = r.buffer.urlFor(95)!;
    r.buffer.show(95);
    r.buffer.prefetch(100, PAUSED); // 95 is now outside the window, but it is still what the user sees
    expect(r.revoked).not.toContain(url);
    r.buffer.show(100);
    r.buffer.prefetch(100, PAUSED);
    expect(r.revoked).toContain(url);
  });
});

describe("decoded URLs", () => {
  it("starts the decoding of only the next few frames in the direction of play", async () => {
    const r = rig();
    r.buffer.prefetch(100, FWD);
    for (const f of [101, 102, 103]) await r.settle(f);
    await tick();
    expect(r.decoded).toEqual([r.buffer.urlFor(101), r.buffer.urlFor(102)]); // decodeAhead = 2; 103 gets none
  });

  it("urlFor gives a stable URL for a buffered frame and null for one that is not", async () => {
    const r = rig();
    expect(r.buffer.urlFor(10)).toBeNull();
    const p = r.buffer.load(10); await r.settle(10); await p;
    const a = r.buffer.urlFor(10);
    expect(a).toBeTruthy();
    expect(r.buffer.urlFor(10)).toBe(a);
  });
});

describe("failures and the end", () => {
  it("a failed prefetch is silent and not retried until the playhead moves", async () => {
    const r = rig();
    const nodeProcess = (globalThis as unknown as { process: { once(e: string, f: () => void): void; off(e: string, f: () => void): void } }).process;
    const unhandled = vi.fn();
    nodeProcess.once("unhandledRejection", unhandled);
    r.buffer.prefetch(100, FWD);
    await r.fail(101);
    r.buffer.prefetch(100, FWD);
    r.buffer.prefetch(100, FWD);
    expect(r.fetched.filter((f) => f === 101)).toHaveLength(1);
    r.buffer.prefetch(100, PAUSED); // same place: still no retry
    r.buffer.prefetch(101, FWD); // the playhead moved: 101 itself is now the playhead, 102+ continue
    await tick();
    expect(unhandled).not.toHaveBeenCalled();
    nodeProcess.off("unhandledRejection", unhandled);
  });

  it("dispose revokes every URL, ignores late results and refuses new work", async () => {
    const r = rig();
    const p = r.buffer.load(10); await r.settle(10); await p;
    const url = r.buffer.urlFor(10)!;
    r.buffer.prefetch(10, FWD);
    r.buffer.dispose();
    expect(r.revoked).toContain(url);
    await r.settle(11);
    expect(r.buffer.has(11)).toBe(false);
    const before = r.fetched.length;
    r.buffer.prefetch(10, FWD);
    expect(r.fetched.length).toBe(before);
    await expect(r.buffer.load(12)).rejects.toThrow();
  });
});

describe("counting", () => {
  it("counts the contiguous buffered frames ahead of the playhead", async () => {
    const r = rig();
    for (const f of [101, 102, 103, 105]) { const p = r.buffer.load(f); await r.settle(f); await p; }
    expect(r.buffer.aheadCount(100, 1)).toBe(3);
    expect(r.buffer.aheadCount(100, -1)).toBe(0);
    expect(r.buffer.aheadCount(104, 1)).toBe(1);
  });

  it("takes new settings without losing what it holds", async () => {
    const r = rig();
    const p = r.buffer.load(100); await r.settle(100); await p;
    r.buffer.setSettings({ ahead: 2, behind: 2, decodeAhead: 1, parallel: 1 });
    r.buffer.prefetch(100, FWD);
    expect(r.fetched.slice(1)).toEqual([101]);
    expect(r.buffer.has(100)).toBe(true);
  });
});

describe("holding: no look-ahead until the playhead's own frame is here", () => {
  // After a seek none of the neighbours is in the backend's cache yet; each request for one starts a decode of its own.
  // Asking for the sought frame first lets that one decode fill the cache, and the neighbours that follow are hits.
  it("fetches nothing ahead while the playhead's frame has not arrived", async () => {
    const r = rig(10000, {}, true);
    r.buffer.prefetch(5000, FWD);
    expect(r.fetched).toEqual([]);
    const p = r.buffer.load(5000); // what the pane does for the frame it shows
    expect(r.fetched).toEqual([5000]);
    expect(r.maxInflight()).toBe(1);
    await r.settle(5000); await p;
    expect(r.fetched.slice(1)).toEqual([5001, 5002, 5003]); // now they go, nearest first
  });

  it("goes ahead at once when the playhead's frame is already buffered (steady play)", async () => {
    const r = rig(1000, {}, true);
    for (const f of [100, 101]) { const p = r.buffer.load(f); await r.settle(f); await p; }
    r.buffer.prefetch(101, FWD);
    expect(r.fetched.slice(2)).toEqual([102, 103, 104]);
  });

  it("holds again at a seek from a full buffer, and clears the old window only when the new frame is in", async () => {
    const r = rig(10000, {}, true);
    for (const f of [100, 101, 102]) { const p = r.buffer.load(f); await r.settle(f); await p; }
    r.buffer.prefetch(100, FWD);
    const before = r.fetched.length;
    r.buffer.prefetch(7000, FWD);
    expect(r.fetched.length).toBe(before); // the seek asks for nothing until its own frame is loaded
    for (const f of [103, 104, 105]) await r.settle(f); // what the old place still had on its way finishes...
    expect(r.fetched.length).toBe(before); // ...and starts nothing new there
    const p = r.buffer.load(7000); await r.settle(7000); await p;
    expect(r.buffer.has(101)).toBe(false); // the old place is evicted once the new one is established
    expect(r.fetched.filter((f) => f > 7000).slice(0, 3)).toEqual([7001, 7002, 7003]);
  });

  it("a newer seek replaces an older one that is still waiting", async () => {
    const r = rig(10000, {}, true);
    r.buffer.prefetch(5000, FWD);
    r.buffer.prefetch(7000, FWD);
    const a = r.buffer.load(5000); const b = r.buffer.load(7000);
    await r.settle(5000);
    expect(r.fetched.filter((f) => f > 5000 && f < 5010)).toEqual([]); // 5000 is no longer where the playhead is
    await r.settle(7000); await a; await b;
    expect(r.fetched.filter((f) => f > 7000)).toEqual([7001, 7002, 7003]);
  });

  it("never goes ahead of a frame that failed to load", async () => {
    const r = rig(1000, {}, true);
    r.buffer.prefetch(300, FWD);
    const p = r.buffer.load(300); p.catch(() => {});
    await r.fail(300);
    await expect(p).rejects.toThrow();
    expect(r.fetched).toEqual([300]);
  });

  it("does nothing by itself: the frame it waits for has to be loaded by the caller", () => {
    const r = rig(1000, {}, true);
    r.buffer.prefetch(100, FWD);
    expect(r.fetched).toEqual([]);
  });

  it("ignores positions outside the video and does nothing once closed", () => {
    const r = rig(100, {}, true);
    r.buffer.prefetch(-1, FWD); r.buffer.prefetch(100, FWD); r.buffer.prefetch(NaN, FWD);
    r.buffer.dispose();
    r.buffer.prefetch(5, FWD);
    expect(r.fetched).toEqual([]);
  });
});
