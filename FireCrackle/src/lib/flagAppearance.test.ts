import {it,expect,vi} from 'vitest';
import {FLAG_COLORS,paintTimelineFlags} from './flagAppearance';
import type {Flag} from './api';
it('uses a separate violet report track and keeps a subpixel hard jump red and visible',()=>{
 const flags:Flag[]=[{frame:5,end_frame:5,kind:'phase_shift',severity:'hard',phase_delta:28},{frame:0,end_frame:100,kind:'jolt_report',severity:'jolt',phase_delta:30}];
 const paints:Array<{color:unknown;rect:number[]}>=[];
 const context={fillStyle:'',fillRect:vi.fn((...rect:number[])=>paints.push({color:context.fillStyle,rect}))};
 paintTimelineFlags(context,flags,f=>f*.05,40);
 expect(paints).toEqual([{color:FLAG_COLORS.jolt.color,rect:[0,48,5.050000000000001,4]},{color:FLAG_COLORS.hard.color,rect:[.25,40,4,7]}]);
 expect(FLAG_COLORS.jolt.color).not.toBe(FLAG_COLORS.hard.color);
});
