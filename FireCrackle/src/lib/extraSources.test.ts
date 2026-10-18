import {afterEach,expect,it,vi} from 'vitest';
import {readExtraSources,saveExtraSources} from './extraSources';
afterEach(()=>vi.unstubAllGlobals());
it('defaults off and persists explicit opt-in and opt-out',()=>{
 const data=new Map<string,string>();
 vi.stubGlobal('localStorage',{getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>data.set(key,value)});
 expect(readExtraSources()).toBe(false);
 saveExtraSources(true);expect(readExtraSources()).toBe(true);
 saveExtraSources(false);expect(readExtraSources()).toBe(false);
});
it('stays off when storage is unavailable',()=>{
 vi.stubGlobal('localStorage',{getItem:()=>{throw Error('blocked');},setItem:()=>{throw Error('blocked');}});
 expect(readExtraSources()).toBe(false);expect(()=>saveExtraSources(true)).not.toThrow();
});
