"""Image-only inference for the reviewed-crop v2 pilot; never auto-confirms labels."""
import argparse
import json
from pathlib import Path
import numpy as np
from PIL import Image
import torch
from crop_v2 import load_base,scan_views,chunk_logits


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('run',type=Path);ap.add_argument('image',type=Path)
    ap.add_argument('--data-root',type=Path,default=Path(__file__).resolve().parents[3])
    ap.add_argument('--baseline-source',type=Path,default=Path(__file__).with_name('pipeline.py'))
    args=ap.parse_args();base=load_base(args.baseline_source,args.data_root)
    calibration=json.loads((args.run/'calibration.json').read_text())
    if calibration['weights_sha256']!=base.sha(args.run/'best.pt'):raise ValueError('Weight/calibration mismatch')
    device=torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    checkpoint=torch.load(args.run/'best.pt',map_location=device,weights_only=False)
    for name,expected in checkpoint['protocol']['preprocessing_sha256'].items():
        if base.sha(args.data_root/'fire-detection/core/src'/name)!=expected:raise ValueError('Changed preprocessing: recalibration required')
    model=base.make_model(pretrained=False).to(device).eval();model.load_state_dict(checkpoint['state'])
    rgb=np.asarray(Image.open(args.image).convert('RGB').resize((1920,1080)))
    auto,detected,_=base.unveil(rgb,y0=12);arr=scan_views(rgb)
    if detected:arr=np.concatenate([arr,scan_views(auto)])
    score=float(chunk_logits(model,arr,base,device).max());guard=base.translucency_guard(rgb)
    candidate=bool(base.decisions([score],calibration['threshold'],[guard['abstain']])[0])
    print(json.dumps({'decision':'candidate_no_fire' if candidate else 'review','fire_logit':score,
        'threshold_logit':calibration['threshold'],'guard':guard,'requires_manual_review':True,
        'can_auto_confirm':False},indent=2))


if __name__=='__main__':main()
