"""Decode fixed-stride full frames and join independent recorded truth for offline scoring."""
import argparse,hashlib,json,subprocess,time
from pathlib import Path
import numpy as np
from PIL import Image
from features import features
ROOT=Path(__file__).resolve().parents[3]
SOURCES={'clip1':'2026-10-15 14-48-36.mkv','clip2':'2026-10-15 18-18-16.mkv','quad1':'2026-10-16 00-40-22.mkv','survival1':'2026-10-16 18-23-42.mkv'}

def main():
 ap=argparse.ArgumentParser();ap.add_argument('out',type=Path);ap.add_argument('--stride',type=int,default=30);ap.add_argument('--sources',nargs='+',default=list(SOURCES));args=ap.parse_args();args.out.mkdir(parents=True,exist_ok=True)
 ffmpeg=ROOT/'FireCrackle/src-tauri/runtime/ffmpeg.exe';probe=ffmpeg.with_name('ffprobe.exe')
 for name in args.sources:
  video=ROOT/'fire-detection/data/video'/SOURCES[name];joined=ROOT/'fire-detection/data/joined'/f'{name}.jsonl'
  metadata={}
  for line in joined.open(encoding='utf8'):
   r=json.loads(line);lab=r.get('label');n=r['n']
   if n%args.stride or not r.get('tick_ok') or not isinstance(lab,dict) or not isinstance(lab.get('fire'),bool):continue
   fires=lab.get('fires',[])
   if bool(fires)!=lab['fire']:continue
   area=sum(max(0,f['box'][2]-f['box'][0])*max(0,f['box'][3]-f['box'][1])*max(0,f.get('vis',0)) for f in fires if f.get('box'))/(lab['w']*lab['h'])
   metadata[n]=(int(lab['fire']),area,int(any(f.get('veil',0)>=.6 for f in fires)))
  stream=json.loads(subprocess.check_output([str(probe),'-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','json',str(video)]))['streams'][0];w,h=stream['width'],stream['height']
  command=[str(ffmpeg),'-v','error','-threads','2','-i',str(video),'-vf',f'select=not(mod(n\\,{args.stride}))','-fps_mode','passthrough','-pix_fmt','rgb24','-f','rawvideo','pipe:1']
  proc=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE);rows=[];thumbs=[];frames=[];truth=[];start=time.time();n=0
  while True:
   raw=bytearray()
   while len(raw)<w*h*3:
    chunk=proc.stdout.read(w*h*3-len(raw))
    if not chunk:break
    raw.extend(chunk)
   if not raw:break
   if len(raw)!=w*h*3:raise RuntimeError('Truncated decoded frame')
   if n in metadata:
    rgb=np.frombuffer(raw,np.uint8).reshape(h,w,3);x,detected=features(rgb);rows.append(x);frames.append(n);truth.append([*metadata[n],int(detected)]);thumbs.append(np.asarray(Image.fromarray(rgb).resize((256,144))))
   n+=args.stride
   if len(rows) and len(rows)%200==0:print(json.dumps({'source':name,'frames':len(rows),'seconds':round(time.time()-start)}),flush=True)
  err=proc.stderr.read().decode(errors='replace');proc.stdout.close()
  if proc.wait()!=0:raise RuntimeError(err)
  if metadata and max(metadata)>=n:raise ValueError(f'{name}: video ended before joined labels; wrong recording or truncation')
  np.savez_compressed(args.out/f'{name}.npz',x=np.stack(rows),frames=frames,truth=truth,thumbs=np.stack(thumbs))
  manifest={'source':name,'stride':args.stride,'video':video.name,'width':w,'height':h,'frames':len(rows),'truth_sha256':hashlib.sha256(joined.read_bytes()).hexdigest(),'feature_sha256':hashlib.sha256(Path(__file__).with_name('features.py').read_bytes()).hexdigest(),'command':command,'seconds':time.time()-start}
  (args.out/f'{name}.json').write_text(json.dumps(manifest,indent=2));print(json.dumps(manifest),flush=True)
if __name__=='__main__':main()
