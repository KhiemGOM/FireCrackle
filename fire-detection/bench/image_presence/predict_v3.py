"""Image-only inference for the paired V3 experiment. Never changes labels."""
import argparse,json
from pathlib import Path
import numpy as np
from PIL import Image
import torch
from crop_v2 import load_base

def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('run',type=Path);ap.add_argument('image',type=Path)
    ap.add_argument('--data-root',type=Path,required=True);args=ap.parse_args()
    base=load_base(Path(__file__).with_name('pipeline.py'),args.data_root.resolve())
    calibration=json.loads((args.run/'calibration.json').read_text())
    if calibration['weights_sha256']!=base.sha(args.run/'best.pt'):raise ValueError('Calibration/weights mismatch')
    torch.set_num_threads(4);device=torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    checkpoint=torch.load(args.run/'best.pt',map_location=device,weights_only=False)
    for name,expected in checkpoint['protocol']['preprocessing_sha256'].items():
        if base.sha(base.ROOT/'fire-detection/core/src'/name)!=expected:raise ValueError('Preprocessing changed')
    model=base.make_model(pretrained=False).to(device).eval();model.load_state_dict(checkpoint['state'])
    rgb=np.asarray(Image.open(args.image).convert('RGB').resize((1920,1080)))
    auto,detected,_=base.unveil(rgb,y0=max(1,int(rgb.shape[0]*.012)));guard=base.translucency_guard(rgb)
    arrays=[base.views(rgb)]+([base.views(auto)] if detected else [])
    with torch.inference_mode():score=float(model(base.tensor_views(np.concatenate(arrays),device)).max().cpu())
    print(json.dumps({'decision':'candidate_no_fire' if score<calibration['threshold'] and not guard['abstain'] else 'review',
        'fire_logit':score,'threshold_logit':calibration['threshold'],'auto_unveil':detected,'guard':guard,
        'requires_manual_review':True,'can_auto_confirm':False,'experimental':True}))

if __name__=='__main__':main()
