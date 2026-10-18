import {waterColor} from './waterTint';
export interface Hsv {h:number;s:number;v:number}
const unit=(n:number)=>Math.max(0,Math.min(1,n));
export function hexToHsv(hex:string):Hsv {
 const color=waterColor(hex);if(!color)throw new Error('Invalid color');
 const n=parseInt(color.slice(1),16),r=(n>>>16)/255,g=((n>>>8)&255)/255,b=(n&255)/255;
 const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
 const h=d===0?0:max===r?60*(((g-b)/d+6)%6):max===g?60*((b-r)/d+2):60*((r-g)/d+4);
 return {h,s:max===0?0:d/max,v:max};
}
export function hsvToHex({h,s,v}:Hsv):string {
 h=((h%360)+360)%360;s=unit(s);v=unit(v);
 const c=v*s,x=c*(1-Math.abs((h/60)%2-1)),m=v-c;
 const rgb=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
 return '#'+rgb.map(n=>Math.round((n+m)*255).toString(16).padStart(2,'0')).join('');
}
export function saturationValueAt(x:number,y:number,width:number,height:number){
 return {s:unit(x/Math.max(1,width)),v:1-unit(y/Math.max(1,height))};
}
