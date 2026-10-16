import type { Flag, Severity } from './api';

export const FLAG_COLORS:Record<Severity,{color:string;fill:string}>={
  hard:{color:'#ff4d4f',fill:'rgba(255,77,79,0.28)'},
  soft:{color:'#f5c542',fill:'rgba(245,197,66,0.22)'},
  jolt:{color:'#bd8bff',fill:'rgba(189,139,255,0.22)'},
};

/** Separate report and fire tracks; draw narrow fire events last so broad report
 * intervals cannot hide them, including at fully zoomed-out scales.
 */
export function paintTimelineFlags(g:Pick<CanvasRenderingContext2D,'fillStyle'|'fillRect'>,flags:Flag[],x:(frame:number)=>number,y:number):void {
  for(const category of ['jolt','soft','hard'] as const){
    for(const flag of flags){
      if(flag.severity!==category)continue;
      const start=x(flag.frame),end=x(flag.end_frame+1);
      if(!Number.isFinite(start)||!Number.isFinite(end))continue;
      g.fillStyle=FLAG_COLORS[category].color;
      g.fillRect(start,y+(category==='jolt'?8:0),Math.max(4,end-start),category==='jolt'?4:7);
    }
  }
}
