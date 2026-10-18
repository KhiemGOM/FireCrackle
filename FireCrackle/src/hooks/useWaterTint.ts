import {useEffect,useState} from 'react';
import {getWaterTint,renderWaterAtlases,setWaterTint,subscribeWaterTint,type WaterSpriteSheets} from '../lib/waterTint';

export function useWaterTint(enabled=true){
 const [color,setColor]=useState(getWaterTint());
 const [render,setRender]=useState<{color:string;sheets:WaterSpriteSheets}|null>(null);
 const [error,setError]=useState(false);
 useEffect(()=>subscribeWaterTint(()=>setColor(getWaterTint())),[]);
 useEffect(()=>{
  if(!enabled)return;let cancelled=false;setError(false);
  void renderWaterAtlases(color).then(sheets=>{if(!cancelled)setRender({color,sheets});}).catch(()=>{if(!cancelled)setError(true);});
  return()=>{cancelled=true;};
 },[color,enabled]);
 return {color,setColor:setWaterTint,sheets:render?.color===color?render.sheets:null,error};
}
