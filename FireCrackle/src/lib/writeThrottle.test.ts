import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTrailingThrottle } from "./writeThrottle";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-17T12:00:00Z")); });
afterEach(() => { vi.useRealTimers(); });

describe("trailing throttle", () => {
  it("runs the first call at once", () => {
    const action = vi.fn();
    createTrailingThrottle(action, 1000).call();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("holds back calls inside the interval and runs once at its end", () => {
    const action = vi.fn();
    const t = createTrailingThrottle(action, 1000);
    t.call();
    vi.advanceTimersByTime(300); t.call();
    vi.advanceTimersByTime(300); t.call();
    expect(action).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(399);
    expect(action).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(action).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(5000);
    expect(action).toHaveBeenCalledTimes(2); // nothing left to write
  });

  it("is a few writes a second at most for a call every frame", () => {
    const action = vi.fn();
    const t = createTrailingThrottle(action, 1000);
    for (let i = 0; i < 600; i++) { t.call(); vi.advanceTimersByTime(16); } // ten seconds at 60 fps
    vi.advanceTimersByTime(1000);
    expect(action.mock.calls.length).toBeLessThanOrEqual(12);
    expect(action.mock.calls.length).toBeGreaterThanOrEqual(9);
  });

  it("runs a call that comes after the interval at once", () => {
    const action = vi.fn();
    const t = createTrailingThrottle(action, 1000);
    t.call();
    vi.advanceTimersByTime(1500);
    t.call();
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("writes the latest state, because the action reads it when it runs", () => {
    let state = 0;
    const seen: number[] = [];
    const t = createTrailingThrottle(() => seen.push(state), 1000);
    for (let i = 1; i <= 50; i++) { state = i; t.call(); vi.advanceTimersByTime(10); }
    vi.advanceTimersByTime(1000);
    expect(seen[0]).toBe(1);
    expect(seen[seen.length - 1]).toBe(50);
  });

  it("flush runs a pending call now and cancels the timer; with nothing pending it does nothing", () => {
    const action = vi.fn();
    const t = createTrailingThrottle(action, 1000);
    t.flush();
    expect(action).not.toHaveBeenCalled();
    t.call();
    vi.advanceTimersByTime(100); t.call();
    t.flush();
    expect(action).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(5000);
    expect(action).toHaveBeenCalledTimes(2);
    t.flush();
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("cancel drops a pending call", () => {
    const action = vi.fn();
    const t = createTrailingThrottle(action, 1000);
    t.call();
    vi.advanceTimersByTime(100); t.call();
    t.cancel();
    vi.advanceTimersByTime(5000);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("an interval of zero runs every call", () => {
    const action = vi.fn();
    const t = createTrailingThrottle(action, 0);
    t.call(); t.call(); t.call();
    expect(action).toHaveBeenCalledTimes(3);
  });

  it("a negative or broken interval behaves like zero", () => {
    for (const interval of [-5, NaN]) {
      const action = vi.fn();
      const t = createTrailingThrottle(action, interval);
      t.call(); t.call();
      expect(action).toHaveBeenCalledTimes(2);
    }
  });

  it("a failing action does not wedge the throttle", () => {
    const action = vi.fn().mockImplementationOnce(() => { throw new Error("storage full"); });
    const t = createTrailingThrottle(action, 1000);
    expect(() => t.call()).toThrow("storage full");
    vi.advanceTimersByTime(1500);
    t.call();
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("a failing trailing run does not leave a stuck timer or repeat itself", () => {
    const action = vi.fn().mockImplementation(() => { if (action.mock.calls.length === 2) throw new Error("blocked"); });
    const t = createTrailingThrottle(action, 1000);
    t.call();
    vi.advanceTimersByTime(100); t.call();
    expect(() => vi.advanceTimersByTime(900)).toThrow("blocked");
    vi.advanceTimersByTime(5000);
    expect(action).toHaveBeenCalledTimes(2);
    t.call();
    expect(action).toHaveBeenCalledTimes(3);
  });
});
