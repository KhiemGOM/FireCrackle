"""Single-crop CPU timing of the selected checkpoint; no fitting or accuracy selection."""
import json,sys,time
from pathlib import Path
import numpy as np
import torch
ROOT=Path(__file__).resolve().parents[5];OUT=ROOT/'.board/soul-phase128'
sys.path.insert(0,str(Path(__file__).parents[1]/'real'))
from train import model_for,normalize

@torch.inference_mode()
def main():
 torch.set_num_threads(4);started=time.perf_counter();model=model_for('resnet101',False)
 saved=torch.load(OUT/'best.pt',map_location='cpu',weights_only=True);model.load_state_dict(saved['state_dict']);model.eval()
 load=time.perf_counter()-started;data=np.load(OUT/'real.npz');i=np.flatnonzero(data['split']=='calibration')[0];x=torch.from_numpy(data['x'][i:i+1].transpose(0,3,1,2).copy()).float()/255
 for _ in range(3):model(normalize(x))
 timings=[]
 for _ in range(15):
  start=time.perf_counter();model(normalize(x));timings.append((time.perf_counter()-start)*1000)
 result=dict(backend='PyTorch float32,4CPUthreads; single128crop, normalization plus network only',load_seconds=load,median_ms=float(np.median(timings)),p95_ms=float(np.percentile(timings,95)),runs=len(timings))
 (OUT/'cpu-speed.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
if __name__=='__main__':main()
