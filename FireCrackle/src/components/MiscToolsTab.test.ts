import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {ReactElement} from 'react';
const hooks=vi.hoisted(()=>({values:[] as any[],cursor:0,effects:[] as Array<()=>any>}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),useEffect:(f:()=>any)=>hooks.effects.push(f),useRef:(initial:any)=>{const i=hooks.cursor++;if(!(i in hooks.values))hooks.values[i]={current:initial};return hooks.values[i];},useState:(initial:any)=>{const i=hooks.cursor++;if(!(i in hooks.values))hooks.values[i]=typeof initial==='function'?initial():initial;return [hooks.values[i],(v:any)=>{hooks.values[i]=typeof v==='function'?v(hooks.values[i]):v;}];}}));
import {MiscToolsTab} from './MiscToolsTab';
import type {Backend,View} from '../lib/api';
import {PREFERENCES_KEY} from '../lib/preferences';
type El=ReactElement<Record<string,any>>;
function find(node:any,predicate:(n:El)=>boolean):El[]{if(Array.isArray(node))return node.flatMap(n=>find(n,predicate));if(!node?.props)return [];return [...(predicate(node)?[node]:[]),...find(node.props.children,predicate)];}
const backend={frame:vi.fn(async()=>new ArrayBuffer(2))} as unknown as Backend,onOpen=vi.fn();
const view={current:10,frame_count:100,fps:60} as View;
function render(){hooks.cursor=0;hooks.effects=[];return MiscToolsTab({backend,view,videoKey:'video.mp4',onOpenFrame:onOpen});}
beforeEach(()=>{hooks.values=[];hooks.effects=[];onOpen.mockClear();});
afterEach(()=>vi.unstubAllGlobals());
it('restores the selected inspection tool after remount and merges other settings',()=>{
 let raw:string|null=null;
 vi.stubGlobal('localStorage',{getItem:(key:string)=>key===PREFERENCES_KEY?raw:null,setItem:(key:string,value:string)=>{if(key===PREFERENCES_KEY)raw=value;}});
 let root=render();find(root,n=>n.props.role==='tab'&&n.props.children==='GUI interactions')[0].props.onClick();root=render();
 hooks.effects.forEach(effect=>effect());hooks.values=[];root=render();
 expect(find(root,n=>n.props.role==='tab'&&n.props.children==='GUI interactions')[0].props['aria-selected']).toBe(true);
});
it('restores comparison view and brightness and saves changes',async()=>{
 let raw=JSON.stringify({miscCompareMode:'diff',miscDifferenceGain:6});
 vi.stubGlobal('localStorage',{getItem:(key:string)=>key===PREFERENCES_KEY?raw:null,setItem:(key:string,value:string)=>{if(key===PREFERENCES_KEY)raw=value;}});
 const side=find(render(),n=>n.props.title==='After')[0];hooks.values=[];hooks.cursor=0;hooks.effects=[];
 vi.stubGlobal('URL',{createObjectURL:vi.fn(()=> 'blob:review'),revokeObjectURL:vi.fn()});
 (side.type as Function)(side.props);const cleanups=hooks.effects.map(effect=>effect());await Promise.resolve();await Promise.resolve();
 hooks.cursor=0;hooks.effects=[];let child=(side.type as Function)(side.props);
 const gain=find(child,n=>n.props['aria-label']==='Difference brightness')[0];expect(gain.props.value).toBe(6);
 gain.props.onChange({target:{value:'7'}});hooks.cursor=0;hooks.effects=[];child=(side.type as Function)(side.props);
 hooks.effects[2]();expect(JSON.parse(raw)).toMatchObject({miscCompareMode:'diff',miscDifferenceGain:7});
 cleanups.forEach(cleanup=>cleanup?.());
});
it('manual comparison uses exactly both entered endpoints and their midpoint',()=>{
 let root=render();expect(find(root,n=>n.props.title==='Before')[0].props.frame).toBe(10);
 expect(find(root,n=>n.props.title==='Midpoint')[0].props.frame).toBe(10);
 find(root,n=>n.props['aria-label']==='Last comparison frame')[0].props.onChange({target:{valueAsNumber:19}});root=render();
 expect(find(root,n=>n.props.title==='Midpoint')[0].props.frame).toBe(14);
 expect(find(root,n=>n.props.title==='After')[0].props.frame).toBe(19);
 find(root,n=>n.type==='button'&&n.props.children==='Use current frame')[0].props.onClick();root=render();
 expect(find(root,n=>n.props.title==='After')[0].props.frame).toBe(10);
});
it('opens exact detected GUI endpoints in the shared comparison view',()=>{
 let root=render();find(root,n=>n.props.role==='tab'&&n.props.children==='GUI interactions')[0].props.onClick();root=render();
 const tool=find(root,n=>typeof n.props.onCompare==='function')[0];
 expect(tool.props.backend).toBe(backend);
 tool.props.onCompare({first:20,last:39,menu:false});root=render();
 expect(find(root,n=>n.props.title==='Before')[0].props.frame).toBe(19);
 expect(find(root,n=>n.props.title==='After')[0].props.frame).toBe(40);
 expect(find(root,n=>n.props.title==='Midpoint')[0].props.frame).toBe(29);
});
it('loads the actual frame decoder output, opens its exact frame and revokes its temporary image',async()=>{
 const root=render(),side=find(root,n=>n.props.title==='Before')[0];
 hooks.cursor=0;hooks.values=[];hooks.effects=[];
 const createObjectURL=vi.fn(()=> 'blob:review'),revokeObjectURL=vi.fn();vi.stubGlobal('URL',{createObjectURL,revokeObjectURL});
 let child=(side.type as Function)(side.props);const cleanup=hooks.effects[0]();await Promise.resolve();await Promise.resolve();
 hooks.cursor=0;child=(side.type as Function)(side.props);
 expect(backend.frame).toHaveBeenCalledWith(10);expect(find(child,n=>n.type==='img')[0].props.src).toBe('blob:review');
 find(child,n=>n.type==='button')[0].props.onClick();expect(onOpen).toHaveBeenCalledWith(10);
 cleanup();expect(revokeObjectURL).toHaveBeenCalledWith('blob:review');
});

it('offers blink and pixel difference only when both endpoint images are ready',async()=>{
 const root=render(),side=find(root,n=>n.props.title==='After')[0];
 hooks.cursor=0;hooks.values=[];hooks.effects=[];
 vi.stubGlobal('URL',{createObjectURL:vi.fn(()=> 'blob:review'),revokeObjectURL:vi.fn()});
 let child=(side.type as Function)(side.props);
 expect(find(child,n=>n.props.children==='Difference')[0].props.disabled).toBe(true);
 const cleanups=hooks.effects.map(effect=>effect());await Promise.resolve();await Promise.resolve();
 hooks.cursor=0;child=(side.type as Function)(side.props);
 const diff=find(child,n=>n.props.children==='Difference')[0];expect(diff.props.disabled).toBe(false);diff.props.onClick();
 hooks.cursor=0;child=(side.type as Function)(side.props);
 expect(find(child,n=>n.props['aria-label']==='Difference brightness')).toHaveLength(1);
 expect(find(child,n=>n.props.before==='blob:review'&&n.props.after==='blob:review')).toHaveLength(1);
 cleanups.forEach(cleanup=>cleanup?.());
});
it('includes real video boundary frames in manual comparison',()=>{
 const boundary={...view,current:0};hooks.cursor=0;
 const root=MiscToolsTab({backend,view:boundary,onOpenFrame:onOpen});
 expect(find(root,n=>n.props.title?.includes?.('annotated WebP'))[0].props.disabled).toBe(false);
});

const toggle=(root:any,label:string)=>find(root,n=>n.props['aria-label']===label)[0];
it('post effects reuse the Enhance settings; Enhance is offered only when it can run; there is no GUI blackout',()=>{
 let raw:string|null=null;
 vi.stubGlobal('localStorage',{getItem:(key:string)=>key===PREFERENCES_KEY?raw:null,setItem:(key:string,value:string)=>{if(key===PREFERENCES_KEY)raw=value;}});
 let root=render();
 for(const label of ['Unveil comparison frames','Undo portal on comparison frames','Enhance comparison frames'])expect(toggle(root,label).props.checked).toBe(false);
 // unveil already keeps the open inventory or menu as it is; nothing paints it black
 expect(toggle(root,'Mask the open GUI on comparison frames')).toBeUndefined();
 expect(toggle(root,'Enhance comparison frames').props.disabled).toBe(true); // no effect is on in the Enhance panel
 toggle(root,'Unveil comparison frames').props.onChange({target:{checked:true}});root=render();
 expect(toggle(root,'Unveil comparison frames').props.checked).toBe(true);
 hooks.effects.forEach(effect=>effect());
 expect(JSON.parse(raw!).miscComparePost).toMatchObject({veil:true});
});
it('Apply to blink sits beside the view modes of After and needs a post effect',()=>{
 let root=render();
 const after=()=>find(root,n=>n.props.title==='After')[0];
 expect(after().props.applyToBlink).toBe(false);
 toggle(root,'Unveil comparison frames').props.onChange({target:{checked:true}});root=render();
 after().props.onApplyToBlink(true);root=render();
 expect(after().props.applyToBlink).toBe(true);
 expect(find(root,n=>n.props.title==='Before')[0].props.onApplyToBlink).toBeUndefined();
});
it('a GUI boundary opens its two frames with auto unveil on',()=>{
 let root=render();find(root,n=>n.props.role==='tab'&&n.props.children==='GUI interactions')[0].props.onClick();root=render();
 find(root,n=>typeof n.props.onCompare==='function')[0].props.onCompare({first:20,last:39,menu:false},'open');root=render();
 expect(find(root,n=>n.props.title==='Before')[0].props.frame).toBe(19);
 expect(find(root,n=>n.props.title==='After')[0].props.frame).toBe(20);
 expect(toggle(root,'Unveil comparison frames').props.checked).toBe(true);
});
it('the After card blinks the processed pictures only with Apply to blink',()=>{
 const root=render(),side=find(root,n=>n.props.title==='After')[0];
 const srcs=(applyToBlink:boolean)=>{
  hooks.cursor=0;hooks.values=[];hooks.effects=[];
  const props:Record<string,any>={...side.props,processed:{url:'blob:after-post',compareUrl:'blob:before-post'},applyToBlink};
  (side.type as Function)(props);
  hooks.values[0]={frame:props.frame,url:'blob:after',full:true};hooks.values[2]={frame:props.compareFrame,url:'blob:before',full:true};
  hooks.values[4]='blink';hooks.values[6]=true;hooks.cursor=0;
  return find((side.type as Function)(props),n=>n.type==='img').map(n=>n.props.src);
 };
 expect(srcs(true)).toEqual(['blob:after-post','blob:before-post']);
 expect(srcs(false)).toEqual(['blob:after','blob:before']);
});
it('a compared picture opens the image viewer with Before and After, starting on the clicked side',async()=>{
 const side=find(render(),n=>n.props.title==='After')[0];hooks.values=[];hooks.cursor=0;hooks.effects=[];
 vi.stubGlobal('URL',{createObjectURL:vi.fn(()=> 'blob:review'),revokeObjectURL:vi.fn()});
 (side.type as Function)(side.props);const cleanups=hooks.effects.map(effect=>effect());await Promise.resolve();await Promise.resolve();
 hooks.cursor=0;hooks.effects=[];const child=(side.type as Function)(side.props);
 const viewable=find(child,n=>typeof n.type==='function'&&n.type.name==='Viewable')[0];
 expect(viewable).toBeTruthy();
 const images=typeof viewable.props.images==='function'?viewable.props.images():viewable.props.images;
 expect(images.map((i:any)=>i.title)).toEqual(['Before','After']);
 expect(images[viewable.props.index].detail).toContain(`Frame ${side.props.frame}`);
 // the viewer shows the displayed pictures themselves
 expect(images.map((i:any)=>i.src)).toEqual(['blob:review','blob:review']);
 // plain frames also open at native resolution
 expect(images.map((i:any)=>typeof i.native)).toEqual(['function','function']);
 cleanups.forEach(cleanup=>cleanup?.());
});
