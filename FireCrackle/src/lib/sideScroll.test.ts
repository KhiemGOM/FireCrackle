// Toolbar strips with no scrollbar (the 3D quad bar's rows and corner list): the mouse wheel scrolls them sideways.
import { expect, it } from "vitest";
import { scrollSideways } from "./sideScroll";

const strip = (scrollLeft: number, scrollWidth = 1000, clientWidth = 300) => ({ scrollLeft, scrollWidth, clientWidth });
const wheel = (deltaY: number, deltaX = 0, ctrlKey = false) => ({ deltaY, deltaX, ctrlKey });

it("the wheel scrolls a strip that overflows sideways, either wheel axis", () => {
  const s = strip(0);
  expect(scrollSideways(s, wheel(120))).toBe(true);
  expect(s.scrollLeft).toBe(120);
  expect(scrollSideways(s, wheel(0, -50))).toBe(true);
  expect(s.scrollLeft).toBe(70);
});
it("a strip that fits, or is already at that end, leaves the wheel to the page", () => {
  expect(scrollSideways(strip(0, 300, 300), wheel(120))).toBe(false);
  expect(scrollSideways(strip(700), wheel(120))).toBe(false);
  expect(scrollSideways(strip(0), wheel(-120))).toBe(false);
});
it("Ctrl+wheel is left alone (zoom)", () => {
  expect(scrollSideways(strip(0), wheel(120, 0, true))).toBe(false);
});
