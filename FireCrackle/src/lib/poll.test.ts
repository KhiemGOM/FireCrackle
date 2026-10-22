import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startPolling } from "./poll";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

it("asks at once, then again one interval after each answer", async () => {
  const fetch = vi.fn(async () => 1), onValue = vi.fn();
  const stop = startPolling(fetch, { intervalMs: 700, onValue });
  await flush();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(onValue).toHaveBeenCalledWith(1);
  await vi.advanceTimersByTimeAsync(700);
  expect(fetch).toHaveBeenCalledTimes(2);
  stop();
});

it("never overlaps requests when the backend is slower than the interval", async () => {
  let resolve!: (v: number) => void;
  const fetch = vi.fn(() => new Promise<number>(r => { resolve = r; }));
  const stop = startPolling(fetch, { intervalMs: 100, onValue: () => {} });
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).toHaveBeenCalledTimes(1);
  resolve(5); await flush();
  await vi.advanceTimersByTimeAsync(100);
  expect(fetch).toHaveBeenCalledTimes(2);
  stop();
});

it("keeps polling after an error and reports it", async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error("busy")).mockResolvedValue(2);
  const onError = vi.fn(), onValue = vi.fn();
  const stop = startPolling(fetch, { intervalMs: 50, onValue, onError });
  await flush();
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "busy" }));
  await vi.advanceTimersByTimeAsync(50);
  expect(onValue).toHaveBeenCalledWith(2);
  stop();
});

it("after stop, nothing is called and a late answer is dropped", async () => {
  let resolve!: (v: number) => void;
  const fetch = vi.fn(() => new Promise<number>(r => { resolve = r; }));
  const onValue = vi.fn();
  const stop = startPolling(fetch, { intervalMs: 10, onValue });
  stop();
  resolve(9); await flush();
  await vi.advanceTimersByTimeAsync(1000);
  expect(onValue).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(1);
});
