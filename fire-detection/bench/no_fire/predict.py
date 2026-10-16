"""Video-only offline no-fire candidates. Never writes application labels."""
import argparse,json,subprocess
from pathlib import Path
import numpy as np
from features import features
from model import predict

def main():
 ap=argparse.ArgumentParser();ap.add_argument('model',type=Path);ap.add_argument('video',type=Path);ap.add_argument('--stride',type=int,default=30);ap.add_argument('--limit',type=int);ap.add_argument('--ffmpeg',type=Path,required=True);args=ap.parse_args()
 if args.stride<1:ap.error('stride must be positive')
 if args.limit is not None and args.limit<1:ap.error('limit must be positive')
 model=json.loads(args.model.read_text());
 if len(model['mean']) not in (115,232):ap.error('This CLI accepts frame-statistic models only; clustering variants are offline ablations')
 probe=args.ffmpeg.with_name('ffprobe'+args.ffmpeg.suffix)
 stream=json.loads(subprocess.check_output([str(probe),'-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','json',str(args.video)]))['streams'][0];w,h=stream['width'],stream['height']
 proc=subprocess.Popen([str(args.ffmpeg),'-v','error','-threads','2','-i',str(args.video),'-vf',f'select=not(mod(n\\,{args.stride}))','-fps_mode','passthrough','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],stdout=subprocess.PIPE)
 n=0;emitted=0;natural=False
 try:
  while True:
   raw=bytearray()
   while len(raw)<w*h*3:
    part=proc.stdout.read(w*h*3-len(raw))
    if not part:break
    raw.extend(part)
   if not raw:natural=True;break
   if len(raw)!=w*h*3:raise RuntimeError('Truncated video frame')
   x,veiled=features(np.frombuffer(raw,np.uint8).reshape(h,w,3))
   # Raw-only ablation exports fewer inputs; production-candidate export includes both views.
   if len(model['mean'])<len(x):x=x[:len(model['mean'])]
   score=float(predict(model,x));print(json.dumps({'frame':n,'decision':'no_fire_candidate' if score<model['threshold'] else 'review','score':score,'threshold':model['threshold'],'veil_undone':veiled,'research_only':True}),flush=True);n+=args.stride;emitted+=1
   if args.limit is not None and emitted>=args.limit:break
 finally:
  proc.stdout.close()
  if not natural and proc.poll() is None:proc.terminate()
  code=proc.wait()
  if natural and code:raise RuntimeError(f'FFmpeg failed: exit {code}')
if __name__=='__main__':main()
