import {it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ChartLegend} from './ChartLegend';
it('always exposes keys for every chart and explains canonical gaps separately from hard events',()=>{
 for(const kind of ['phase','row','jolt','agreement'] as const){const html=renderToStaticMarkup(<ChartLegend kind={kind} canonical/>);expect(html).toContain('chart legend');expect(html).toContain('Hard review event');expect(html).toContain('Yellow gap = unresolved Jolt clock');expect(html).toContain('uncertain event location');}
});
