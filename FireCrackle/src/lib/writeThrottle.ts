/** Run an action at most once per interval, however often it is asked for: the first call runs at once and calls inside
 *  the interval are folded into one run at its end. The action reads the latest state itself when it runs, so the last
 *  state is never lost. Used for what is saved while playing: a step every frame must not write a big list every frame. */
export interface TrailingThrottle {
  call(): void;
  /** Run a pending call now (before leaving, saving, pausing). Nothing pending: nothing happens. */
  flush(): void;
  /** Forget a pending call. */
  cancel(): void;
}

export function createTrailingThrottle(action: () => void, intervalMs: number): TrailingThrottle {
  const interval = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 0;
  let lastRun: number | null = null;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  // the state is settled before the action runs, so an action that throws cannot wedge the throttle
  const run = () => {
    pending = false;
    lastRun = Date.now();
    action();
  };
  return {
    call() {
      if (interval === 0 || lastRun === null || Date.now() - lastRun >= interval) {
        clear();
        run();
        return;
      }
      pending = true;
      if (timer === null) {
        timer = setTimeout(() => {
          timer = null;
          if (pending) run();
        }, lastRun + interval - Date.now());
      }
    },
    flush() {
      if (!pending) return;
      clear();
      run();
    },
    cancel() {
      pending = false;
      clear();
    },
  };
}
