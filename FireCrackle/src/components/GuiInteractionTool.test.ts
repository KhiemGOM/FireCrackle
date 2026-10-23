import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {ReactElement} from 'react';
import type {Backend} from '../lib/api';
const hooks=vi.hoisted(()=>({values:[] as any[],cursor:0,effects:[] as Array<()=>any>}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),useEffect:(f:()=>any)=>hooks.effects.push(f),useRef:(initial:any)=>{const i=hooks.cursor++;if(!(i in hooks.values))hooks.values[i]={current:initial};return hooks.values[i];},useState:(initial:any)=>{const i=hooks.cursor++;if(!(i in hooks.values))hooks.values[i]=typeof initial==='function'?initial():initial;return [hooks.values[i],(v:any)=>{hooks.values[i]=typeof v==='function'?v(hooks.values[i]):v;}];}}));
import {GuiInteractionTool} from './GuiInteractionTool';
import {PREFERENCES_KEY} from '../lib/preferences';
type El=ReactElement<Record<string,any>>;
function find(node:any,predicate:(n:El)=>boolean):El[]{if(Array.isArray(node))return node.flatMap(n=>find(n,predicate));if(!node?.props)return [];return [...(predicate(node)?[node]:[]),...find(node.props.children,predicate)];}
const backend={} as Backend,onCompare=vi.fn();
const ranges=[{first:20,last:39,menu:false},{first:50,last:59,menu:false},{first:70,last:79,menu:true}];
function render(){hooks.cursor=0;hooks.effects=[];return GuiInteractionTool({backend,videoKey:'video',fps:60,onCompare});}
beforeEach(()=>{hooks.values=[];onCompare.mockClear();render();hooks.values[0]={state:'done',total:100,processed:100,ranges};});
afterEach(()=>vi.unstubAllGlobals());
it('restores nested GUI review choices from local storage after remount',()=>{
 let raw=JSON.stringify({miscGuiMode:'aim',miscGuiDisplay:'after',miscGuiOrder:'time',miscGuiMenus:true});
 vi.stubGlobal('localStorage',{getItem:(key:string)=>key===PREFERENCES_KEY?raw:null,setItem:(key:string,value:string)=>{if(key===PREFERENCES_KEY)raw=value;}});
 hooks.values=[];let root=render();hooks.values[0]={state:'done',total:100,processed:100,ranges};root=render();
 expect(find(root,n=>n.props['aria-label']==='Aim jump images')).toHaveLength(1);
 expect(find(root,n=>n.type==='select')[0].props.value).toBe('time');
 expect(find(root,n=>n.props.large===true)).toHaveLength(3);
 expect(find(root,n=>n.props.large===true)[0].props.display).toBe('after');
 find(root,n=>n.props.children==='Before')[0].props.onClick();root=render();
 hooks.effects[0]();hooks.values=[];root=render();hooks.values[0]={state:'done',total:100,processed:100,ranges};root=render();
 expect(find(root,n=>n.props.large===true)[0].props.display).toBe('before');
});
it('opens on aim jumps by default, listed before intervals, and still restores a saved intervals choice',()=>{
  let root=render();
  expect(find(root,n=>n.props['aria-label']==='Aim jump images')).toHaveLength(1);
  const modes=find(root,n=>n.props.children==='Aim jumps'||n.props.children==='Intervals').map(n=>n.props.children);
  expect(modes).toEqual(['Aim jumps','Intervals']);
  vi.stubGlobal('localStorage',{getItem:(key:string)=>key===PREFERENCES_KEY?JSON.stringify({miscGuiMode:'intervals'}):null,setItem:()=>{}});
  hooks.values=[];root=render();hooks.values[0]={state:'done',total:100,processed:100,ranges};root=render();
  expect(find(root,n=>n.props['aria-label']==='Aim jump images')).toHaveLength(0);
  expect(find(root,n=>n.props.children==='Intervals')[0].props['aria-pressed']).toBe(true);
});
it('shows image-only large cards in aim mode, and clicks open the original GUI interval',()=>{
  let root=render();find(root,n=>n.props.children==='Aim jumps')[0].props.onClick();root=render();
  const gallery=find(root,n=>n.props['aria-label']==='Aim jump images')[0];
  const cards=find(gallery,n=>n.type==='button');expect(cards).toHaveLength(2);
  expect(find(gallery,n=>n.type==='span')).toHaveLength(0);
  const pictures=find(gallery,n=>n.props.large===true);expect(pictures).toHaveLength(2);
  expect(pictures[0].props.display).toBe('blink');
  cards[0].props.onClick();expect(onCompare).toHaveBeenCalledWith(ranges[0],'around');
  find(root,n=>n.props.children==='Before')[0].props.onClick();root=render();
  expect(find(root,n=>n.props.large===true)[0].props.display).toBe('before');
});
const firsts=(root:any)=>find(root,n=>n.props.large===true).map(n=>n.props.first);
const aim=()=>{const root=render();find(root,n=>n.props.children==='Aim jumps')[0].props.onClick();return root;};
it('orders by the scores known so far while ranking is still running, and can restore chronological order',()=>{
  let root=aim();
  hooks.values[7]={video:'video',key:'sealed',scores:new Map([['20-39',.1],['50-59',.9]]),processed:1,done:false};
  root=render();expect(firsts(root)).toEqual([50,20]);
  find(root,n=>n.type==='select')[0].props.onChange({target:{value:'time'}});root=render();
  expect(firsts(root)).toEqual([20,50]);
});
it('a newly arrived range joins after the scored ones, then moves into place when scored, without reverting',()=>{
  let root=aim();
  hooks.values[0]={state:'running',total:100,processed:90,ranges:[...ranges.slice(0,2),{first:80,last:89,menu:false}]};
  hooks.values[7]={video:'video',key:'older-key',scores:new Map([['20-39',.1],['50-59',.9]]),processed:2,done:false};
  root=render();expect(firsts(root)).toEqual([50,20,80]);
  hooks.values[7].scores.set('80-89',.5);root=render();expect(firsts(root)).toEqual([50,80,20]);
});
it('never applies scores computed for another video',()=>{
  let root=aim();
  hooks.values[7]={video:'other-video',key:'sealed',scores:new Map([['20-39',.1],['50-59',.9]]),processed:2,done:true};
  root=render();expect(firsts(root)).toEqual([20,50]);
});
it('keeps video order when a preview failed to score (null) and when nothing is scored yet',()=>{
  let root=aim();
  hooks.values[7]={video:'video',key:'sealed',scores:new Map([['20-39',null],['50-59',null]]),processed:2,done:true};
  root=render();expect(firsts(root)).toEqual([20,50]);
  hooks.values[7]={video:'video',key:'sealed',scores:new Map(),processed:0,done:false};
  root=render();expect(firsts(root)).toEqual([20,50]);
});
it('a running GUI scan shows the shared speed and ETA readout; a finished one does not',()=>{
  hooks.values[0]={video_path:'video',state:'running',total:1000,processed:400,detected:0,ranges,error:null};
  let stats=find(render(),n=>typeof n.type==='function'&&n.type.name==='ScanProgressStats');
  expect(stats).toHaveLength(1);
  expect(stats[0].props.progress).toEqual({identity:JSON.stringify(['gui','video',1000]),running:true,processed:400,total:1000});
  hooks.values[0]={...hooks.values[0],state:'done',processed:1000};
  stats=find(render(),n=>typeof n.type==='function'&&n.type.name==='ScanProgressStats');
  expect(stats).toHaveLength(0);
});
it('a GUI scan that failed says so instead of Ready, and a paused one says its progress is saved',()=>{
  hooks.values[0]={video_path:'video',state:'error',total:1000,processed:400,detected:0,ranges,error:'decode failed'};
  let text=JSON.stringify(render());
  expect(text).toContain('Scan failed · progress saved');expect(text).not.toContain('Ready');
  hooks.values[0]={...hooks.values[0],state:'paused',error:null};
  text=JSON.stringify(render());expect(text).toContain('Paused · progress saved');
});

it('the gallery can pair the frames across the cut where the GUI opens or closes',()=>{
  let raw:string|null=null;
  vi.stubGlobal('localStorage',{getItem:(key:string)=>key===PREFERENCES_KEY?raw:null,setItem:(key:string,value:string)=>{if(key===PREFERENCES_KEY)raw=value;}});
  let root=aim();root=render();
  const pair=(label:string)=>find(root,n=>n.props.children===label&&n.props['aria-pressed']!==undefined)[0];
  expect(pair('Around GUI').props['aria-pressed']).toBe(true);
  pair('GUI opens').props.onClick();root=render();
  expect(find(root,n=>n.props.large===true)[0].props.pair).toBe('open');
  const card=find(find(root,n=>n.props['aria-label']==='Aim jump images')[0],n=>n.type==='button')[0];
  expect(card.props['aria-label']).toBe('Compare frames 19 and 20');
  card.props.onClick();expect(onCompare).toHaveBeenCalledWith(ranges[0],'open');
  hooks.effects[0]();expect(JSON.parse(raw!).miscGuiPair).toBe('open');
});
it('gallery pictures are auto-unveiled with the Enhance veil settings',()=>{
  const veil={minShare:.4,margin:.2,slack:3};
  hooks.cursor=0;hooks.effects=[];
  const root=GuiInteractionTool({backend,videoKey:'video',fps:60,onCompare,veil});
  const thumbs=find(root,n=>n.props.first!==undefined&&n.props.last!==undefined);
  expect(thumbs.length).toBeGreaterThan(0);
  for(const thumb of thumbs)expect(thumb.props.veil).toBe(veil);
});
it('every aim card has an enlarge button that shows exactly the pictures its card displays, separate from the card click',()=>{
  const root=aim();
  const gallery=find(root,n=>n.props['aria-label']==='Aim jump images')[0];
  const enlarge=find(gallery,n=>typeof n.type==='function'&&n.type.name==='ViewButton');
  expect(enlarge).toHaveLength(2);
  // nothing shown yet: nothing to view
  expect(enlarge[0].props.images()).toEqual([]);
  const thumbs=find(gallery,n=>typeof n.props.onShown==='function');
  thumbs[0].props.onShown({before:'data:shown-before',after:'data:shown-after',unveiled:true});
  const images=enlarge[0].props.images();
  expect(images.map((i:any)=>i.src)).toEqual(['data:shown-before','data:shown-after']);
  expect(images.map((i:any)=>i.title)).toEqual(['Before GUI','After GUI']);
  // and the same pictures at native resolution
  expect(images.map((i:any)=>typeof i.native)).toEqual(['function','function']);
  expect(images.map((i:any)=>i.detail)).toEqual([expect.stringContaining('Frame 19 '),expect.stringContaining('Frame 40 ')]); // around: the frames either side of the GUI
  // only the before picture is shown while the after one loads
  thumbs[1].props.onShown({before:'data:only-before',unveiled:false});
  expect(enlarge[1].props.images().map((i:any)=>i.src)).toEqual(['data:only-before']);
  expect(onCompare).not.toHaveBeenCalled();
});
