// A development backend that runs entirely in the browser: a synthetic 80 s video at 30 fps whose frames show the
// TRUE sprite row (so a labeller can check their clicks), with just enough of the session behaviour to exercise the
// UI. It is not the product: the rules live in Rust (`studio_core`), nothing here is saved.

import type { UiAction } from "./actions";
import type { Backend, Bucket, Flag, SettingInfo, Suggestion, View } from "./api";
import type { ChartPoint } from "./chart";
import type { ThumbStatus } from "./thumbs";
import { isFire, labelsEqual, type Label } from "./grid";

const N = 2400;
const FPS = 30;
const TICK_RATE = 20;

/** The animation step the game shows at frame f (E7: floor(20 * t) plus an offset). */
const stepAt = (f: number) => (9 + Math.floor(TICK_RATE * (f / FPS + 0.37))) % 32;

const MOCK_FLAGS: Flag[] = [
  { frame: 300, end_frame: 340, kind: "phase_excursion", severity: "soft", phase_delta: 4.2 },
  { frame: 900, end_frame: 900, kind: "phase_shift", severity: "soft", phase_delta: -6.5 },
  { frame: 1500, end_frame: 1500, kind: "phase_outlier", severity: "hard", phase_delta: 16 },
];

function setting(key: string, label: string, value: number, min: number, max: number, integer: boolean, explanation: string): SettingInfo {
  return { key, label, value, default: value, min, max, integer, explanation };
}

const SETTINGS: SettingInfo[] = [
  setting("label.advance_frames", "Label: frames to advance after labelling", 1, 0, 10000, true, "After a label is set, the playhead moves this many frames forward. 0 stays on the frame. (mock)"),
  setting("label.big_step_frames", "Label: frames moved by the big-step keys", 10, 2, 100000, true, "How many frames Shift plus the arrow keys move the playhead. (mock)"),
  setting("label.row_type_timeout_ms", "Label: wait before committing a single typed digit (ms)", 700, 100, 5000, true, "Typing 4 to 9 labels at once; 0 to 3 wait for a second digit for this long. (mock)"),
  setting("label.max_play_speed", "Label: fastest playback (x frame rate)", 8, 1, 64, true, "L and J double the speed up to this multiple. (mock)"),
  setting("label.min_play_tick_ms", "Label: shortest playback step (ms)", 16, 4, 200, true, "Faster playback moves several frames per step instead. (mock)"),
  setting("timeline.zoom_factor", "Timeline: zoom per wheel notch", 1.25, 1.05, 4, false, "How much the timeline zooms per wheel notch. (mock)"),
  setting("timeline.max_px_per_frame", "Timeline: most zoomed in (pixels per frame)", 32, 1, 256, false, "The furthest the timeline zooms in. (mock)"),
  setting("phase.tick_rate", "Phase: game ticks per second of video", 20, 1, 1000, false, "Minecraft runs 20 ticks per second. (mock, the real explanation comes from the backend)"),
  setting("phase.window_ticks", "Phase: allowed phase spread (ticks)", 2, 1, 16, false, "Frames of one steady stretch must fit this arc. (mock)"),
];

function drawFrame(f: number): Promise<ArrayBuffer> {
  const c = document.createElement("canvas");
  c.width = 960;
  c.height = 540;
  const g = c.getContext("2d")!;
  const sky = g.createLinearGradient(0, 0, 0, 540);
  sky.addColorStop(0, `hsl(${210 + (f % 90) / 6}, 45%, 22%)`);
  sky.addColorStop(1, "hsl(30, 25%, 12%)");
  g.fillStyle = sky;
  g.fillRect(0, 0, 960, 540);
  // a "campfire": flames whose shape follows the true step, so the picture changes every tick
  const step = stepAt(f);
  g.fillStyle = "#3b2a1a";
  g.fillRect(380, 400, 200, 40);
  for (let i = 0; i < 7; i++) {
    const h = 90 + 70 * Math.abs(Math.sin((step + i * 5) * 0.4));
    g.fillStyle = `hsl(${20 + i * 5}, 95%, ${50 + (step % 7) * 3}%)`;
    g.fillRect(400 + i * 26, 400 - h, 22, h);
  }
  g.fillStyle = "rgba(255,255,255,0.92)";
  g.font = "bold 64px system-ui, sans-serif";
  g.fillText(`frame ${f}`, 40, 90);
  g.font = "28px system-ui, sans-serif";
  g.fillText(`t = ${(f / FPS).toFixed(2)} s   (mock video, 30 fps)`, 40, 135);
  g.fillStyle = "#ffd24a";
  g.font = "bold 40px system-ui, sans-serif";
  g.fillText(`TRUE animation row ${step}   (both sheets)`, 40, 500);
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? b.arrayBuffer().then(resolve) : reject(new Error("canvas.toBlob failed"))), "image/jpeg", 0.8),
  );
}

export function createMockBackend(): Backend {
  const labels = new Map<number, Label>();
  const undoStack: Array<Array<[number, Label, boolean]>> = [];
  const predicted = new Set<number>();
  let current = 0;
  let pick = { sheet: 1, mirrored: false };
  let typed: number | null = null;
  const settings = SETTINGS.map((s) => ({ ...s }));
  const num = (key: string) => settings.find((s) => s.key === key)!.value;

  let thumbsReadyAt = 0;
  const thumbStatus = (): ThumbStatus =>
    thumbsReadyAt === 0
      ? { state: "idle", count: 0, error: null }
      : Date.now() < thumbsReadyAt
        ? { state: "running", count: 0, error: null }
        : { state: "ready", count: 40, error: null };

  const get = (f: number): Label => labels.get(f) ?? "unset";
  const clamp = (f: number) => Math.max(0, Math.min(N - 1, f));

  function put(changes: Array<[number, Label]>, inferred=false) {
    const undo: Array<[number, Label, boolean]> = [];
    for (const [f, l] of changes) {
      const prev = get(f);
      const wasPredicted=predicted.has(f);
      if (labelsEqual(prev, l) && wasPredicted === inferred) continue;
      undo.push([f, prev, wasPredicted]);
      predicted.delete(f);
      if (inferred && isFire(l)) predicted.add(f);
      if (l === "unset") labels.delete(f);
      else labels.set(f, l);
    }
    if (undo.length) undoStack.push(undo);
  }

  function apply(label: Label, inferred=false) {
    put([[current, label]], inferred);
    if (label !== "unset") current = clamp(current + num("label.advance_frames"));
  }

  function pickRow(row: number, inferred=false) {
    apply({ fire: { sheet: pick.sheet, row, mirrored: pick.mirrored } }, inferred);
  }

  function suggestion(): Suggestion | null {
    let best: { f: number; d: number } | null = null;
    for (const [f, l] of labels) {
      if (!isFire(l) || f === current || predicted.has(f)) continue;
      const d = Math.abs(f - current);
      if (!best || d < best.d || (d === best.d && f < best.f)) best = { f, d };
    }
    if (!best) return null;
    const src = labels.get(best.f)! as Extract<Label, { fire: unknown }>;
    const x = TICK_RATE * ((current - best.f) / FPS);
    let adv: number;
    let alt: number | null;
    if (Math.abs(x - Math.round(x)) < 1e-6) {
      adv = Math.round(x);
      alt = null;
    } else {
      const fl = Math.floor(x);
      if (x - fl >= 0.5) {
        adv = fl + 1;
        alt = fl;
      } else {
        adv = fl;
        alt = fl + 1;
      }
    }
    const row = (a: number) => (((src.fire.row + a) % 32) + 32) % 32;
    return { sheet: src.fire.sheet, mirrored: src.fire.mirrored, row: row(adv), alt_row: alt === null ? null : row(alt), from_frame: best.f };
  }

  function view(): View {
    return {
      current,
      frame_count: N,
      pts: current / FPS,
      fps: FPS,
      label: get(current),
      pick,
      typed_pending: typed,
      suggestion: suggestion(),
      labelled_count: labels.size,
      flag_count: MOCK_FLAGS.length,
      warnings: ["Mock backend: a synthetic video, nothing is saved."],
      save_error: null,
    };
  }

  function nextUnlabelled(dir: number): number {
    for (let f = current + dir; f >= 0 && f < N; f += dir) if (!labels.has(f)) return f;
    return current;
  }

  function manualAdvance(frames:number) {
    current=clamp(current+frames);
  }

  const api: Backend = {
    mock: true,
    pickVideo: async () => "mock://demo.mkv",
    openVideo: async () => view(),
    view: async () => view(),
    async act(a: UiAction) {
      if (a.type !== "digit" && a.type !== "flushTyped") typed = null;
      switch (a.type) {
        case "manualStep": manualAdvance(a.frames);break;
        case "manualBigStep": manualAdvance(Math.sign(a.dir)*num("label.big_step_frames"));break;
        case "step": current = clamp(current + a.frames); break;
        case "bigStep": current = clamp(current + Math.sign(a.dir) * num("label.big_step_frames")); break;
        case "home": current = 0; break;
        case "end": current = N - 1; break;
        case "goTo": current = clamp(a.frame); break;
        case "nextUnlabelled": current = nextUnlabelled(Math.sign(a.dir) || 1); break;
        case "nextFlag": {
          const dir = Math.sign(a.dir) || 1;
          const fs = MOCK_FLAGS.map((f) => f.frame);
          const hit = dir > 0 ? fs.find((f) => f > current) : [...fs].reverse().find((f) => f < current);
          if (hit !== undefined) current = hit;
          break;
        }
        case "toggleSheet": pick = { ...pick, sheet: 1 - pick.sheet }; break;
        case "toggleMirror": pick = { ...pick, mirrored: !pick.mirrored }; break;
        case "digit": {
          if (typed === null) {
            if (a.digit >= 4) pickRow(a.digit);
            else typed = a.digit;
          } else {
            const row = typed * 10 + a.digit;
            typed = null;
            if (row < 32) pickRow(row);
          }
          break;
        }
        case "flushTyped": if (typed !== null) { const r = typed; typed = null; pickRow(r); } break;
        case "cancelTyping": typed = null; break;
        case "acceptSuggestion": {
          const s = suggestion();
          if (!s) throw new Error("NoSuggestion");
          pick = { sheet: s.sheet, mirrored: s.mirrored };
          pickRow(s.row);
          break;
        }
        case "clear": apply("unset"); break;
        case "noFire": apply("no_fire"); break;
        case "skip": apply("skip"); break;
        case "undo": {
          const step = undoStack.pop();
          if (step) {
            for (const [f, prev, inferred] of step) { if (prev === "unset") labels.delete(f); else labels.set(f, prev);predicted.delete(f);if (inferred) predicted.add(f); }
            current = Math.min(...step.map(([f]) => f));
          }
          break;
        }
        case "clickCell": {
          if (a.col < 0 || a.col > 3 || a.row < 0 || a.row > 31) throw new Error("BadAction");
          const cols = [[0, false], [1, false], [0, true], [1, true]] as const;
          pick = { sheet: cols[a.col][0], mirrored: cols[a.col][1] };
          pickRow(a.row);
          break;
        }
        case "fillRange": {
          const ch: Array<[number, Label]> = [];
          for (let f = a.start; f <= Math.min(a.end, N - 1); f++) ch.push([f, a.label]);
          put(ch);
          break;
        }
      }
      return view();
    },
    frame: (f) => drawFrame(clamp(f)),
    async timeline(start, end, n) {
      end = Math.min(end, N);
      if (n <= 0 || start >= end) return [];
      const len = end - start;
      const bound = (i: number) => start + Math.floor((i * len) / n);
      const out: Bucket[] = Array.from({ length: n }, (_, i) => ({ frames: bound(i + 1) - bound(i), unset: 0, fire: 0, no_fire: 0, skip: 0, flag: null }));
      for (const b of out) b.unset = b.frames;
      const idx = (f: number) => Math.min(n - 1, Math.floor(((f - start + 1) * n - 1) / len));
      for (const [f, l] of labels) {
        if (f < start || f >= end) continue;
        const b = out[idx(f)];
        b.unset--;
        if (isFire(l)) b.fire++;
        else if (l === "no_fire") b.no_fire++;
        else if (l === "skip") b.skip++;
      }
      for (const fl of MOCK_FLAGS) {
        const a = Math.max(fl.frame, start);
        const z = Math.min(fl.end_frame, end - 1);
        if (a > z) continue;
        for (let i = idx(a); i <= idx(z); i++) out[i].flag = fl.severity === "hard" || out[i].flag === "hard" ? "hard" : "soft";
      }
      return out;
    },
    flags: async () => MOCK_FLAGS,
    // dev only: a thumbnail every 60 frames, "generated" after a short pause so the running state shows
    async thumbsStart() {
      if (thumbsReadyAt === 0) thumbsReadyAt = Date.now() + 1200;
      return thumbStatus();
    },
    async thumbsStatus() {
      return thumbStatus();
    },
    async thumbNearest(frames) {
      return Date.now() < thumbsReadyAt || thumbsReadyAt === 0 ? frames.map(() => null) : frames.map((f) => Math.min(Math.round(f / 60) * 60, 2340));
    },
    thumb: (frame) => drawFrame(frame),
    async phaseChart(maxPoints) {
      // dev only: the points of the labelled fire frames, one run over all of them (the real analysis is Rust)
      const points: ChartPoint[] = [];
      for (const f of [...labels.keys()].sort((a, b) => a - b)) {
        const l = labels.get(f)!;
        if (!isFire(l)) continue;
        const { row } = (l as Extract<Label, { fire: unknown }>).fire;
        const step = row;
        const pts = f / FPS;
        points.push({ frame: f, pts, step, phase: (((TICK_RATE * pts - step) % 32) + 32) % 32 });
      }
      const kept = points.length > maxPoints ? points.filter((_, i) => i % Math.ceil(points.length / maxPoints) === 0) : points;
      const runs = points.length
        ? [{ first_frame: points[0].frame, last_frame: points[points.length - 1].frame, points: points.length, center: points[0].phase, width: 1 }]
        : [];
      return { points: kept, runs, flags: MOCK_FLAGS, tick_rate: TICK_RATE, window_ticks: 2 };
    },
    settingsDescribe: async () => settings.map((s) => ({ ...s })),
    async settingsSet(key, value) {
      const s = settings.find((x) => x.key === key);
      if (!s) throw new Error(`UnknownKey(${key})`);
      if (!Number.isFinite(value) || value < s.min || value > s.max) throw new Error(`OutOfRange ${key}`);
      s.value = value;
      return view();
    },
  };
  return api;
}
