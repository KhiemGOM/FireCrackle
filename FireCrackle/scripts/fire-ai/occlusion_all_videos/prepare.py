"""Build one held-out native-pixel benchmark per quad-labelled video."""
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import torch
from PIL import Image

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[3]
sys.path.insert(0,str(HERE.parent/'occlusion_recorded'))
sys.path.insert(0,str(HERE.parent/'occlusion'))
sys.path.insert(0,str(HERE.parent))
sys.path.insert(0,str(ROOT/'fire-detection/bench/no_fire'))
from experiment import load,input_tensor,crop_native
from gpu_render import homography,projected
from veil_native import apply as unveil

OUT=ROOT/'.board/occlusion-all-videos'
RECORDED=ROOT/'.board/occlusion-recorded'


def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def sources():
    old=json.loads((ROOT/'.board/occlusion-mask/survival/freeze.json').read_text())
    used=[int(s.split('-')[0]) for s in old['real_train_ids']+old['real_selection_ids']]
    data={};coverage=[]
    directory=ROOT/'FireCrackle/src-tauri/target/actual-quad1'
    m=json.loads((directory/'manifest.json').read_text())
    data['quad1']=[{**r,'native':str(directory)} for r in m['samples'] if r['split']=='validation']
    rows={}
    for directory in [ROOT/'.board/fire-ai/survival',ROOT/'.board/fire-ai/baseline-reviewed',ROOT/'.board/boundary-robust/additional']:
        m=json.loads((directory/'manifest.json').read_text());kept=[]
        for r in m['samples']:
            if r['split']!='validation' or any(abs(r['frame']-f)<=60 for f in used):continue
            if r['id'] in rows:
                assert rows[r['id']]['expected']==r['expected']
                continue
            rows[r['id']]={**r,'native':str(directory)};kept.append(r)
        coverage.append(dict(pool=str(directory),available=len(m['samples']),heldout_unique=len(kept)))
    data['survival1']=sorted(rows.values(),key=lambda r:(r['frame'],r['id']))
    m=json.loads((RECORDED/'manifest.json').read_text())
    data['new_recording']=[{**r,'session':m['session']} for r in m['samples'] if r['split']=='test']
    return data,coverage


def main():
    OUT.mkdir(exist_ok=True);torch.set_num_threads(4);device='cpu'
    model,checkpoint=load('finetune',device);data,coverage=sources()
    frozen=json.loads((ROOT/'.board/boundary-robust/frozen.json').read_text())
    protocol=dict(checkpoint_sha256=digest(checkpoint),selected_boundary=frozen['selected'],boundary_freeze_sha256=digest(ROOT/'.board/boundary-robust/frozen.json'),
                  methods=['colour','pairs4','facing1','facing4','jitter_max_pairs1','jitter_max_pairs4'],
                  after='same baseline with fixed learned-soft probabilities multiplying observation weights; no retraining or model selection',
                  datasets={k:len(v) for k,v in data.items()},survival_pools=coverage,
                  caveat='New recording uses partial renderer-supervised held-out sidecars. Older videos use frozen existing quad-case pools. Reviewed survival frames within60frames of original model train/selection are excluded.',
                  veil_sha256=digest(ROOT/'fire-detection/core/src/veil.rs'),script_sha256=digest(Path(__file__)))
    (OUT/'protocol.json').write_text(json.dumps(protocol,indent=2))
    for name,rows in data.items():
        native_dir=OUT/name/'native';native_dir.mkdir(parents=True,exist_ok=True)
        for mode in ['exact','rough']:
            dest=OUT/name/mode;dest.mkdir(exist_ok=True);packed=[];current=None
            for index,r in enumerate(rows):
                if current!=r['frame']:
                    current=r['frame']
                    if 'session' in r:
                        arr=np.array(Image.open(Path(r['session'])/f'frame-{current:08}-rgb.png').convert('RGB'))
                    else:
                        metadata=json.loads((Path(r['native'])/'manifest.json').read_text());w,h=metadata['width'],metadata['height']
                        arr=np.fromfile(Path(r['native'])/f'{current}.rgb',np.uint8).reshape(h,w,3)
                    arr,_,_=unveil(arr);h,w=arr.shape[:2]
                    if mode=='exact':(native_dir/f'{current}.rgb').write_bytes(np.ascontiguousarray(arr).tobytes())
                    native=torch.tensor(arr.transpose(2,0,1).copy()).float()[None]/255
                quad=torch.tensor(r['quad'],dtype=torch.float32)[None]
                if mode=='rough':
                    uv=torch.tensor([[(u-.5)*1.12+.5+.03+(i==1)*.02,(v-.5)*.92+.5-.02+(i==2)*.02] for i,(u,v) in enumerate([(0,0),(1,0),(1,1),(0,1)])])
                    quad=projected(homography(quad),uv)
                crop=crop_native(native,quad*torch.tensor([w,h])).clamp(0,1)
                with torch.inference_mode():p=model(input_tensor(crop)).sigmoid()[0,0].numpy()
                p.astype('<f4').tofile(dest/f'{index}.mask')
                packed.append(dict(id=r['id'],frame=current,quad=quad[0].tolist(),expected=r['expected'],source=r['source'] if 'source' in r else 'recorded_partial',mask_index=index))
            (dest/'manifest.json').write_text(json.dumps(dict(width=w,height=h,native_source=str(native_dir),samples=packed,mode=mode,video=name)))
            print(name,mode,len(packed),flush=True)


if __name__=='__main__':main()
