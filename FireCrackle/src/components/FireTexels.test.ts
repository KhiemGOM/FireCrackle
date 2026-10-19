import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { FireTexels } from "./FireTexels";

describe("fire preview pixel grid", () => {
  const texels = [{ points: [[0, 0], [1, 0], [1, 1], [0, 1]] as Array<[number, number]>, colour: "rgb(255,128,0)", alpha: 0.5 }];
  it("switches only grid strokes while preserving texture, alpha and warped geometry", () => {
    const off = renderToStaticMarkup(createElement(FireTexels, { texels, pixelGrid: false, scaleX: 200, scaleY: 100 }));
    const on = renderToStaticMarkup(createElement(FireTexels, { texels, pixelGrid: true, scaleX: 200, scaleY: 100 }));
    expect(off).toContain('shape-rendering="crispEdges"');
    expect(off).toContain('stroke="none"');
    expect(on).toContain('stroke="rgba(255,255,255,0.45)"');
    for (const svg of [off, on]) {
      expect(svg).toContain('points="0,0 200,0 200,100 0,100"');
      expect(svg).toContain('fill-opacity="0.5"');
      expect(svg).toContain('fill="rgb(255,128,0)"');
    }
  });
});

it.each([0.125, 1, 8, 64, 256])("keeps grid width at 0.7 screen pixels at scale %s", screenScale => {
  const svg=renderToStaticMarkup(createElement(FireTexels,{texels:[{points:[[0,0],[1,0],[1,1]],colour:"red",alpha:1}],pixelGrid:true,screenScale}));
  const width=Number(svg.match(/stroke-width="([^"]+)"/)![1]);
  expect(width*screenScale).toBeCloseTo(0.7,12);
  expect(svg).not.toContain("non-scaling-stroke");
});
