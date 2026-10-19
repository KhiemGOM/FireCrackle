"""Recover calibration native frames, verifying unchanged crop/preprocess hashes."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time
import numpy as np

ROOT=Path(__file__).resolve().parents[5]
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'real'))
from prepare import expression,read_exact,rectify,unveil
OUT=ROOT/'.board/row32-hybrid'
def digest(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()

def main():
    start=time.perf_counter();OUT.mkdir(exist_ok=True)
    meta=json.loads((ROOT/'.board/row32-128/manifest.json').read_text())
    assert meta['preprocessing']=={f:digest(ROOT/'fire-detection/core/src'/f) for f in meta['preprocessing']}
    rows=[r for r in meta['samples'] if r['split']=='calibration'];assert len(rows)==157
    frames=sorted({r['frame'] for r in rows});assert len(frames)==53
    directory=OUT/'later';directory.mkdir(exist_ok=True)
    script=directory/'select.filter';script.write_text("select='"+expression(frames)+"'")
    w,h=rows[0]['width'],rows[0]['height']
    command=[str(ROOT/'FireCrackle/src-tauri/runtime/ffmpeg.exe'),'-v','error','-threads','2','-i',str(ROOT/'fire-detection/data/video'/rows[0]['video_file']),'-filter_script:v',str(script),'-frames:v',str(len(frames)),'-fps_mode','passthrough','-pix_fmt','rgb24','-f','rawvideo','pipe:1']
    checked=0
    with (directory/'decode.log').open('wb') as stderr:
        proc=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=stderr)
        try:
            for frame in frames:
                rgb=np.frombuffer(read_exact(proc.stdout,w*h*3),np.uint8).reshape(h,w,3)
                rgb,_,_=unveil(rgb)
                for row in [r for r in rows if r['frame']==frame]:
                    crop=rectify(rgb,np.array(row['quad'])*[w,h])
                    assert hashlib.sha256(crop.tobytes()).hexdigest()==row['reference64_crop_sha256'],row['id']
                    checked+=1
                rgb.tofile(directory/f'{frame}.rgb')
            proc.stdout.close();assert proc.wait()==0
        finally:
            if proc.poll() is None:proc.kill();proc.wait()
    result=dict(frames=len(frames),parity_crops=checked,seconds=time.perf_counter()-start,command=command,preprocessing=meta['preprocessing'])
    (OUT/'preparation.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)
if __name__=='__main__':main()
