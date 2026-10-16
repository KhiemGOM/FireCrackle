export type AxisRange = [number,number];
/** Scale one axis around its centre without changing the other axis. */
export function zoomAxis(range:AxisRange,factor:number):AxisRange{
  if(!Number.isFinite(factor)||factor<=0)return range;
  const mid=(range[0]+range[1])/2,span=Math.max(.0001,Math.min(1e9,(range[1]-range[0])/factor));
  return [mid-span/2,mid+span/2];
}
