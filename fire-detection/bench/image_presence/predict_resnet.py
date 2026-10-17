"""Run frozen ResNet image inference, returning only a review candidate."""
import argparse,json
from pathlib import Path
import numpy as np
from PIL import Image
import torch
from crop_v2 import load_base
from resnet_bench import ResNetBag

def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('run',type=Path);ap.add_argument('image',type=Path)
    ap.add_argument('--data-root',type=Path,required=True);args=ap.parse_args()
    base=load_base(Path(__file__).with_name('pipeline.py'),args.data_root.resolve());torch.set_num_threads(4)
    cal=json.loads((args.run/'calibration.json').read_text())
    if cal['weights_sha256']!=base.sha(args.run/'best.pt'):raise ValueError('Calibration/weight mismatch')
    device=torch.device('cuda' if torch.cuda.is_available() else 'cpu');cp=torch.load(args.run/'best.pt',map_location=device,weights_only=False)
    for name,expected in cp['protocol']['preprocessing_sha256'].items():
        if base.sha(base.ROOT/'fire-detection/core/src'/name)!=expected:raise ValueError('Preprocessing changed')
    model=ResNetBag(cp['architecture'],False).to(device).eval();model.load_state_dict(cp['state'])
    rgb=np.asarray(Image.open(args.image).convert('RGB').resize((1920,1080)))
    fixed,used,_=base.unveil(rgb,y0=12);guard=base.translucency_guard(rgb)
    arr=np.concatenate([base.views(rgb),base.views(fixed)]) if used else base.views(rgb)
    with torch.inference_mode():score=float(model(base.tensor_views(arr,device)).max().cpu())
    print(json.dumps({'model':cp['architecture'],'score':score,'threshold':cal['threshold'],
        'decision':'candidate_no_fire' if score<cal['threshold'] and not guard['abstain'] else 'review',
        'guard':guard,'experimental':True,'requires_manual_review':True,'can_auto_confirm':False,
        'scope':'Original model/purple-guard only; shared GUI/material/weak-menu gates evaluated separately'}))

if __name__=='__main__':main()
