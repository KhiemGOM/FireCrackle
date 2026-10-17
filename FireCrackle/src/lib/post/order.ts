// The order the effects are applied in. The stored order never changes when an effect is switched on or off; the list
// shown is derived from it: effects that are on first, in order, then the ones that are off.
import type { PostSettings, RowId, StageId } from "./settings";

export function displayOrder<T>(order: readonly T[], isOn: (id: T) => boolean): T[] {
  return [...order.filter(isOn), ...order.filter(id => !isOn(id))];
}

/** Moves an enabled effect one place earlier (negative step) or later, past the next enabled one; anything else is a no-op. */
export function moveEnabled<T>(order: readonly T[], isOn: (id: T) => boolean, id: T, step: number): T[] {
  const next = [...order];
  const at = next.indexOf(id);
  if (at < 0 || !isOn(id) || step === 0) return next;
  const dir = step < 0 ? -1 : 1;
  let to = at + dir;
  while (to >= 0 && to < next.length && !isOn(next[to])) to += dir;
  if (to < 0 || to >= next.length) return next;
  [next[at], next[to]] = [next[to], next[at]];
  return next;
}

/** 1, 2, 3... for each effect that is on, in the order they are applied; null for the ones that are off. */
export function rowNumbers(s: PostSettings): Record<RowId, number | null> {
  const out: Record<RowId, number | null> = { veil: null, portal: null, tone: null };
  let n = 0;
  if (s.veil !== "off") out.veil = ++n;
  if (s.portal !== "off") out.portal = ++n;
  const on = (id: StageId) => s.stages[id].on;
  for (const id of displayOrder(s.order, on)) if (on(id)) out[id] = ++n;
  return out;
}
