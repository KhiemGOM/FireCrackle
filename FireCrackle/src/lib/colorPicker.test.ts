import {expect,it} from 'vitest';
import {hexToHsv,hsvToHex,saturationValueAt} from './colorPicker';
it.each(['#ffffff','#000000','#ff0000','#00ff00','#0000ff','#3f76e4','#808080','#123456'])('roundtrips picker color %s',hex=>{
 expect(hsvToHex(hexToHsv(hex))).toBe(hex);
});
it('clamps pointer drags and maps top right to a vivid color',()=>{
 expect(saturationValueAt(200,-20,100,100)).toEqual({s:1,v:1});
 expect(saturationValueAt(-20,200,100,100)).toEqual({s:0,v:0});
 expect(hsvToHex({h:120,...saturationValueAt(100,0,100,100)})).toBe('#00ff00');
});
