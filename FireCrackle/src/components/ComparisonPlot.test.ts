import {expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ComparisonPlot} from './ComparisonPlot';
it('shows recovered readings as dots, clips data to the plot and preserves report event styles',()=>{
 const svg=renderToStaticMarkup(createElement(ComparisonPlot,{title:'Jolt',series:[{name:'Reading',color:'#64a8d1',dots:true,trace:[[{time:0,value:100},{time:1,value:120}]]}],lo:0,hi:1,bottom:90,top:130,hover:null,onHover:()=>{},formatY:n=>`${n/20}s`,markers:[{time:.5,label:'Reported cut',color:'#f16b72'}]}));
 expect(svg.match(/<circle /g)).toHaveLength(2);
 expect(svg).toContain('fill="#c4ff38"');expect(svg).toContain('<clipPath');expect(svg).toContain('clip-path="url(');
 expect(svg).toContain('Reported cut');expect(svg).toContain('stroke="#f16b72"');expect(svg).toContain('5.5s');
});
