import { expect, it } from "vitest";
import { DEFAULT_PREFERENCES, readPreferences, writePreferences } from "./preferences";
it('restores the current-video Misc tools tab',()=>{
 expect(readPreferences({getItem:()=>'{"tab":"misc"}'}).tab).toBe('misc');
});

it("merges independent settings and restores values including zero edge counts", () => {
  let raw: string | null = null;
  const storage = { getItem: () => raw, setItem: (_: string, value: string) => { raw = value; } };
  writePreferences({ atlasFilter: { left: 0, right: 16 }, tab: "phase" }, storage);
  writePreferences({ matchAdjustQuad: true, matchOnlyFiltered: false, matchOpen: true }, storage);
  expect(readPreferences(storage)).toEqual({ ...DEFAULT_PREFERENCES, atlasFilter: { left: 0, right: 16 }, tab: "phase", matchAdjustQuad: true, matchOnlyFiltered: false, matchOpen: true });
  writePreferences({ matchAdjustQuad: false }, storage);
  expect(readPreferences(storage).matchAdjustQuad).toBe(false);
});
it("restores animation settings and validated, distinct manual exclusions", () => {
  const prefs = readPreferences({getItem:()=>JSON.stringify({animationOpen:true,animationDelayMs:120,animationOnlyFiltered:false,atlasFilter:{left:null,right:3,excluded:[0,127,127,-1,128,"2"]}})});
  expect(prefs).toMatchObject({animationOpen:true,animationDelayMs:120,animationOnlyFiltered:false,atlasFilter:{left:null,right:3,excluded:[0,127]}});
  expect(readPreferences({getItem:()=>'{"animationDelayMs":0}'}).animationDelayMs).toBe(250);
});
it("ignores corrupt, out-of-range or wrong-type preferences", () => {
  expect(readPreferences({ getItem: () => '{"tab":"other","atlasFilter":{"left":17,"right":"3"},"matchOpen":1}' })).toEqual(DEFAULT_PREFERENCES);
  expect(readPreferences({ getItem: () => "{" })).toEqual(DEFAULT_PREFERENCES);
  expect(readPreferences({ getItem: () => { throw Error("blocked"); } })).toEqual(DEFAULT_PREFERENCES);
  expect(() => writePreferences({ tab: "phase" }, { getItem: () => null, setItem: () => { throw Error("full"); } })).not.toThrow();
});
it("persists inclusive bottom white bounds including zero and ignores invalid values", () => {
  let raw: string | null = null;
  const storage = {getItem: () => raw, setItem: (_: string, value: string) => {raw = value;}};
  writePreferences({atlasFilter: {left: 3, right: null, bottomWhiteMin: 0, bottomWhiteMax: 7, excluded: [5]}}, storage);
  expect(readPreferences(storage).atlasFilter).toEqual({left: 3, right: null, bottomWhiteMin: 0, bottomWhiteMax: 7, excluded: [5]});
  writePreferences({atlasFilter: {left: null, right: null, bottomWhiteMin: null, bottomWhiteMax: null}}, storage);
  expect(readPreferences(storage).atlasFilter).toEqual({left: null, right: null});
  raw = JSON.stringify({atlasFilter: {bottomWhiteMin: -1, bottomWhiteMax: "7"}});
  expect(readPreferences(storage).atlasFilter).toEqual({left: null, right: null});
});
