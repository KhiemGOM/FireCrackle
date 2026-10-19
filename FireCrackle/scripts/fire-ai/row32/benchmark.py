"""Warm batch1: decoded native RGB -> rectification -> phase probabilities."""
import argparse,json,sys,time
from pathlib import Path
import numpy as np
import torch
from model import make_model,normalize
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from render import rectify

def main(out,checkpoint=None):
    torch.set_num_threads(4);row=json.loads((out/'selected.json').read_text())[0]
    rgb=np.fromfile(Path(row['dir'])/f"{row['frame']}.rgb",np.uint8).reshape(row['height'],row['width'],3);q=np.array(row['quad'])*[row['width'],row['height']]
    model=make_model();model.load_state_dict(torch.load(checkpoint or out/'orange.pt',weights_only=True,map_location='cpu')['state_dict']);model.eval();results={}
    for device in ['cpu']+(['cuda'] if torch.cuda.is_available() else []):
        model.to(device);timings=[]
        with torch.inference_mode():
            for i in range(120):
                if device=='cuda':torch.cuda.synchronize()
                start=time.perf_counter();crop=rectify(rgb,q);x=torch.from_numpy(crop.transpose(2,0,1).copy()).unsqueeze(0).to(device).float()/255
                prob=model(normalize(x)).softmax(1).cpu()
                if device=='cuda':torch.cuda.synchronize()
                if i>=20:timings.append((time.perf_counter()-start)*1000)
        results[device]=dict(median_ms=float(np.median(timings)),p95_ms=float(np.percentile(timings,95)),cpu_threads=4)
    target=checkpoint.parent/'timing.json' if checkpoint else out/'end-to-end-timing.json'
    target.write_text(json.dumps(results,indent=2));print(json.dumps(results,indent=2))

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('directory',type=Path);ap.add_argument('--checkpoint',type=Path);a=ap.parse_args();main(a.directory,a.checkpoint)
