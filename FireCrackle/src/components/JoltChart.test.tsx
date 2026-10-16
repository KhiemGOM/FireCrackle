import {it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {JoltChart} from './JoltChart';
import type {JoltState} from '../lib/jolt';
it('shows both legends and a cursor readout without hiding them behind a disclosure',()=>{
 const state:JoltState={version:1,clock:'jolt',session:'["1","1"]',data:{name:'x',source:'',version:'2.3',unresolved:0,anchors:[{time:0,tick:0,game:'1',screen:'1'},{time:1,tick:20,game:'1',screen:'1'}]}};
 const html=renderToStaticMarkup(<JoltChart state={state}/>);
 expect(html).toContain('jolt chart legend');expect(html).toContain('agreement chart legend');expect(html).toContain('Hover a plot');
});

it('renders both gap continuations and their full delta in Jolt + Fire itself',()=>{
 const state:JoltState={version:1,clock:'jolt',session:'["1","1"]',data:{name:'x',source:'',version:'2.3',unresolved:0,anchors:[{time:0,tick:0,game:'1',screen:'1',segment:'a'},{time:1,tick:20,game:'1',screen:'1',segment:'a'},{time:4,tick:110,game:'1',screen:'1',segment:'b'}]}};
 const chart={points:[{frame:60,pts:1,step:20,phase:0},{frame:120,pts:2,step:8,phase:0},{frame:240,pts:4,step:14,phase:0}],runs:[],flags:[],tick_rate:20,window_ticks:2};
 const html=renderToStaticMarkup(<JoltChart state={state} chart={chart}/>);
 expect(html.match(/stroke="#55d8ed"/g)).toHaveLength(2);
 expect(html.match(/stroke="#f2ba79"/g)).toHaveLength(2);
 expect(html.match(/Clock continuation Δ \+30.0 ticks/g)).toHaveLength(2);
 expect(html).toContain('stroke="#a0a8b8"');
});
