/** A look-ahead buffer of video frames for the Label tab (PLAN-BUFFER.md). No DOM: fetching, object URLs and decoding are
 *  injected, so the policy runs (and is tested) without a browser.
 *
 *  It keeps the JPEG bytes of the frames around the playhead, so showing the next frame needs no request, and starts the
 *  decoding of the next few ahead of time, so showing one is a swap, not a decode. */

export interface BufferSettings {
  /** Frames fetched ahead, in the direction of play (and ahead of a paused playhead). */
  ahead: number;
  /** Frames kept behind the playhead (and fetched while paused). */
  behind: number;
  /** Of the frames ahead, how many are also decoded in advance. */
  decodeAhead: number;
  /** Fetches in flight at once. */
  parallel: number;
  /** For the pane, not the buffer: how far behind the playhead a late picture may still be shown (lib/lateFrame.ts). */
  lateShow?: number;
}

/** The defaults of the `label.buffer_*` settings (config.rs); the app passes the saved values. */
export const DEFAULT_BUFFER_SETTINGS: BufferSettings = { ahead: 90, behind: 30, decodeAhead: 8, parallel: 3, lateShow: 30 };

export interface BufferIo {
  fetch(frame: number): Promise<ArrayBuffer>;
  createUrl(bytes: ArrayBuffer): string;
  revokeUrl(url: string): void;
  /** Load and decode the picture behind `url`, so that showing it later has no decoding left. */
  predecode(url: string): Promise<void>;
}

/** Which way the playhead moves (-1, 0 paused, 1) and how fast (a multiple of the frame rate). */
export interface Motion {
  dir: -1 | 0 | 1;
  speed: number;
}

interface Entry {
  bytes: ArrayBuffer;
  url: string | null;
  /** Its decode has been started. */
  warm: boolean;
}

/** `v` rounded down into min..max; NaN counts as 0. */
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Math.floor(v) || 0));

export class FrameBuffer {
  private readonly entries = new Map<number, Entry>();
  private readonly inflight = new Map<number, Promise<ArrayBuffer>>();
  /** Frames a caller waits for in `load`: kept even outside the window. */
  private readonly forced = new Set<number>();
  /** Frames whose prefetch failed: not asked for again until the playhead moves. */
  private readonly failed = new Set<number>();
  private ahead = 0;
  private behind = 0;
  private decodeAhead = 0;
  private parallel = 1;
  private current = 0;
  private motion: Motion = { dir: 0, speed: 1 };
  private shownFrame: number | null = null;
  /** A seek waiting for its frame: nothing is asked for until that frame has arrived. */
  private waitingFor: { current: number; motion: Motion } | null = null;
  private started = false;
  private disposed = false;

  /**
   * `holdForCurrent` (the default): the look-ahead only starts once the frame at the playhead is in the buffer, so the
   * caller has to `load` it. After a seek the backend has none of the neighbours either, and every request for a missing
   * frame starts a decode of its own: asking for the neighbours together with the frame itself started four decodes at
   * once. Asking for the frame alone lets that one decode fill the backend's cache, and the neighbours come out of it.
   * Switch it off only to test the planner on its own.
   */
  constructor(
    private readonly frameCount: number,
    private readonly io: BufferIo,
    settings: BufferSettings,
    private readonly holdForCurrent = true,
  ) {
    this.setSettings(settings);
  }

  setSettings(s: BufferSettings): void {
    this.ahead = clamp(s.ahead, 0, 1200);
    this.behind = clamp(s.behind, 0, 600);
    this.decodeAhead = clamp(s.decodeAhead, 0, 64);
    this.parallel = clamp(s.parallel, 1, 8);
    this.pump();
  }

  has(frame: number): boolean {
    return this.entries.has(frame);
  }

  /** The frames in a row that are buffered right after `current`, in direction `dir` (paused counts as forward). */
  aheadCount(current: number, dir: -1 | 0 | 1): number {
    const step = dir < 0 ? -1 : 1;
    let n = 0;
    while (this.entries.has(current + step * (n + 1))) n++;
    return n;
  }

  /** The frame's bytes, from the buffer or fetched (one fetch however many ask). Rejects for a frame outside the video. */
  async load(frame: number): Promise<{ bytes: ArrayBuffer; fromBuffer: boolean }> {
    if (this.disposed) throw new Error("the frame buffer was closed");
    if (!Number.isInteger(frame) || frame < 0 || frame >= this.frameCount) throw new Error(`frame ${frame} is outside the video`);
    const held = this.entries.get(frame);
    if (held) return { bytes: held.bytes, fromBuffer: true };
    this.forced.add(frame);
    return { bytes: await this.fetchFrame(frame), fromBuffer: false };
  }

  /** The object URL of a buffered frame (made on first use, kept until the frame leaves the buffer), else null. */
  urlFor(frame: number): string | null {
    const entry = this.entries.get(frame);
    if (!entry || this.disposed) return null;
    return (entry.url ??= this.io.createUrl(entry.bytes));
  }

  /** The frame on screen: never evicted, so its picture is not pulled away while it is shown. */
  show(frame: number | null): void {
    this.shownFrame = frame;
  }

  /** The playhead is at `current` moving as `motion`: drop what fell out of the window and fetch what comes next. */
  prefetch(current: number, motion: Motion): void {
    if (this.disposed || !Number.isInteger(current) || current < 0 || current >= this.frameCount) return;
    if (this.holdForCurrent && !this.entries.has(current)) {
      this.waitingFor = { current, motion }; // a seek or a start: wait for this frame, here and around the old place
      return;
    }
    this.waitingFor = null;
    if (current !== this.current) this.failed.clear();
    this.current = current;
    this.motion = motion;
    this.started = true;
    this.evict();
    this.warm();
    this.pump();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.entries.values()) if (entry.url) this.io.revokeUrl(entry.url);
    this.entries.clear();
  }

  // ---- policy

  /** Frames between shown ones when playing faster than the frame rate: only those are ever shown. */
  private stride(): number {
    return this.motion.speed > 1 ? Math.round(this.motion.speed) : 1;
  }

  /** The k-th frame of the look-ahead, nearest first: forward or backward when playing; both sides, the one ahead first, when paused. */
  private nth(k: number): number {
    const { dir } = this.motion;
    return dir === 0 ? this.current + (k % 2 ? (k + 1) / 2 : -k / 2) : this.current + dir * this.stride() * k;
  }

  private inWindow(frame: number): boolean {
    const span = this.ahead * this.stride();
    return this.motion.dir < 0
      ? frame >= this.current - span && frame <= this.current + this.behind
      : frame >= this.current - this.behind && frame <= this.current + span;
  }

  private evict(): void {
    for (const [frame, entry] of this.entries) {
      if (frame === this.shownFrame || this.inWindow(frame)) continue;
      if (entry.url) this.io.revokeUrl(entry.url);
      this.entries.delete(frame);
    }
  }

  private pump(): void {
    if (this.disposed || !this.started || this.waitingFor) return;
    const paused = this.motion.dir === 0;
    let free = this.parallel - this.inflight.size;
    for (let k = 1; free > 0 && k <= (paused ? 2 * Math.max(this.ahead, this.behind) : this.ahead); k++) {
      // paused: odd k lie ahead of the playhead and even k behind it, each side up to its own limit
      if (paused && (k % 2 ? (k + 1) / 2 > this.ahead : k / 2 > this.behind)) continue;
      const frame = this.nth(k);
      if (frame < 0 || frame >= this.frameCount || this.entries.has(frame) || this.inflight.has(frame) || this.failed.has(frame)) continue;
      this.fetchFrame(frame).catch(() => {}); // a failed prefetch is not an error: `load` fetches the frame when it is needed
      free--;
    }
  }

  /** Starts the decode of the next `decodeAhead` frames (both sides when paused). */
  private warm(): void {
    for (let k = 1; k <= this.decodeAhead * (this.motion.dir === 0 ? 2 : 1); k++) {
      const frame = this.nth(k);
      const entry = this.entries.get(frame);
      if (!entry || entry.warm) continue;
      entry.warm = true;
      this.io.predecode(this.urlFor(frame)!).catch(() => {}); // shown without the head start
    }
  }

  private fetchFrame(frame: number): Promise<ArrayBuffer> {
    let p = this.inflight.get(frame);
    if (p) return p;
    p = this.io.fetch(frame).then(
      (bytes) => {
        this.inflight.delete(frame);
        this.failed.delete(frame);
        this.arrive(frame, bytes);
        this.pump();
        return bytes;
      },
      (error) => {
        this.inflight.delete(frame);
        this.forced.delete(frame);
        this.failed.add(frame);
        this.pump();
        throw error;
      },
    );
    this.inflight.set(frame, p);
    return p;
  }

  private arrive(frame: number, bytes: ArrayBuffer): void {
    const wanted = this.forced.delete(frame);
    // a result for a place the playhead has left is not kept, unless someone is waiting for it
    if (this.disposed || (!wanted && !this.inWindow(frame))) return;
    this.entries.set(frame, { bytes, url: null, warm: false });
    const waiting = this.waitingFor;
    if (waiting?.current === frame) this.prefetch(waiting.current, waiting.motion);
    else this.warm();
  }
}
