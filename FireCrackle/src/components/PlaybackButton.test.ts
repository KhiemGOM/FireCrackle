import {afterEach,expect,it,vi} from 'vitest';
import type {ReactElement} from 'react';
const hooks=vi.hoisted(()=>({open:false,setOpen:vi.fn()}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),useState:()=>[hooks.open,hooks.setOpen],useEffect:()=>{},useId:()=>'playback-menu',useRef:()=>({current:null})}));
import {PlaybackButton,PLAYBACK_SPEEDS} from './PlaybackButton';
type El=ReactElement<Record<string,any>>;
function nodes(node:El):El[]{return [node,...[node.props.children].flat(Infinity).filter(n=>n&&typeof n==='object'&&'props'in n).flatMap(nodes)];}
const props=()=>({playback:{dir:0 as const,speed:1},speed:.25,maxSpeed:8,onToggle:vi.fn(),onSpeed:vi.fn()});
afterEach(()=>{hooks.open=false;vi.clearAllMocks();});
it('keeps play separate from the menu and shows the selected speed while paused',()=>{
  const input=props(),tree=nodes(PlaybackButton(input));
  const play=tree.find(n=>n.props.label==='Play video')!;
  expect(play.props.title).toContain('¼×');play.props.onClick();expect(input.onToggle).toHaveBeenCalledOnce();
  tree.find(n=>n.props['aria-haspopup']==='menu')!.props.onClick();
  expect(input.onToggle).toHaveBeenCalledOnce();expect(input.onSpeed).not.toHaveBeenCalled();
});
it('offers the five presets with a current check and applies a choice without toggling playback',()=>{
  hooks.open=true;const input=props(),tree=nodes(PlaybackButton(input));
  const options=tree.filter(n=>n.props.role==='menuitemradio');
  expect(options).toHaveLength(5);expect(options.map(n=>n.props['aria-checked'])).toEqual([true,false,false,false,false]);
  options.forEach(n=>n.props.onClick());
  expect(input.onSpeed.mock.calls.map(call=>call[0])).toEqual([...PLAYBACK_SPEEDS]);
  expect(input.onToggle).not.toHaveBeenCalled();
  expect(options.every(n=>n.props['data-owns-keys']==='true')).toBe(true);
});
it('reflects actual shuttle speed, respects the maximum and handles Escape without global shortcuts',()=>{
  hooks.open=true;const input={...props(),playback:{dir:-1 as const,speed:2},maxSpeed:2};
  const tree=nodes(PlaybackButton(input));expect(tree.find(n=>n.props.label==='Pause video')!.props.title).toContain('2×');
  const options=tree.filter(n=>n.props.role==='menuitemradio');expect(options[3].props['aria-checked']).toBe(true);expect(options[4].props.disabled).toBe(true);
  const event={key:'Escape',preventDefault:vi.fn(),stopPropagation:vi.fn()};options[0].props.onKeyDown(event);
  expect(event.preventDefault).toHaveBeenCalledOnce();expect(event.stopPropagation).toHaveBeenCalledOnce();expect(hooks.setOpen).toHaveBeenCalledWith(false);
});
