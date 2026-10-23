import {beforeEach,expect,it,vi} from 'vitest';
import type {ReactElement} from 'react';
const hooks=vi.hoisted(()=>({values:[] as any[],cursor:0,effects:[] as Array<()=>any>}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),useEffect:(f:()=>any)=>hooks.effects.push(f),useRef:(initial:any)=>{const i=hooks.cursor++;if(!(i in hooks.values))hooks.values[i]={current:initial};return hooks.values[i];},useState:(initial:any)=>{const i=hooks.cursor++;if(!(i in hooks.values))hooks.values[i]=typeof initial==='function'?initial():initial;return [hooks.values[i],(v:any)=>{hooks.values[i]=typeof v==='function'?v(hooks.values[i]):v;}];}}));
import {ImageViewerDialog,type ViewerImage} from './ImageViewer';
type El=ReactElement<Record<string,any>>;
function find(node:any,predicate:(n:El)=>boolean):El[]{if(Array.isArray(node))return node.flatMap(n=>find(n,predicate));if(!node?.props)return [];return [...(predicate(node)?[node]:[]),...find(node.props.children,predicate)];}
const text=(node:any):string=>Array.isArray(node)?node.map(text).join(''):typeof node==='string'||typeof node==='number'?String(node):node?.props?text(node.props.children):'';
const button=(root:any,label:string)=>find(root,n=>(n.props.label??n.props['aria-label'])===label&&typeof n.props.onClick==='function')[0];
const onClose=vi.fn(),onIndex=vi.fn();
let images:ViewerImage[]=[{src:'blob:after',title:'After',detail:'Frame 162963'}];
function render(index=0){hooks.cursor=0;hooks.effects=[];return ImageViewerDialog({images,index,onIndex,onClose});}
const load=(root:any,w=2560,h=1440)=>find(root,n=>n.type==='img')[0].props.onLoad({currentTarget:{naturalWidth:w,naturalHeight:h}});
beforeEach(()=>{vi.stubGlobal('window',{addEventListener(){},removeEventListener(){},devicePixelRatio:1});vi.stubGlobal('document',{activeElement:null});hooks.values=[];onClose.mockClear();onIndex.mockClear();images=[{src:'blob:after',title:'After',detail:'Frame 162963'}];});

it('is a modal dialog with the picture title and detail, and closes from its button',()=>{
  const root=render();
  const dialog=find(root,n=>n.props.role==='dialog')[0];
  expect(dialog.props['aria-modal']).toBe(true);
  expect(text(root)).toContain('After');expect(text(root)).toContain('Frame 162963');
  button(root,'Close viewer').props.onClick();expect(onClose).toHaveBeenCalled();
});
it('shows the native resolution and the zoom once the picture loads, and only then enables copy and save',()=>{
  let root=render();
  expect(button(root,'Copy image').props.disabled).toBe(true);
  expect(button(root,'Save image').props.disabled).toBe(true);
  load(root);root=render();
  expect(text(root)).toContain('2560 × 1440');
  expect(text(root)).toMatch(/\d+ ?%/);
  expect(button(root,'Copy image').props.disabled).toBe(false);
  expect(button(root,'Save image').props.disabled).toBe(false);
  for(const label of ['Zoom in','Zoom out','Fit to window','Actual size'])expect(button(root,label)).toBeTruthy();
});
it('a picture that fails to load says so and cannot be copied or saved',()=>{
  let root=render();
  find(root,n=>n.type==='img')[0].props.onError();root=render();
  expect(find(root,n=>n.props.role==='alert').map(text).join('')).toContain('Could not load');
  expect(button(root,'Copy image').props.disabled).toBe(true);
  expect(button(root,'Save image').props.disabled).toBe(true);
});
it('a single picture has no previous/next; a set steps through its pictures and stops at the ends',()=>{
  expect(button(render(),'Previous image')).toBeUndefined();
  images=[{src:'blob:before',title:'Before'},{src:'blob:after',title:'After'}];
  hooks.values=[];let root=render(0);
  expect(button(root,'Previous image').props.disabled).toBe(true);
  button(root,'Next image').props.onClick();expect(onIndex).toHaveBeenCalledWith(1);
  hooks.values=[];root=render(1);
  expect(button(root,'Next image').props.disabled).toBe(true);
  expect(text(root)).toContain('2 / 2');
});
it('a picture made on demand (a canvas) is shown once it is ready, and a failure is reported',async()=>{
  images=[{src:()=>Promise.resolve('data:image/png;base64,AA'),title:'Difference'}];
  let root=render();
  expect(find(root,n=>n.type==='img')).toHaveLength(0);
  await Promise.all(hooks.effects.map(f=>f()));await Promise.resolve();
  root=render();
  expect(find(root,n=>n.type==='img')[0].props.src).toBe('data:image/png;base64,AA');
  images=[{src:()=>Promise.reject(Error('canvas gone')),title:'Difference'}];
  hooks.values=[];root=render();
  await Promise.all(hooks.effects.map(f=>f()));await new Promise(r=>setTimeout(r,0));
  root=render();
  expect(find(root,n=>n.props.role==='alert').map(text).join('')).toContain('canvas gone');
});
