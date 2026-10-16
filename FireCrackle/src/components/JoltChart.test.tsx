import {it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {JoltChart} from './JoltChart';
import type {JoltState} from '../lib/jolt';
it('shows both legends and a cursor readout without hiding them behind a disclosure',()=>{
 const state:JoltState={version:1,clock:'jolt',session:'["1","1"]',data:{name:'x',source:'',version:'2.3',unresolved:0,anchors:[{time:0,tick:0,game:'1',screen:'1'},{time:1,tick:20,game:'1',screen:'1'}]}};
 const html=renderToStaticMarkup(<JoltChart state={state}/>);
 expect(html).toContain('jolt chart legend');expect(html).toContain('agreement chart legend');expect(html).toContain('Hover a plot');
});
