import { describe, expect, it } from "vitest";
import {
  STOPPED,
  isEditableTarget,
  keyInfo,
  nextPlayback,
  playbackTick,
  stepIntervalMs,
  toUiAction,
  type Playback,
} from "./actions";
import { DEFAULT_BINDINGS, type Action } from "./keymap";

describe("key action -> backend action", () => {
  it("maps every default binding that the backend handles", () => {
    const expected: Array<[Action, unknown]> = [
      [{ type: "step", frames: 1 }, { type: "step", frames: 1 }],
      [{ type: "step", frames: -1 }, { type: "step", frames: -1 }],
      [{ type: "bigStep", dir: -1 }, { type: "bigStep", dir: -1 }],
      [{ type: "bigStep", dir: 1 }, { type: "bigStep", dir: 1 }],
      [{ type: "home" }, { type: "home" }],
      [{ type: "end" }, { type: "end" }],
      [{ type: "toggleSheet" }, { type: "toggleSheet" }],
      [{ type: "toggleMirror" }, { type: "toggleMirror" }],
      [{ type: "digit", digit: 7 }, { type: "digit", digit: 7 }],
      [{ type: "acceptSuggestion" }, { type: "acceptSuggestion" }],
      [{ type: "clear" }, { type: "clear" }],
      [{ type: "noFire" }, { type: "noFire" }],
      [{ type: "skip" }, { type: "skip" }],
      [{ type: "nextUnlabelled", dir: 1 }, { type: "nextUnlabelled", dir: 1 }],
      [{ type: "nextFlag", dir: -1 }, { type: "nextFlag", dir: -1 }],
      [{ type: "undo" }, { type: "undo" }],
      [{ type: "cancelTyping" }, { type: "cancelTyping" }],
    ];
    for (const [action, ui] of expected) expect(toUiAction(action)).toEqual(ui);
  });

  it("leaves playback to the interface", () => {
    expect(toUiAction({ type: "playPause" })).toBeNull();
    expect(toUiAction({ type: "shuttle", dir: 1 })).toBeNull();
    expect(toUiAction({ type: "shuttle", dir: 0 })).toBeNull();
  });

  it("knows what to do with every action type the keymap can produce", () => {
    const seen = new Set(Object.values(DEFAULT_BINDINGS).map((a) => a.type));
    for (const type of seen) {
      const sample = Object.values(DEFAULT_BINDINGS).find((a) => a.type === type)!;
      const mapped = toUiAction(sample);
      if (type === "playPause" || type === "shuttle" || type === "stepPhase") expect(mapped).toBeNull();
      else expect(mapped, type).not.toBeNull();
    }
  });
});

describe("editable targets", () => {
  it("recognises text fields and editable content", () => {
    expect(isEditableTarget({ tagName: "INPUT" })).toBe(true);
    expect(isEditableTarget({ tagName: "textarea" })).toBe(true);
    expect(isEditableTarget({ tagName: "SELECT" })).toBe(true);
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("does not mistake ordinary elements for fields", () => {
    expect(isEditableTarget({ tagName: "DIV" })).toBe(false);
    expect(isEditableTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isEditableTarget({ tagName: "CANVAS" })).toBe(false);
    expect(isEditableTarget({})).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(undefined)).toBe(false);
  });
});

describe("keyInfo", () => {
  it("copies the modifiers and flags typing targets", () => {
    const e = { key: "z", ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, repeat: false, target: { tagName: "INPUT" } };
    expect(keyInfo(e)).toEqual({
      key: "z",
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      repeat: false,
      targetEditable: true,
    });
    expect(keyInfo({ ...e, target: null }).targetEditable).toBe(false);
  });

  it("marks a field that owns its keys (data-owns-keys), and only that", () => {
    const base = { key: "Enter", ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, repeat: false };
    expect(keyInfo({ ...base, target: { tagName: "INPUT", dataset: { ownsKeys: "true" } } }).targetOwnsKeys).toBe(true);
    expect(keyInfo({ ...base, target: { tagName: "INPUT", dataset: {} } }).targetOwnsKeys).toBeFalsy();
    expect(keyInfo({ ...base, target: { tagName: "BUTTON" } }).targetOwnsKeys).toBeFalsy();
    expect(keyInfo({ ...base, target: null }).targetOwnsKeys).toBeFalsy();
  });
});

describe("playback", () => {
  const play = (p: Playback, a: Parameters<typeof nextPlayback>[1], max = 8) => nextPlayback(p, a, max);

  it("space toggles between playing forward and stopped", () => {
    const playing = play(STOPPED, { type: "playPause" });
    expect(playing).toEqual({ dir: 1, speed: 1 });
    expect(play(playing, { type: "playPause" })).toEqual(STOPPED);
    expect(play({ dir: -1, speed: 4 }, { type: "playPause" })).toEqual(STOPPED);
  });

  it("l plays forward and doubles up to the maximum", () => {
    let p = play(STOPPED, { type: "shuttle", dir: 1 });
    expect(p).toEqual({ dir: 1, speed: 1 });
    p = play(p, { type: "shuttle", dir: 1 });
    p = play(p, { type: "shuttle", dir: 1 });
    expect(p).toEqual({ dir: 1, speed: 4 });
    p = play(p, { type: "shuttle", dir: 1 });
    expect(p.speed).toBe(8);
    p = play(p, { type: "shuttle", dir: 1 });
    expect(p.speed).toBe(8);
  });

  it("the maximum speed is a parameter", () => {
    let p = STOPPED;
    for (let i = 0; i < 6; i++) p = play(p, { type: "shuttle", dir: 1 }, 2);
    expect(p).toEqual({ dir: 1, speed: 2 });
    expect(play(STOPPED, { type: "shuttle", dir: 1 }, 1)).toEqual({ dir: 1, speed: 1 });
    expect(play({ dir: 1, speed: 1 }, { type: "shuttle", dir: 1 }, 1).speed).toBe(1);
  });

  it("j plays backwards and the opposite key restarts at normal speed", () => {
    let p = play(STOPPED, { type: "shuttle", dir: -1 });
    expect(p).toEqual({ dir: -1, speed: 1 });
    p = play(p, { type: "shuttle", dir: -1 });
    expect(p).toEqual({ dir: -1, speed: 2 });
    expect(play(p, { type: "shuttle", dir: 1 })).toEqual({ dir: 1, speed: 1 });
    expect(play({ dir: 1, speed: 8 }, { type: "shuttle", dir: -1 })).toEqual({ dir: -1, speed: 1 });
  });

  it("k stops", () => {
    expect(play({ dir: 1, speed: 4 }, { type: "shuttle", dir: 0 })).toEqual(STOPPED);
    expect(play(STOPPED, { type: "shuttle", dir: 0 })).toEqual(STOPPED);
  });

  it("a maximum below 1 is treated as 1", () => {
    expect(play(STOPPED, { type: "shuttle", dir: 1 }, 0)).toEqual({ dir: 1, speed: 1 });
    expect(play({ dir: 1, speed: 1 }, { type: "shuttle", dir: 1 }, 0).speed).toBe(1);
  });
});

describe("step interval", () => {
  it("is one frame time divided by the speed", () => {
    expect(stepIntervalMs(60, { dir: 1, speed: 1 })).toBeCloseTo(1000 / 60, 9);
    expect(stepIntervalMs(30, { dir: -1, speed: 2 })).toBeCloseTo(1000 / 60, 9);
    expect(stepIntervalMs(25, { dir: 1, speed: 8 })).toBeCloseTo(5, 9);
  });

  it("is null when stopped or when the frame rate is unusable", () => {
    expect(stepIntervalMs(60, STOPPED)).toBeNull();
    expect(stepIntervalMs(0, { dir: 1, speed: 1 })).toBeNull();
    expect(stepIntervalMs(NaN, { dir: 1, speed: 1 })).toBeNull();
    expect(stepIntervalMs(-5, { dir: 1, speed: 1 })).toBeNull();
    expect(stepIntervalMs(Infinity, { dir: 1, speed: 1 })).toBeNull();
  });
});

describe("playback ticks", () => {
  it("is one frame per frame time while that is slower than the minimum tick", () => {
    const t = playbackTick(30, { dir: 1, speed: 1 }, 16)!;
    expect(t.intervalMs).toBeCloseTo(1000 / 30, 9);
    expect(t.frames).toBe(1);
    const back = playbackTick(30, { dir: -1, speed: 1 }, 16)!;
    expect(back.frames).toBe(-1);
  });

  it("steps several frames per minimum tick when playing faster than the screen can follow", () => {
    const t = playbackTick(60, { dir: 1, speed: 8 }, 16)!;
    expect(t.intervalMs).toBe(16);
    expect(t.frames).toBe(8); // 8x of 60 fps is 480 frames per second: 7.7 per 16 ms, rounded
    const b = playbackTick(60, { dir: -1, speed: 4 }, 16)!; // 240 frames/s: 3.84 per 16 ms
    expect(b.intervalMs).toBe(16);
    expect(b.frames).toBe(-4);
  });

  it("always moves at least one frame and keeps the direction", () => {
    for (const fps of [1, 24, 60, 144]) {
      for (const speed of [1, 2, 8, 64]) {
        for (const dir of [-1, 1] as const) {
          const t = playbackTick(fps, { dir, speed }, 50)!;
          expect(Math.abs(t.frames)).toBeGreaterThanOrEqual(1);
          expect(Math.sign(t.frames)).toBe(dir);
          expect(t.intervalMs).toBeGreaterThanOrEqual(Math.min(50, 1000 / (fps * speed)) - 1e-9);
        }
      }
    }
  });

  it("the minimum tick is a parameter", () => {
    expect(playbackTick(60, { dir: 1, speed: 4 }, 100)!.intervalMs).toBe(100);
    expect(playbackTick(60, { dir: 1, speed: 4 }, 100)!.frames).toBe(24);
  });

  it("is null when stopped or the frame rate is unusable", () => {
    expect(playbackTick(60, STOPPED, 16)).toBeNull();
    expect(playbackTick(0, { dir: 1, speed: 1 }, 16)).toBeNull();
    expect(playbackTick(NaN, { dir: 1, speed: 1 }, 16)).toBeNull();
  });
});
