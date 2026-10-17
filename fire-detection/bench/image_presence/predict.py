"""Run a trained pilot on an image. Outputs a review candidate, never an app label."""
import argparse
import json
from pathlib import Path
import numpy as np
from PIL import Image
import torch
from pipeline import ROOT, make_model, views, tensor_views, unveil, translucency_guard, sha


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('run',type=Path);ap.add_argument('image',type=Path)
    args = ap.parse_args()
    calibration = json.loads((args.run/'calibration.json').read_text())
    if calibration['weights_sha256'] != sha(args.run/'best.pt'):
        raise ValueError('Calibration belongs to different weights')
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    checkpoint = torch.load(args.run/'best.pt',map_location=device,weights_only=False)
    for name,expected in checkpoint['protocol']['preprocessing_sha256'].items():
        if sha(ROOT/'fire-detection/core/src'/name) != expected:
            raise ValueError('Preprocessing changed: recalibrate before inference')
    model = make_model(pretrained=False).to(device).eval()
    model.load_state_dict(checkpoint['state'])
    rgb = np.asarray(Image.open(args.image).convert('RGB').resize((1920,1080)))
    auto,detected,_ = unveil(rgb,y0=max(1,int(rgb.shape[0]*.012)))
    guard = translucency_guard(rgb)
    arrays = [views(rgb)] + ([views(auto)] if detected else [])
    with torch.inference_mode(): score = float(model(tensor_views(np.concatenate(arrays),device)).max().cpu())
    candidate = score < calibration['threshold'] and not guard['abstain']
    print(json.dumps({'decision':'candidate_no_fire' if candidate else 'review',
        'fire_logit':score,'threshold_logit':calibration['threshold'],'auto_unveil':detected,
        'guard':guard,'requires_manual_review':True,'can_auto_confirm':False},indent=2))


if __name__=='__main__': main()
