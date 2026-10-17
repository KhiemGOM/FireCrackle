import { describe, expect, it } from "vitest";
import { displayOrder, moveEnabled, rowNumbers } from "./order";
import { DEFAULT_POST, DEFAULT_TONE, type PostSettings } from "./settings";

const on = (...ids: string[]) => (id: string) => ids.includes(id);

describe("display order: enabled first, disabled after", () => {
  it("puts enabled effects first in their own order and disabled ones after", () => {
    expect(displayOrder(["a", "b", "c"], on("b"))).toEqual(["b", "a", "c"]);
    expect(displayOrder(["a", "b", "c"], on("a", "c"))).toEqual(["a", "c", "b"]);
    expect(displayOrder(["c", "a", "b"], on("b", "c"))).toEqual(["c", "b", "a"]);
  });

  it("keeps the order when everything or nothing is enabled, and copes with an empty list", () => {
    expect(displayOrder(["a", "b"], on("a", "b"))).toEqual(["a", "b"]);
    expect(displayOrder(["a", "b"], on())).toEqual(["a", "b"]);
    expect(displayOrder([], on("a"))).toEqual([]);
  });

  it("does not change its input", () => {
    const input = ["a", "b", "c"];
    displayOrder(input, on("c"));
    expect(input).toEqual(["a", "b", "c"]);
  });

  it("returns a disabled effect to the group's own position when it is enabled again (the stored order is kept)", () => {
    const stored = ["a", "b", "c"];
    expect(displayOrder(stored, on("a", "c"))).toEqual(["a", "c", "b"]);
    expect(displayOrder(stored, on("a", "b", "c"))).toEqual(["a", "b", "c"]);
  });
});

describe("moving an enabled effect earlier or later", () => {
  it("swaps with the next enabled effect, skipping disabled ones in between", () => {
    const moved = moveEnabled(["a", "b", "c"], on("a", "c"), "a", 1);
    expect(displayOrder(moved, on("a", "c"))).toEqual(["c", "a", "b"]);
  });

  it("moves earlier with a negative step", () => {
    const moved = moveEnabled(["a", "b", "c"], on("a", "b", "c"), "c", -1);
    expect(moved).toEqual(["a", "c", "b"]);
  });

  it("does nothing at either end, for a disabled effect, for an unknown id, or for a zero step", () => {
    const order = ["a", "b", "c"];
    expect(moveEnabled(order, on("a", "b", "c"), "a", -1)).toEqual(order);
    expect(moveEnabled(order, on("a", "b", "c"), "c", 1)).toEqual(order);
    expect(moveEnabled(order, on("a", "c"), "b", 1)).toEqual(order);
    expect(moveEnabled(order, on("a", "b", "c"), "zzz", 1)).toEqual(order);
    expect(moveEnabled(order, on("a", "b", "c"), "a", 0)).toEqual(order);
  });

  it("moves one place at a time and does not change its input", () => {
    const order = ["a", "b", "c", "d"];
    const moved = moveEnabled(order, on("a", "b", "c", "d"), "a", 5);
    expect(moved).toEqual(["b", "a", "c", "d"]);
    expect(order).toEqual(["a", "b", "c", "d"]);
  });
});

const base: PostSettings = { ...DEFAULT_POST, stages: { tone: { on: false, params: { ...DEFAULT_TONE } } } };

describe("order numbers: the order the effects are applied", () => {
  it("numbers nothing when everything is off", () => {
    expect(rowNumbers(base)).toEqual({ veil: null, portal: null, tone: null });
  });

  it("counts veil, then portal, then the effects, skipping the ones that are off", () => {
    expect(rowNumbers({ ...base, veil: "auto", stages: { tone: { on: true, params: base.stages.tone.params } } })).toEqual({ veil: 1, portal: null, tone: 2 });
    expect(rowNumbers({ ...base, portal: "auto", stages: { tone: { on: true, params: base.stages.tone.params } } })).toEqual({ veil: null, portal: 1, tone: 2 });
    expect(rowNumbers({ ...base, veil: "on", portal: "auto", stages: { tone: { on: true, params: base.stages.tone.params } } })).toEqual({ veil: 1, portal: 2, tone: 3 });
  });

  it("keeps the numbers when the master switch is off (the whole list is just dimmed)", () => {
    expect(rowNumbers({ ...base, veil: "auto", enabled: false }).veil).toBe(1);
  });
});
