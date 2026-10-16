import {expect,it} from 'vitest';
import {zoomAxis} from './plotAxes';
it('zooms a single range around its centre without changing its input',()=>{
 const x:[number,number]=[10,30],y:[number,number]=[-16,16];
 expect(zoomAxis(x,2)).toEqual([15,25]);expect(x).toEqual([10,30]);expect(y).toEqual([-16,16]);
 expect(zoomAxis(y,.5)).toEqual([-32,32]);expect(zoomAxis(y,NaN)).toBe(y);
});
