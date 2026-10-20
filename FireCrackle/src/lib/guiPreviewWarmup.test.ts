import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {Backend} from './api';
import type {GuiScanStatus} from './guiScan';
import {watchGuiPreviewWarmup} from './guiPreviewWarmup';
import {previewFrames,clearGuiThumbnails} from './guiThumbnailCache';
import {guiMotionScores,previewPixelChange} from './guiAimReview';
import {withErrorReporting,getFailures,dismissFailure} from './appErrors';

vi.mock('./guiAimReview',async original=>({...await original<typeof import('./guiAimReview')>(),previewPixelChange:vi.fn(async()=>.25)}));
const ranges=[{first:2,last:4,menu:false},{first:10,last:12,menu:false},{first:20,last:22,menu:true}];
const status=(patch:Partial<GuiScanStatus>={}):GuiScanStatus=>({video_path:'clip.mkv',total:100,processed:100,detected:9,state:'done',ranges,error:null,...patch});
function fixture(value=status()){
  const guiScanStatus=vi.fn(async()=>value),previewThumbnail=vi.fn(async()=>new ArrayBuffer(8)),frame=vi.fn();
  return {backend:{guiScanStatus,previewThumbnail,frame} as unknown as Backend,guiScanStatus,previewThumbnail,frame};
}
beforeEach(()=>{
  vi.useFakeTimers();vi.mocked(previewPixelChange).mockClear();
  class Reader{result='data:image/jpeg;base64,preview';onload:(()=>void)|null=null;readAsDataURL(){this.onload?.();}}
  vi.stubGlobal('FileReader',Reader);
});
afterEach(()=>{getFailures().forEach(failure=>dismissFailure(failure.id));vi.useRealTimers();vi.unstubAllGlobals();});

it('warms completed scans without opening a gallery, including menu intervals, and reuses images and scores',async()=>{
  const f=fixture(),cache=previewFrames(f.backend,512),requests=vi.spyOn(cache,'get');
  const stop=watchGuiPreviewWarmup(f.backend,'clip.mkv',100);
  await vi.advanceTimersByTimeAsync(0);
  expect(f.previewThumbnail).toHaveBeenCalledTimes(6);
  expect(f.frame).not.toHaveBeenCalled();
  expect(requests.mock.calls.every(call=>call[2]==='background')).toBe(true);
  expect(guiMotionScores(cache)).toEqual(new Map([['2-4',.25],['10-12',.25],['20-22',.25]]));
  await cache.get(1);await cache.get(5);
  expect(f.previewThumbnail).toHaveBeenCalledTimes(6);
  await vi.advanceTimersByTimeAsync(10000);expect(f.guiScanStatus).toHaveBeenCalledTimes(1);
  stop();
});
it('waits for a fully completed scan and does not compete with running or paused scans',async()=>{
  const f=fixture(status({state:'running',processed:40}));
  const stop=watchGuiPreviewWarmup(f.backend,'clip.mkv',100);
  await vi.advanceTimersByTimeAsync(0);expect(f.previewThumbnail).not.toHaveBeenCalled();
  f.guiScanStatus.mockResolvedValue(status({state:'paused',processed:40}));
  await vi.advanceTimersByTimeAsync(1000);expect(f.previewThumbnail).not.toHaveBeenCalled();
  f.guiScanStatus.mockResolvedValue(status());
  await vi.advanceTimersByTimeAsync(5000);expect(f.previewThumbnail).toHaveBeenCalledTimes(6);
  stop();
});
it('shares one watcher across subscribers and stops queued work after the last subscriber leaves',async()=>{
  const f=fixture();const finish:Array<(bytes:ArrayBuffer)=>void>=[];
  f.previewThumbnail.mockImplementation(()=>new Promise(resolve=>finish.push(resolve)));
  const a=watchGuiPreviewWarmup(f.backend,'clip.mkv',100),b=watchGuiPreviewWarmup(f.backend,'clip.mkv',100);
  await vi.advanceTimersByTimeAsync(0);expect(f.guiScanStatus).toHaveBeenCalledTimes(1);expect(f.previewThumbnail).toHaveBeenCalledTimes(2);
  a();b();finish.forEach(done=>done(new ArrayBuffer(8)));await vi.advanceTimersByTimeAsync(0);
  expect(f.previewThumbnail).toHaveBeenCalledTimes(2);expect(previewPixelChange).not.toHaveBeenCalled();
});
it('ignores stale video results and stops polling after cancellation',async()=>{
  const f=fixture(status({video_path:'other.mkv'})),stop=watchGuiPreviewWarmup(f.backend,'clip.mkv',100);
  await vi.advanceTimersByTimeAsync(0);expect(f.previewThumbnail).not.toHaveBeenCalled();
  stop();await vi.advanceTimersByTimeAsync(10000);expect(f.guiScanStatus).toHaveBeenCalledTimes(1);
});
it('yields to other automatic scans and resumes preparation when they finish',async()=>{
  const f=fixture();let running=true;
  f.backend.povStatus=vi.fn(async()=>running?{state:'running'} as any:null);
  const stop=watchGuiPreviewWarmup(f.backend,'clip.mkv',100);
  await vi.advanceTimersByTimeAsync(0);expect(f.previewThumbnail).not.toHaveBeenCalled();
  running=false;await vi.advanceTimersByTimeAsync(1000);
  expect(f.previewThumbnail).toHaveBeenCalledTimes(6);stop();
});
it('isolates cached scores after reopening a video and retries failed speculative images on demand',async()=>{
  const f=fixture();f.previewThumbnail.mockRejectedValueOnce(Error('temporary decode failure'));
  const stop=watchGuiPreviewWarmup(f.backend,'clip.mkv',100);await vi.advanceTimersByTimeAsync(0);
  const cache=previewFrames(f.backend,512);expect(guiMotionScores(cache).has('2-4')).toBe(false);
  await cache.get(1);expect(f.previewThumbnail).toHaveBeenCalledTimes(7);
  clearGuiThumbnails(f.backend);expect(guiMotionScores(previewFrames(f.backend,512)).size).toBe(0);
  stop();
});
it('never starts expensive full-frame fallback work for backends without preview support',async()=>{
  const f=fixture();delete f.backend.previewThumbnail;
  const stop=watchGuiPreviewWarmup(f.backend,'clip.mkv',100);await vi.advanceTimersByTimeAsync(0);
  expect(f.guiScanStatus).not.toHaveBeenCalled();expect(f.frame).not.toHaveBeenCalled();stop();
});
it('does not interrupt foreground work with speculative error dialogs but preserves explicit operation errors',async()=>{
  const f=fixture(),backend=withErrorReporting(f.backend);
  f.previewThumbnail.mockRejectedValue(Error('speculative preview failure'));
  const stop=watchGuiPreviewWarmup(backend,'clip.mkv',100);await vi.advanceTimersByTimeAsync(0);
  expect(getFailures()).toHaveLength(0);
  await expect(backend.previewThumbnail!(1,512)).rejects.toThrow('speculative preview failure');
  expect(getFailures()).toHaveLength(1);stop();
});
