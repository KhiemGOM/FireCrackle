/** `sealed`: both neighbouring frames are scanned, so the range can no longer change (absent = treat as sealed). */
export interface GuiRange {first:number;last:number;menu:boolean;sealed?:boolean}
export interface GuiScanStatus {
  video_path:string;
  state:'ready'|'running'|'paused'|'done'|'error';
  processed:number;total:number;detected:number;
  ranges:GuiRange[];error:string|null;
}
