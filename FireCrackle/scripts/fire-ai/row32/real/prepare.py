"""Decode real video RGB at native resolution; shared unveil, then quad rectify."""
import collections
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time
import numpy as np
from PIL import Image
from inventory import digest

ROOT=Path(__file__).resolve().parents[5]
sys.path.insert(0,str(ROOT/'FireCrackle/scripts/fire-ai'))
sys.path.insert(0,str(ROOT/'fire-detection/bench/no_fire'))
from render import rectify
from veil_native import apply as unveil
OUT=ROOT/'.board/row32-real'

def expression(frames):
    if len(frames)==1:return f'eq(n\\,{frames[0]})'
    middle=len(frames)//2
    return f'({expression(frames[:middle])}+{expression(frames[middle:])})'

def read_exact(stream,size):
    data=bytearray()
    while len(data)<size:
        chunk=stream.read(size-len(data))
        if not chunk:raise RuntimeError('Truncated native RGB frame')
        data.extend(chunk)
    return data

def main():
    selected=json.loads((OUT/'selected.json').read_text());all_rows=[];all_x=[];start=time.perf_counter()
    preprocessing={f:digest(ROOT/'fire-detection/core/src'/f) for f in ['veil.rs','veil_abi.rs','portal.rs']}
    previous=json.loads((OUT/'manifest.json').read_text()) if (OUT/'manifest.json').exists() else {}
    for video in sorted({r['video'] for r in selected}):
        rows=[r for r in selected if r['video']==video];byframe=collections.defaultdict(list)
        for row in rows:byframe[row['frame']].append(row)
        frames=sorted(byframe);w,h=rows[0]['width'],rows[0]['height'];directory=OUT/video;directory.mkdir(exist_ok=True)
        if previous.get('preprocessing')==preprocessing and (directory/'manifest.json').exists():
            cached=json.loads((directory/'manifest.json').read_text())['samples']
            # Only reuse identical selected metadata under the same shared-preprocess hash.
            if len(cached)==len(rows) and all(all(c.get(k)==v for k,v in r.items()) for c,r in zip(cached,rows)):
                xx=np.load(directory/'crops.npz')['x']
                if len(xx)!=len(cached) or any(hashlib.sha256(x.tobytes()).hexdigest()!=r['crop_sha256'] for x,r in zip(xx,cached)):raise ValueError('Cached crop checksum mismatch')
                all_rows.extend(cached);all_x.extend(xx);print(json.dumps(dict(video=video,reused=len(cached))),flush=True);continue
        proc=None;command=None;stderr=None
        if video!='ownership':
            script=directory/'select.filter';script.write_text("select='"+expression(frames)+"'")
            command=[str(ROOT/'FireCrackle/src-tauri/runtime/ffmpeg.exe'),'-v','error','-threads','2','-i',str(ROOT/'fire-detection/data/video'/rows[0]['video_file']),'-filter_script:v',str(script),'-frames:v',str(len(frames)),'-fps_mode','passthrough','-pix_fmt','rgb24','-f','rawvideo','pipe:1']
            stderr=(directory/'decode.log').open('wb');proc=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=stderr)
        xs=[];metadata=[]
        try:
            for i,frame in enumerate(frames):
                cases=byframe[frame]
                if proc is None:
                    path=Path(cases[0]['source_rgb'])
                    if digest(path)!=cases[0]['source_rgb_sha256']:raise ValueError('Ownership RGB hash mismatch')
                    with Image.open(path) as im:rgb=np.array(im.convert('RGB'))
                else:rgb=np.frombuffer(read_exact(proc.stdout,w*h*3),np.uint8).reshape(h,w,3)
                rgb,applied,share=unveil(rgb)
                if video=='quad1':rgb.tofile(directory/f'{frame}.rgb')
                for row in cases:
                    crop=rectify(rgb,np.array(row['quad'])*[w,h])
                    xs.append(crop);metadata.append({**row,'unveil_applied':bool(applied),'veil_share':float(share),'crop_sha256':hashlib.sha256(crop.tobytes()).hexdigest()})
                if i%100==0:print(json.dumps(dict(video=video,decoded=i+1,frames=len(frames),crops=len(xs),seconds=round(time.perf_counter()-start))),flush=True)
            if proc:
                proc.stdout.close()
                if proc.wait()!=0:raise RuntimeError((directory/'decode.log').read_text())
        finally:
            if proc and proc.poll() is None:proc.kill();proc.wait()
            if stderr:stderr.close()
        np.savez_compressed(directory/'crops.npz',x=np.stack(xs),y=np.array([r['phase'] for r in metadata]))
        (directory/'manifest.json').write_text(json.dumps(dict(samples=metadata,command=command),indent=2))
        all_rows.extend(metadata);all_x.extend(xs)
    # Remove exact-pixel duplicates within each split; conflicting labels abort.
    hashes=collections.defaultdict(set)
    for row in all_rows:hashes[row['crop_sha256']].add(row['phase'])
    conflicts={h for h,y in hashes.items() if len(y)>1}
    seen={};kept=[];rejects=collections.Counter()
    for i,row in enumerate(all_rows):
        h=row['crop_sha256']
        if h in conflicts:rejects['conflicting_identical_crop']+=1;continue
        if h in seen:
            if seen[h]!=row['split']:raise ValueError('Identical pixels cross whole-video splits')
            rejects['duplicate_identical_crop']+=1;continue
        seen[h]=row['split'];kept.append(i)
    rows=[all_rows[i] for i in kept]
    np.savez_compressed(OUT/'real.npz',x=np.stack([all_x[i] for i in kept]),y=np.array([r['phase'] for r in rows]),split=np.array([r['split'] for r in rows]),video=np.array([r['video'] for r in rows]))
    summary={s:dict(crops=sum(r['split']==s for r in rows),videos=sorted({r['video'] for r in rows if r['split']==s}),frames=len({(r['video'],r['frame']) for r in rows if r['split']==s}),phases=sorted({r['phase'] for r in rows if r['split']==s})) for s in ['train','calibration','test']}
    if preprocessing!={f:digest(ROOT/'fire-detection/core/src'/f) for f in preprocessing}:raise ValueError('Shared preprocessing changed during decode')
    (OUT/'manifest.json').write_text(json.dumps(dict(samples=rows,splits=summary,rejects=dict(rejects),preprocessing=preprocessing,dataset_sha256=digest(OUT/'real.npz'),seconds=time.perf_counter()-start),indent=2))
    print(json.dumps(dict(done=True,splits=summary,rejects=dict(rejects))),flush=True)

if __name__=='__main__':main()
