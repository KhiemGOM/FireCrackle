import { expect, it } from "vitest";
import { DEFAULT_PREFERENCES, readPreferences, writePreferences } from "./preferences";
it('restores all Misc tools controls and rejects invalid saved settings',()=>{
 let raw:string|null=null;const storage={getItem:()=>raw,setItem:(_:string,value:string)=>{raw=value;}};
 writePreferences({miscTool:'gui',miscGuiMode:'aim',miscGuiDisplay:'after',miscGuiOrder:'time',miscGuiMenus:true},storage);
 writePreferences({miscCompareMode:'diff',miscDifferenceGain:8},storage);
 expect(readPreferences(storage)).toMatchObject({miscTool:'gui',miscGuiMode:'aim',miscGuiDisplay:'after',miscGuiOrder:'time',miscGuiMenus:true,miscCompareMode:'diff',miscDifferenceGain:8});
 raw=JSON.stringify({miscTool:'bad',miscGuiMode:'bad',miscGuiDisplay:'bad',miscGuiOrder:'bad',miscGuiMenus:1,miscCompareMode:'bad',miscDifferenceGain:9});
 expect(readPreferences(storage)).toEqual(DEFAULT_PREFERENCES);
});
it('restores the comparison post toggles and the gallery pair, repairing bad ones',()=>{
 let raw:string|null=null;const storage={getItem:()=>raw,setItem:(_:string,value:string)=>{raw=value;}};
 expect(readPreferences(storage).miscComparePost).toEqual({veil:false,portal:false,enhance:false,blink:false});
 expect(readPreferences(storage).miscGuiPair).toBe('around');
 writePreferences({miscComparePost:{veil:true,portal:false,enhance:true,blink:true},miscGuiPair:'open'},storage);
 expect(readPreferences(storage)).toMatchObject({miscComparePost:{veil:true,portal:false,enhance:true,blink:true},miscGuiPair:'open'});
 // the removed GUI blackout setting is dropped when an old save is read
 raw=JSON.stringify({miscComparePost:{veil:true,gui:true}});
 expect(readPreferences(storage).miscComparePost).toEqual({veil:true,portal:false,enhance:false,blink:false});
 raw=JSON.stringify({miscComparePost:{veil:'yes',portal:true},miscGuiPair:'sideways'});
 expect(readPreferences(storage)).toMatchObject({miscComparePost:{veil:false,portal:true,enhance:false,blink:false},miscGuiPair:'around'});
});
it('defaults the GUI tool to aim jumps',()=>{
 expect(DEFAULT_PREFERENCES.miscGuiMode).toBe('aim');
 expect(readPreferences({getItem:()=>null}).miscGuiMode).toBe('aim');
});
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
