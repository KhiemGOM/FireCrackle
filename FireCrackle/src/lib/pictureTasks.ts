// The picture work that runs off the UI thread (picture.worker.ts): the same functions the app calls anywhere else,
// listed here once so the worker and the inline fallback (lib/pictureWorker.ts) run exactly the same code.
import {correctPicture,unveilPicture,type CorrectJob,type Mask} from './comparisonPost';
import type {ProcessedFrame} from './veilFrame';
import {motionChange} from './guiAimReview';
import {guessPicture} from './fireTool';
import type {Orientation} from './reversal';
import type {VeilOptions} from './veil';
import type {WorldCoverage} from './portalPreview';
import {matchPicture,type MatchPlane,type PlaneMatch} from './fire3dMatch';

export interface PictureTasks {
  /** The gallery's Auto unveil of one preview (lib/comparisonPost.ts unveilPicture). */
  unveil:{args:{bytes:ArrayBuffer;mask:Mask;veil:VeilOptions};result:{blob?:Blob;screen?:WorldCoverage}};
  /** The ranking's movement between two previews outside the open GUI (lib/guiAimReview.ts motionChange). */
  change:{args:{before:string;after:string;screens:(WorldCoverage|undefined)[]};result:number};
  /** A comparison frame's post effects on the native picture (lib/comparisonPost.ts correctPicture). */
  correct:{args:CorrectJob;result:ProcessedFrame&{guiProtected:boolean}};
  /** The 3D quad tool's automatic camera guess of a native frame (lib/fireTool.ts guessPicture). */
  orientation:{args:{bytes:ArrayBuffer};result:{width:number;height:number;guess:Orientation|null}};
  /** The 3D quad's Match: every plane of the fire on a native frame, one shared phase (lib/fire3dMatch.ts matchPicture). */
  match3d:{args:{bytes:ArrayBuffer;sheets:[Uint8ClampedArray,Uint8ClampedArray];planes:MatchPlane[]};result:PlaneMatch|null};
}
export type PictureTask=keyof PictureTasks;

export async function runPictureTask<K extends PictureTask>(task:K,args:PictureTasks[K]['args']):Promise<PictureTasks[K]['result']>{
  switch(task){
    case 'unveil':{const a=args as PictureTasks['unveil']['args'];return await unveilPicture(a) as PictureTasks[K]['result'];}
    case 'orientation':return await guessPicture((args as PictureTasks['orientation']['args']).bytes) as PictureTasks[K]['result'];
    case 'match3d':return await matchPicture(args as PictureTasks['match3d']['args']) as PictureTasks[K]['result'];
    case 'correct':return await correctPicture(args as CorrectJob) as PictureTasks[K]['result'];
    case 'change':{const a=args as PictureTasks['change']['args'];return await motionChange(a.before,a.after,a.screens) as PictureTasks[K]['result'];}
    default:throw Error(`Unknown picture task ${String(task)}`);
  }
}
