"""Re-extract exactly the approved real64 cohorts at128 from native full frames.

Never enlarge the64px crops. Reuse only source-hash-matched native full RGB.
"""
import collections
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import time
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[5]
OLD=ROOT/'.board/row32-real';OUT=ROOT/'.board/row32-128'
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'real'))
from inventory import digest
spec=importlib.util.spec_from_file_location('real_prepare',Path(__file__).resolve().parents[1]/'real/prepare.py')
old_prepare=importlib.util.module_from_spec(spec);spec.loader.exec_module(old_prepare)
from render import rectify
from veil_native import apply as unveil

def main():
    OUT.mkdir(exist_ok=True);old=json.loads((OLD/'manifest.json').read_text());rows=old['samples']
    current={f:digest(ROOT/'fire-detection/core/src'/f) for f in old['preprocessing']}
    if current!=old['preprocessing']:raise ValueError('Shared preprocessing changed: cannot isolate resolution')
    xs={};meta={};start=time.perf_counter()
    for video in sorted({r['video'] for r in rows}):
        selected=[r for r in rows if r['video']==video];byframe=collections.defaultdict(list)
        for r in selected:byframe[r['frame']].append(r)
        frames=sorted(byframe);directory=OUT/video;directory.mkdir(exist_ok=True);w,h=selected[0]['width'],selected[0]['height'];proc=None;stderr=None
        if video not in ('ownership','quad1'):
            script=directory/'select.filter';script.write_text("select='"+old_prepare.expression(frames)+"'")
            command=[str(ROOT/'FireCrackle/src-tauri/runtime/ffmpeg.exe'),'-v','error','-threads','2','-i',str(ROOT/'fire-detection/data/video'/selected[0]['video_file']),'-filter_script:v',str(script),'-frames:v',str(len(frames)),'-fps_mode','passthrough','-pix_fmt','rgb24','-f','rawvideo','pipe:1']
            stderr=(directory/'decode.log').open('wb');proc=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=stderr)
        try:
            for i,frame in enumerate(frames):
                cases=byframe[frame]
                if video=='quad1':
                    rgb=np.fromfile(OLD/video/f'{frame}.rgb',np.uint8).reshape(h,w,3);applied=cases[0]['unveil_applied'];share=cases[0]['veil_share']
                else:
                    if video=='ownership':
                        path=Path(cases[0]['source_rgb'])
                        if digest(path)!=cases[0]['source_rgb_sha256']:raise ValueError('Native sidecar hash mismatch')
                        with Image.open(path) as im:rgb=np.array(im.convert('RGB'))
                    else:rgb=np.frombuffer(old_prepare.read_exact(proc.stdout,w*h*3),np.uint8).reshape(h,w,3)
                    rgb,applied,share=unveil(rgb)
                for r in cases:
                    q=np.array(r['quad'])*[w,h]
                    # Pixel-level parity at64 proves native frame/preprocessing alignment.
                    if hashlib.sha256(rectify(rgb,q).tobytes()).hexdigest()!=r['crop_sha256']:raise ValueError('64px source parity failed: '+r['id'])
                    crop=rectify(rgb,q,size=128);xs[r['id']]=crop;meta[r['id']]={**r,'reference64_crop_sha256':r['crop_sha256'],'crop_sha256':hashlib.sha256(crop.tobytes()).hexdigest(),'input_size':128}
                if i%100==0:print(json.dumps(dict(video=video,decoded=i+1,frames=len(frames),crops=len(xs),seconds=round(time.perf_counter()-start))),flush=True)
            if proc:
                proc.stdout.close()
                if proc.wait()!=0:raise RuntimeError((directory/'decode.log').read_text())
        finally:
            if proc and proc.poll() is None:proc.kill();proc.wait()
            if stderr:stderr.close()
    ordered=[meta[r['id']] for r in rows]
    np.savez_compressed(OUT/'real.npz',x=np.stack([xs[r['id']] for r in rows]),y=np.array([r['phase'] for r in rows]),split=np.array([r['split'] for r in rows]),video=np.array([r['video'] for r in rows]))
    manifest={**old,'samples':ordered,'input_size':128,'reference64_dataset_sha256':old['dataset_sha256'],'dataset_sha256':digest(OUT/'real.npz'),'seconds':time.perf_counter()-start,'native64_pixel_parity_checked':len(rows)}
    (OUT/'manifest.json').write_text(json.dumps(manifest,indent=2))
    print(json.dumps(dict(done=True,crops=len(rows),shape=[len(rows),128,128,3],seconds=manifest['seconds'])),flush=True)

if __name__=='__main__':main()
