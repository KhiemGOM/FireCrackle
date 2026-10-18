import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {WaterTintControl} from './WaterTintControl';
it('offers a color picker, editable hex field and neutral reset',()=>{
 const html=renderToStaticMarkup(createElement(WaterTintControl,{color:'#3f76e4',onChange:()=>{}}));
 expect(html).toContain('Pick water color');expect(html).not.toContain('type="color"');expect(html).toContain('Water color hex');expect(html).toContain('value="#3f76e4"');expect(html).toContain('Untint');expect(html).toContain('Pick water color from image');
});
