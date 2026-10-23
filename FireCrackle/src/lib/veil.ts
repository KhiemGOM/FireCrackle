// Thin binding to the SAME Rust implementation used by native tools and Python.
// Pixel rules live only in fire-detection/core/src/veil.rs.
import wasmUrl from "./veil.wasm?url";
import { settingValue, type SettingInfo } from "./api";
export { A_TOP, A_BOTTOM, COLOUR, MENU_ALPHA, DEFAULT_VEIL_OPTIONS } from "./veil.generated";
import { DEFAULT_VEIL_OPTIONS } from "./veil.generated";
import { failureMessage } from "./appErrors";
export type VeilMode = "off" | "auto" | "on";
export const VEIL_MODES: VeilMode[] = ["off", "auto", "on"];
/** How a menu (not an inventory) was veiled: "flat", the 1.16 gradient every screen draws; "blur", the 1.21+ menu
 * background (black at alpha 64 over the world, blurred unless the player turned blur off). The Enhance panel's choice. */
export type MenuVeil = "flat" | "blur";
export const MENU_VEILS: MenuVeil[] = ["flat", "blur"];
/** Which inverse veil.rs runs (VeilStyle): the flat gradient or the 1.21 menu background. */
export type VeilStyle = "flat" | "menu";
export interface VeilOptions { minShare: number; margin: number; slack: number; menu?: MenuVeil }
type Pixels = Uint8ClampedArray | Uint8Array;
export type VeilRuntime = { memory: WebAssembly.Memory; veil_alloc(n:number):number; veil_free(p:number,n:number):void;
  portal_fit(...args:number[]):number; portal_inverse(...args:number[]):number;
  veil_detect(...args:number[]):number; veil_detect_strict(...args:number[]):number; veil_inverse(...args:number[]):number; veil_inverse_style(...args:number[]):number; };
type Native = VeilRuntime;
let native: Native | undefined;
let pending: Promise<void> | undefined;
/** Shared ABI for the portal binding: no second inverse implementation. */
export function veilRuntime(): VeilRuntime { if(!native)throw Error("Shared veil runtime is not initialized");return native; }
/** Test/native-host initialization can supply bytes; browser fetches the built module once. */
export function initVeil(bytes?: BufferSource): Promise<void> {
  if (native) return Promise.resolve();
  if (!pending) pending=(async()=>{
    const data=bytes??await (await fetch(wasmUrl)).arrayBuffer();
    const result=await WebAssembly.instantiate(data,{});
    native=result.instance.exports as unknown as Native;
  })().catch(e=>{pending=undefined;throw e;});
  return pending;
}
export function veilOptionsFromSettings(settings: SettingInfo[]): VeilOptions {
  return { minShare:settingValue(settings,"label.veil_min_share",DEFAULT_VEIL_OPTIONS.minShare),
    margin:settingValue(settings,"label.veil_margin",DEFAULT_VEIL_OPTIONS.margin),
    slack:settingValue(settings,"label.veil_slack",DEFAULT_VEIL_OPTIONS.slack) };
}
function buffer<T>(rgba: Pixels,w:number,h:number,run:(n:Native,p:number)=>T):T {
  if (!native) throw new Error("Shared veil runtime is not initialized");
  if(!Number.isInteger(w)||!Number.isInteger(h)||w<=0||h<=0||rgba.length!==w*h*4) throw new Error("Invalid RGBA dimensions");
  const n=native,p=n.veil_alloc(rgba.length);
  try {new Uint8Array(n.memory.buffer,p,rgba.length).set(rgba);return run(n,p);} finally {n.veil_free(p,rgba.length);}
}
export function detectVeil(rgba:Pixels,w:number,h:number,o:VeilOptions=DEFAULT_VEIL_OPTIONS,y0=0):boolean {
  return buffer(rgba,w,h,(n,p)=>{const r=n.veil_detect(p,rgba.length,w,h,4,y0,o.minShare,o.margin,o.slack);
    if(r<0)throw new Error("Invalid veil settings/start row");return !!r;});
}
/** Historical strict-window primitive for regression/reference tests only. */
export function detectVeilStrict(rgba:Pixels,w:number,h:number,o:VeilOptions=DEFAULT_VEIL_OPTIONS,y0=0):boolean {
  return buffer(rgba,w,h,(n,p)=>{const r=n.veil_detect_strict(p,rgba.length,w,h,4,y0,o.minShare,o.margin,o.slack);
    if(r<0)throw new Error("Invalid veil settings/start row");return !!r;});
}
export function unveilRgba(rgba:Pixels,w:number,h:number,style:VeilStyle="flat"):Uint8ClampedArray {
  return buffer(rgba,w,h,(n,p)=>{if(n.veil_inverse_style(p,rgba.length,w,h,4,style==="menu"?1:0)<0)throw new Error("Invalid veil inverse");
    return new Uint8ClampedArray(new Uint8Array(n.memory.buffer,p,rgba.length));});
}
export interface VeilResult { data: Pixels; applied:boolean; error?:string; }
export function applyVeil(img:{data:Pixels;width:number;height:number},mode:VeilMode,options:VeilOptions,style:VeilStyle="flat"):VeilResult {
  if(mode==="off")return {data:img.data,applied:false};
  try {if(mode==="auto"&&!detectVeil(img.data,img.width,img.height,options))return {data:img.data,applied:false};
    return {data:unveilRgba(img.data,img.width,img.height,style),applied:true};
  } catch(e){return {data:img.data,applied:false,error:failureMessage(e)};}
}
