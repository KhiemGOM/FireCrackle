import { describe, expect, it, vi } from "vitest";
import { atlasSprite, framePreview, previewSprite, selectAtlasCell, labelSprite } from "./firePreview";

it('maps still and flowing material previews to their own sheet controls',()=>{
 expect(labelSprite({texture:{atlas:'water_still',row:5,mirrored:false}})?.sheet).toBe(0);
 expect(labelSprite({texture:{atlas:'lava_still',row:5,mirrored:false}})?.sheet).toBe(0);
 expect(labelSprite({texture:{atlas:'water_flow',row:5,mirrored:false}})?.sheet).toBe(1);
});

describe("atlas preview selection", () => {
  it("Ctrl+click consumes an active preview selection without labeling or navigation", () => {
    const preview = vi.fn(() => true), label = vi.fn();
    selectAtlasCell(true, 2, 31, preview, label);
    expect(preview).toHaveBeenCalledExactlyOnceWith({ sheet: 0, row: 31, mirrored: true });
    expect(label).not.toHaveBeenCalled();
  });
  it("ordinary clicks select a candidate; Ctrl clicks never select even without a mask", () => {
    const preview = vi.fn(() => false), label = vi.fn();
    selectAtlasCell(false, 1, 0, preview, label);
    expect(preview).toHaveBeenCalledExactlyOnceWith({ sheet: 1, row: 0, mirrored: false });
    expect(label).toHaveBeenCalledExactlyOnceWith(1, 0);
    label.mockClear();
    selectAtlasCell(true, 3, 9, preview, label);
    expect(label).not.toHaveBeenCalled();
  });
  it("keeps manual appearance but restricts first-person preview to legal geometry", () => {
    const sprite = { sheet: 0, row: 12, mirrored: true } as const;
    expect(previewSprite("manual", sprite)).toEqual(sprite);
    expect(previewSprite("firstPerson", sprite)).toEqual({ sheet: 1, row: 12, mirrored: false });
    expect(previewSprite("none", sprite)).toBeNull();
    expect(atlasSprite(4, 0)).toBeNull();
    expect(atlasSprite(0, 32)).toBeNull();
  });
});

describe("frame preview synchronization", () => {
  it("uses the destination primary guess, falling back to an existing fire label", () => {
    const label = { fire: { sheet: 1, row: 3, mirrored: false } };
    expect(framePreview({ label, suggestion: { sheet: 0, row: 25, mirrored: true, alt_row: 24, from_frame: 5 } }))
      .toEqual({ sheet: 0, row: 25, mirrored: true });
    expect(framePreview({ label, suggestion: null })).toEqual(label.fire);
    expect(framePreview({ label: "unset", suggestion: null })).toBeNull();
    expect(framePreview({ label: "no_fire", suggestion: null })).toBeNull();
  });
});
