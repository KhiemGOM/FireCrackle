"""Separate real-only soul model; calibration-only stopping and checkpoint selection."""
import json,sys,time
from pathlib import Path
import numpy as np
import torch
from torch.nn import functional as F
ROOT=Path(__file__).resolve().parents[5];OUT=ROOT/'.board/soul-phase128'
sys.path.insert(0,str(Path(__file__).parents[1]/'real'))
from train import model_for,normalize,augment,predict,metrics
sys.path.insert(0,str(Path(__file__).parents[1]/'resolution'))
from checkpointing import enable

@torch.inference_mode()
def benchmark(model,probe):
 for _ in range(5):model(normalize(probe))
 torch.cuda.synchronize();timing=[]
 for _ in range(30):
  start=time.perf_counter();model(normalize(probe));torch.cuda.synchronize();timing.append((time.perf_counter()-start)*1000)
 return dict(median=float(np.median(timing)),p95=float(np.percentile(timing,95)))

def main():
 torch.set_num_threads(4);torch.manual_seed(219);np.random.seed(219)
 if not torch.cuda.is_available():raise RuntimeError('Approved GPU run requires CUDA')
 torch.cuda.set_per_process_memory_fraction(.62);device=torch.device('cuda')
 meta=json.loads((OUT/'manifest.json').read_text());plan=json.loads((OUT/'plan.json').read_text());rows=meta['samples'];data=np.load(OUT/'real.npz')
 ids={s:np.flatnonzero(data['split']==s) for s in ['train','calibration','test']}
 assert [len(ids[s]) for s in ids]==[2350,178,2098]
 assert {rows[i]['video'] for i in ids['train']}=={'new_soul12'}
 assert {rows[i]['video'] for i in ids['calibration']}=={'older_soul'}
 tx=torch.from_numpy(data['x'][ids['train']].transpose(0,3,1,2).copy()).to(device).float()/255;ty=torch.tensor(data['y'][ids['train']],device=device,dtype=torch.long)
 cx=torch.from_numpy(data['x'][ids['calibration']].transpose(0,3,1,2).copy()).float()/255;cy=torch.tensor(data['y'][ids['calibration']],dtype=torch.long)
 import collections
 frames=collections.Counter(rows[i]['frame'] for i in ids['train']);phases=collections.Counter(rows[i]['phase'] for i in ids['train'])
 weights=torch.tensor([1/(frames[rows[i]['frame']]*np.sqrt(phases[rows[i]['phase']])) for i in ids['train']],device=device)
 model=enable(model_for('resnet101',True)).to(device);optimizer=torch.optim.AdamW(model.parameters(),lr=.0002,weight_decay=.02)
 schedule=torch.optim.lr_scheduler.CosineAnnealingLR(optimizer,plan['max_epochs']);scaler=torch.amp.GradScaler('cuda');best=float('inf');stale=0;history=[];started=time.perf_counter()
 print(json.dumps(dict(stage='training_started',device=torch.cuda.get_device_name(),plan=plan)),flush=True)
 for epoch in range(plan['max_epochs']):
  model.train();total=0
  for step in range(plan['steps']):
   index=torch.multinomial(weights,64,replacement=True);xx=augment(tx[index]);yy=ty[index];optimizer.zero_grad(set_to_none=True)
   for j in range(0,64,32):
    with torch.autocast(device_type='cuda'):
     loss=F.cross_entropy(model(normalize(xx[j:j+32])),yy[j:j+32],label_smoothing=.03)/2
    if not torch.isfinite(loss):raise RuntimeError('Nonfinite training loss')
    scaler.scale(loss).backward();total+=float(loss.detach())
   scaler.step(optimizer);scaler.update()
  schedule.step();cal=metrics(predict(model,cx,device),cy)
  improved=cal['loss']<best
  if improved:
   best=cal['loss'];stale=0;torch.save(dict(state_dict={k:v.detach().cpu().clone() for k,v in model.state_dict().items()},epoch=epoch+1,plan=plan,dataset_sha256=meta['dataset_sha256']),OUT/'best.pt')
  else:stale+=1
  record=dict(epoch=epoch+1,train_loss=total/plan['steps'],calibration=cal,improved=improved,stale=stale,seconds=round(time.perf_counter()-started,2));history.append(record)
  (OUT/'history.json').write_text(json.dumps(history,indent=2));print(json.dumps(record),flush=True)
  if (epoch+1>=plan['min_epochs'] and stale>=plan['patience']) or (OUT/'STOP').exists():break
 chosen=torch.load(OUT/'best.pt',map_location=device,weights_only=True);model.load_state_dict(chosen['state_dict']);print(json.dumps(dict(stage='checkpoint_frozen',chosen_epoch=chosen['epoch'])),flush=True)
 # First test inference occurs only after calibration checkpoint selection is final.
 ex=torch.from_numpy(data['x'][ids['test']].transpose(0,3,1,2).copy()).float()/255;ey=torch.tensor(data['y'][ids['test']],dtype=torch.long)
 logits=predict(model,ex,device);cl=predict(model,cx,device)
 np.savez_compressed(OUT/'predictions.npz',indices=ids['test'],logits=logits.numpy(),truth=ey.numpy(),calibration_indices=ids['calibration'],calibration_logits=cl.numpy())
 result=dict(chosen_epoch=chosen['epoch'],completed_epochs=len(history),calibration=metrics(cl,cy),test=metrics(logits,ey),recordings={})
 for video in ['older_soul','soul_holdout']:
  ii=[j for j,i in enumerate(ids['test']) if rows[i]['video']==video];result['recordings'][video]=metrics(logits[ii],ey[ii])
 model.eval();probe=ex[:1].to(device)
 result.update(seconds=time.perf_counter()-started,inference_ms=benchmark(model,probe),gpu_peak_allocated_mb=torch.cuda.max_memory_allocated()/1048576,dataset_sha256=meta['dataset_sha256'])
 (OUT/'cnn-results.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)
if __name__=='__main__':main()
