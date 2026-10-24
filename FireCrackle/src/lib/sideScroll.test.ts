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
it("a strip that fits leaves the wheel to the page", () => {
  expect(scrollSideways(strip(0, 300, 300), wheel(120))).toBe(false);
});
it("a strip at its end keeps the wheel (the page does not scroll when the strip is done)", () => {
  const end = strip(700), start = strip(0);
  expect(scrollSideways(end, wheel(120))).toBe(true);
  expect(end.scrollLeft).toBe(700);
  expect(scrollSideways(start, wheel(-120))).toBe(true);
  expect(start.scrollLeft).toBe(0);
});
it("Ctrl+wheel is left alone (zoom)", () => {
  expect(scrollSideways(strip(0), wheel(120, 0, true))).toBe(false);
});
