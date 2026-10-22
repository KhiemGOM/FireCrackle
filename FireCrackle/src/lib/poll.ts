// Status polling for background jobs. The next request starts one interval after the previous answer, so a slow
// backend never piles up requests; after `stop` nothing more is asked and a late answer is dropped.

export function startPolling<T>(
  fetch: () => Promise<T>,
  { intervalMs, onValue, onError }: { intervalMs: number; onValue: (value: T) => void | Promise<void>; onError?: (error: unknown) => void },
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    try {
      const value = await fetch();
      if (!stopped) await onValue(value);
    } catch (error) {
      if (!stopped) onError?.(error);
    }
    if (!stopped) timer = setTimeout(() => void tick(), intervalMs);
  };
  void tick();
  return () => { stopped = true; clearTimeout(timer); };
}
