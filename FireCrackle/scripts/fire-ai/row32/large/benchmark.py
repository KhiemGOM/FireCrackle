"""Warm native-frame -> quad ->32 phase probabilities, batch1 CPU/GPU."""
import argparse,json,sys,time
from pathlib import Path
import numpy as np
import torch
from models import make_model
sys.path.append(str(Path(__file__).resolve().parents[1]))
from model import normalize
sys.path.append(str(Path(__file__).resolve().parents[2]))
from render import rectify

def main(a):
    torch.set_num_threads(4);row=json.loads((a.data/'selected.json').read_text())[0];image=np.fromfile(Path(row['dir'])/f"{row['frame']}.rgb",np.uint8).reshape(row['height'],row['width'],3);quad=np.array(row['quad'])*[row['width'],row['height']];model=make_model(a.architecture);model.load_state_dict(torch.load(a.checkpoint,weights_only=True,map_location='cpu')['state_dict']);model.eval();results={}
    for device in ['cpu']+(['cuda'] if torch.cuda.is_available() else []):
        model.to(device);durations=[]
        with torch.inference_mode():
            for step in range(120):
                if device=='cuda':torch.cuda.synchronize()
                start=time.perf_counter();crop=rectify(image,quad);x=torch.from_numpy(crop.transpose(2,0,1).copy()).unsqueeze(0).to(device).float()/255;model(normalize(x)).softmax(1).cpu()
                if device=='cuda':torch.cuda.synchronize()
                if step>=20:durations.append((time.perf_counter()-start)*1000)
        results[device]=dict(median_ms=float(np.median(durations)),p95_ms=float(np.percentile(durations,95)),cpu_threads=4)
    (a.checkpoint.parent/'timing.json').write_text(json.dumps(results,indent=2));print(json.dumps(dict(architecture=a.architecture,checkpoint=str(a.checkpoint),timing=results),indent=2))

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('architecture',choices=['resnet101','vit_b16']);ap.add_argument('checkpoint',type=Path);ap.add_argument('--data',type=Path,default=Path('.board/row32'));main(ap.parse_args())
