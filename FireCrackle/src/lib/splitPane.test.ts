// The 3D quad's world panel beside the video: its width is dragged with a divider, kept between a minimum and a share
// of the space so the video stays the main panel, and remembered.
import { describe, expect, it } from "vitest";
import { clampSideWidth, SIDE_MIN, SIDE_MAX_SHARE } from "./splitPane";

describe("side panel width", () => {
  it("keeps a dragged width as long as it is reasonable", () => {
    expect(clampSideWidth(420, 1600)).toBe(420);
  });
  it("never narrower than the minimum, never more than its share of the space", () => {
    expect(clampSideWidth(50, 1600)).toBe(SIDE_MIN);
    expect(clampSideWidth(1500, 1600)).toBe(Math.round(1600 * SIDE_MAX_SHARE));
  });
  it("a tiny space gives the minimum; nonsense gives the default", () => {
    expect(clampSideWidth(400, 200)).toBe(SIDE_MIN);
    expect(clampSideWidth(NaN, 1600)).toBeGreaterThanOrEqual(SIDE_MIN);
    expect(clampSideWidth(400, NaN)).toBe(400);
  });
});
