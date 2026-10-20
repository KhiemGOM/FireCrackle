export interface GuiRange {first:number;last:number;menu:boolean}
export interface GuiScanStatus {
  video_path:string;
  state:'ready'|'running'|'paused'|'done'|'error';
  processed:number;total:number;detected:number;
  ranges:GuiRange[];error:string|null;
}
