"""Extract real no-fire background crops. No real fire pixels/targets are used.

clip1 is training; clip2 is held-out synthetic validation backgrounds. Neither
survival nor quad1 contributes any training background or foreground.
"""
import argparse,hashlib,json,subprocess
from pathlib import Path
import numpy as np
from PIL import Image
from prepare_survival_train import balanced_select
from render import ROOT,contact_sheet

SOURCES=[('train','clip1','2026-10-15 14-48-36.mkv'),('val','clip2','2026-10-15 18-18-16.mkv')]


def safe_frames(rows,stride=120,guard=60):
    good=np.array([bool(r.get('tick_ok')) and r.get('label') is not None and r['label'].get('fire') is False and not r['label'].get('fires') for r in rows])
    bad=np.r_[0,np.cumsum(~good)]
    return [n for n in range(guard,len(rows)-guard,stride) if bad[n+guard+1]==bad[n-guard]]


def main():
    ap=argparse.ArgumentParser();ap.add_argument('out',type=Path);ap.add_argument('--ffmpeg',type=Path,required=True);args=ap.parse_args()
    args.out.mkdir(parents=True,exist_ok=True);manifest={'guard_frames':60,'stride':120,'patches_per_frame':12,'sources':{}}
    for split,name,video_name in SOURCES:
        joined=ROOT/f'fire-detection/data/joined/{name}.jsonl';rows=[json.loads(line) for line in joined.open(encoding='utf8')]
        assert all(r['n']==i for i,r in enumerate(rows))
        selected=safe_frames(rows)
        if len(selected)>256:selected=[selected[i] for i in np.linspace(0,len(selected)-1,256,dtype=int)]
        if not selected:raise ValueError('No safely labelled no-fire frames')
        video=ROOT/'fire-detection/data/video'/video_name;probe=args.ffmpeg.with_name('ffprobe.exe' if args.ffmpeg.suffix=='.exe' else 'ffprobe')
        stream=json.loads(subprocess.check_output([str(probe),'-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','json',str(video)]))['streams'][0];w,h=stream['width'],stream['height']
        command=[str(args.ffmpeg),'-v','error','-i',str(video),'-vf',f"select='{balanced_select(selected)}'",'-frames:v',str(len(selected)),'-fps_mode','passthrough','-pix_fmt','rgb24','-f','rawvideo','pipe:1']
        proc=subprocess.Popen(command,stdout=subprocess.PIPE);patches=[];meta=[];thumbnails=[]
        for n in selected:
            buf=bytearray()
            while len(buf)<w*h*3:
                chunk=proc.stdout.read(w*h*3-len(buf))
                if not chunk:raise RuntimeError(f'Truncated {name} frame{n}')
                buf.extend(chunk)
            im=np.frombuffer(buf,np.uint8).reshape(h,w,3);thumbnails.append(np.asarray(Image.fromarray(im).resize((256,144))))
            rng=np.random.default_rng(8000000+n+(0 if split=='train' else 1000000))
            for _ in range(12):
                edge=int(rng.integers(160,min(480,int(h*.52))+1));x=int(rng.integers(int(w*.04),int(w*.96)-edge));y=int(rng.integers(int(h*.1),int(h*.7)-edge+1))
                crop=np.asarray(Image.fromarray(im[y:y+edge,x:x+edge]).resize((160,160),Image.Resampling.BILINEAR))
                if crop.std()<8 or crop.mean()<12:continue
                patches.append(crop);meta.append(dict(frame=n,box=[x,y,edge,edge],sha256=hashlib.sha256(crop.tobytes()).hexdigest()))
        proc.stdout.close()
        if proc.wait()!=0:raise RuntimeError('FFmpeg failed')
        np.savez_compressed(args.out/f'{split}.npz',x=np.stack(patches))
        contact_sheet(patches[::max(1,len(patches)//64)][:64],[f'{split} background']*64,args.out/f'patches-{split}.png')
        # Full-frame previews preserve aspect ratio and show rejected fire/HUD
        # leakage during visual inspection; these are evidence, never model input.
        canvas=Image.new('RGB',(8*256,((len(thumbnails)+7)//8)*166));from PIL import ImageDraw
        draw=ImageDraw.Draw(canvas)
        for i,(im,n) in enumerate(zip(thumbnails,selected)):
            x,y=i%8*256,i//8*166;canvas.paste(Image.fromarray(im),(x,y));draw.text((x+2,y+145),str(n),fill='white')
        canvas.save(args.out/f'frames-{split}.png')
        manifest['sources'][split]=dict(name=name,video=video_name,joined_sha256=hashlib.sha256(joined.read_bytes()).hexdigest(),width=w,height=h,frames=selected,patches=meta,command=command)
        print(json.dumps(dict(split=split,frames=len(selected),patches=len(patches))),flush=True)
    # An exact crop duplicated across recordings is forbidden across the split.
    a={p['sha256'] for p in manifest['sources']['train']['patches']};b={p['sha256'] for p in manifest['sources']['val']['patches']}
    if a&b:raise ValueError('Exact background crop leakage across splits')
    (args.out/'manifest.json').write_text(json.dumps(manifest,indent=2))


if __name__=='__main__':main()
