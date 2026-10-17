/** Bounded JPEG look-ahead. IO is injected; foreground loads and prefetch share one scheduler. */
export interface BufferSettings {
  ahead: number;
  behind: number;
  decodeAhead: number;
  parallel: number;
  lateShow?: number;
}
export const DEFAULT_BUFFER_SETTINGS: BufferSettings = { ahead: 90, behind: 30, decodeAhead: 8, parallel: 3, lateShow: 30 };
export interface BufferIo {
  fetch(frame: number): Promise<ArrayBuffer>;
  createUrl(bytes: ArrayBuffer): string;
  revokeUrl(url: string): void;
  predecode(url: string): Promise<void>;
}
export interface Motion { dir: -1 | 0 | 1; speed: number }
interface Entry { bytes: ArrayBuffer; url: string | null; warm: boolean }
interface Waiting { promise: Promise<ArrayBuffer>; resolve(bytes: ArrayBuffer): void; reject(error: Error): void }
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Math.floor(v) || 0));
const CACHE_BYTES = 64 * 1024 * 1024, FRAME_BYTES = 16 * 1024 * 1024;
const cancelled = () => new Error("frame request cancelled");

export class FrameBuffer {
  private readonly entries = new Map<number, Entry>();
  private readonly inflight = new Map<number, Promise<ArrayBuffer>>();
  private readonly queued = new Map<number, Waiting>();
  private readonly forced = new Map<number, Set<object>>();
  private readonly failed = new Set<number>();
  private ahead = 0;
  private behind = 0;
  private decodeAhead = 0;
  private parallel = 1;
  private warming = 0;
  private bytes = 0;
  private current = 0;
  private motion: Motion = { dir: 0, speed: 1 };
  private shownFrame: number | null = null;
  private waitingFor: { current: number; motion: Motion } | null = null;
  private started = false;
  private disposed = false;

  /** On a seek, fetch the target before neighbours: its native decode fills their cache too. */
  constructor(private readonly frameCount: number, private readonly io: BufferIo,
    settings: BufferSettings, private readonly holdForCurrent = true) { this.setSettings(settings); }
  setSettings(s: BufferSettings): void {
    this.ahead = clamp(s.ahead, 0, 1200); this.behind = clamp(s.behind, 0, 600);
    this.decodeAhead = clamp(s.decodeAhead, 0, 8); this.parallel = clamp(s.parallel, 1, 8);
    this.pump();
  }
  has(frame: number): boolean { return this.entries.has(frame); }
  aheadCount(current: number, dir: -1 | 0 | 1): number {
    const step = dir < 0 ? -1 : 1; let n = 0;
    while (this.entries.has(current + step * (n + 1))) n++;
    return n;
  }
  async load(frame: number, signal?: AbortSignal): Promise<{ bytes: ArrayBuffer; fromBuffer: boolean }> {
    if (this.disposed || signal?.aborted) throw cancelled();
    if (!Number.isInteger(frame) || frame < 0 || frame >= this.frameCount) throw new Error(`frame ${frame} is outside the video`);
    const held = this.entries.get(frame);
    if (held) return { bytes: held.bytes, fromBuffer: true };
    const consumer = {}, consumers = this.forced.get(frame) ?? new Set<object>();
    consumers.add(consumer); this.forced.set(frame, consumers);
    let abort = () => {};
    try {
      const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
        abort = () => { this.unpin(frame, consumer); reject(cancelled()); };
        signal?.addEventListener("abort", abort, { once: true });
        this.request(frame).then(resolve, reject);
      });
      return { bytes, fromBuffer: false };
    } finally {
      signal?.removeEventListener("abort", abort);
      if (!signal?.aborted) this.unpin(frame, consumer);
    }
  }
  private unpin(frame: number, consumer: object): void {
    const consumers = this.forced.get(frame);
    if (!consumers?.delete(consumer) || consumers.size) return;
    this.forced.delete(frame);
    const queued = this.queued.get(frame);
    if (queued) { this.queued.delete(frame); queued.reject(cancelled()); }
  }
  urlFor(frame: number): string | null {
    const entry = this.entries.get(frame);
    return !entry || this.disposed ? null : (entry.url ??= this.io.createUrl(entry.bytes));
  }
  show(frame: number | null): void { this.shownFrame = frame; }
  prefetch(current: number, motion: Motion): void {
    if (this.disposed || !Number.isInteger(current) || current < 0 || current >= this.frameCount) return;
    if (this.holdForCurrent && !this.entries.has(current)) { this.waitingFor = { current, motion }; return; }
    this.waitingFor = null;
    if (current !== this.current) this.failed.clear();
    this.current = current; this.motion = motion; this.started = true;
    this.evict(); this.warm(); this.pump();
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const f of this.entries.keys()) this.remove(f);
    for (const q of this.queued.values()) q.reject(cancelled());
    this.queued.clear(); this.forced.clear();
  }
  // Kept contiguous: fractional speed and timer catch-up can request any frame.
  private nth(k: number): number {
    const { dir } = this.motion;
    return dir === 0 ? this.current + (k % 2 ? (k + 1) / 2 : -k / 2) : this.current + dir * k;
  }
  private inWindow(frame: number): boolean {
    return this.motion.dir < 0
      ? frame >= this.current - this.ahead && frame <= this.current + this.behind
      : frame >= this.current - this.behind && frame <= this.current + this.ahead;
  }
  private remove(frame: number): void {
    const entry = this.entries.get(frame);
    if (!entry) return;
    if (entry.url) this.io.revokeUrl(entry.url);
    this.bytes -= entry.bytes.byteLength; this.entries.delete(frame);
  }
  private evict(): void {
    for (const frame of this.entries.keys())
      if (frame !== this.shownFrame && !this.inWindow(frame)) this.remove(frame);
  }
  private request(frame: number): Promise<ArrayBuffer> {
    const pending = this.inflight.get(frame) ?? this.queued.get(frame)?.promise;
    if (pending) return pending;
    if (this.inflight.size < this.parallel) return this.fetchFrame(frame);
    // A non-cooperating caller still cannot create an unbounded seek queue.
    if (this.queued.size === 32) {
      const [old, q] = this.queued.entries().next().value!;
      this.queued.delete(old); this.forced.delete(old); q.reject(cancelled());
    }
    let resolve!: Waiting["resolve"], reject!: Waiting["reject"];
    const promise = new Promise<ArrayBuffer>((yes, no) => { resolve = yes; reject = no; });
    this.queued.set(frame, { promise, resolve, reject });
    return promise;
  }
  private pump(): void {
    if (this.disposed) return;
    while (this.inflight.size < this.parallel && this.queued.size) {
      const [frame, q] = this.queued.entries().next().value!;
      this.queued.delete(frame); this.fetchFrame(frame).then(q.resolve, q.reject);
    }
    if (!this.started || this.waitingFor || this.bytes >= CACHE_BYTES - FRAME_BYTES) return;
    const paused = this.motion.dir === 0;
    for (let k = 1; this.inflight.size < this.parallel && k <= (paused ? 2 * Math.max(this.ahead, this.behind) : this.ahead); k++) {
      if (paused && (k % 2 ? (k + 1) / 2 > this.ahead : k / 2 > this.behind)) continue;
      const frame = this.nth(k);
      if (frame < 0 || frame >= this.frameCount || this.entries.has(frame) || this.inflight.has(frame) || this.failed.has(frame)) continue;
      this.fetchFrame(frame).catch(() => {});
    }
  }
  private warm(): void {
    if (this.disposed) return;
    for (let k = 1; this.warming < 2 && k <= this.decodeAhead * (this.motion.dir === 0 ? 2 : 1); k++) {
      const frame = this.nth(k), entry = this.entries.get(frame);
      if (!entry || entry.warm) continue;
      entry.warm = true; this.warming++;
      this.io.predecode(this.urlFor(frame)!).catch(() => {}).finally(() => { this.warming--; this.warm(); });
    }
  }
  private fetchFrame(frame: number): Promise<ArrayBuffer> {
    let p = this.inflight.get(frame);
    if (p) return p;
    // Cache and forced state are checked when IO completes, not when it was requested.
    p = this.io.fetch(frame).then(bytes => {
      if (bytes.byteLength > FRAME_BYTES) throw new Error("frame exceeded the 16 MiB JPEG budget");
      this.failed.delete(frame);
      this.arrive(frame, bytes); return bytes;
    }).catch(error => { if (this.inWindow(frame)) this.failed.add(frame); throw error; }).finally(() => {
      this.inflight.delete(frame); this.pump();
    });
    this.inflight.set(frame, p); return p;
  }
  private arrive(frame: number, bytes: ArrayBuffer): void {
    if (this.disposed || (!this.forced.has(frame) && !this.inWindow(frame))) return;
    this.entries.set(frame, { bytes, url: null, warm: false }); this.bytes += bytes.byteLength;
    // Keep the arriving picture and the currently displayed one; evict oldest retained bytes first.
    for (const f of this.entries.keys()) {
      if (this.bytes <= CACHE_BYTES) break;
      if (f !== frame && f !== this.shownFrame) this.remove(f);
    }
    const waiting = this.waitingFor;
    if (waiting?.current === frame) this.prefetch(waiting.current, waiting.motion);
    else this.warm();
  }
}
