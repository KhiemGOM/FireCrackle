"""Conservative abstaining pilot: clip1 fit/development, clip2 calibration, other recordings locked tests."""
import argparse,hashlib,json
from pathlib import Path
import numpy as np
import torch
from torch import nn
from PIL import Image,ImageDraw
from model import export_model,predict

def threshold_zero_false_clear(scores,fire):
 scores=np.asarray(scores,dtype=float);fire=np.asarray(fire,dtype=bool)
 if not np.isfinite(scores).all():raise ValueError('Non-finite calibration scores cannot establish absence')
 if not fire.any():raise ValueError('Calibration requires fire examples')
 # Strict < means ties with the lowest-scoring fire remain review, too.
 return float(np.min(np.asarray(scores)[fire]))

def metrics(scores,truth,threshold):
 fire=truth[:,0].astype(bool);clear=scores<threshold
 def group(mask):
  return {'frames':int(mask.sum()),'cleared':int((clear&mask).sum())}
 out={'frames':len(scores),'no_fire':int((~fire).sum()),'fire':int(fire.sum()),'cleared_no_fire':int((clear&~fire).sum()),'false_clear_fire':int((clear&fire).sum()),'threshold':threshold}
 out['no_fire_coverage']=out['cleared_no_fire']/max(1,out['no_fire']);out['false_clear_fire_rate']=out['false_clear_fire']/max(1,out['fire'])
 out['fire_groups']={'tiny_lt_0.1pct':group(fire&(truth[:,1]<.001)),'small_0.1_to_1pct':group(fire&(truth[:,1]>=.001)&(truth[:,1]<.01)),'large_ge_1pct':group(fire&(truth[:,1]>=.01)),'truth_veiled':group(fire&(truth[:,2]>0)),'detector_veiled':group(fire&(truth[:,3]>0))}
 return out

def fit(x,y):
 torch.manual_seed(321);torch.set_num_threads(2)
 split=int(len(x)*.7);guard=4
 train=x[:split-guard];labels=y[:split-guard];val=x[split+guard:];vy=y[split+guard:]
 mean=train.mean(0);scale=np.maximum(train.std(0),.01)
 tx=torch.tensor((train-mean)/scale);ty=torch.tensor(labels,dtype=torch.float32);vx=torch.tensor((val-mean)/scale);vyt=torch.tensor(vy,dtype=torch.float32)
 model=nn.Sequential(nn.Linear(x.shape[1],64),nn.ReLU(),nn.Dropout(.15),nn.Linear(64,1))
 opt=torch.optim.AdamW(model.parameters(),lr=.001,weight_decay=.01);weight=float((labels==0).sum()/max(1,(labels==1).sum()));lossfn=nn.BCEWithLogitsLoss(pos_weight=torch.tensor(weight))
 best=None;bestloss=float('inf');history=[]
 for epoch in range(160):
  model.train();order=torch.randperm(len(tx))
  for ids in order.split(128):
   opt.zero_grad();loss=lossfn(model(tx[ids]).flatten(),ty[ids]);loss.backward();opt.step()
  model.eval()
  with torch.no_grad():vl=float(lossfn(model(vx).flatten(),vyt))
  history.append(vl)
  if vl<bestloss:bestloss=vl;best={k:v.detach().clone() for k,v in model.state_dict().items()};bestepoch=epoch
 model.load_state_dict(best);model.eval()
 return model,mean,scale,{'epochs':160,'best_epoch':bestepoch,'validation_loss':bestloss,'fit_frames':split-guard,'development_frames':len(val),'guard_samples':8}

def score(model,mean,scale,x):
 with torch.no_grad():return torch.sigmoid(model(torch.tensor((x-mean)/scale)).flatten()).numpy()

def main():
 ap=argparse.ArgumentParser();ap.add_argument('data',type=Path);args=ap.parse_args();data={n:np.load(args.data/f'{n}.npz') for n in ['clip1','clip2','quad1','survival1']};report={'scope':'ANY visible fire, including tiny/occluded/world/overlay; predictions are frame-local','split':{'fit_development':'clip1 temporal 70/30 with 8-sample guard','calibration':'clip2','tests':['quad1','survival1']},'stride':30,'models':{}}
 for variant in ['raw_only','raw_plus_auto_unveil']:
  dims=(data['clip1']['x'].shape[1]-2)//2
  select=lambda d:d['x'][:,:dims] if variant=='raw_only' else d['x']
  model,mean,scale,training=fit(select(data['clip1']),data['clip1']['truth'][:,0])
  portable=export_model(model,mean,scale,0,args.data/f'{variant}.json')
  # Calibrate the exact portable inference used by predict.py, including ties.
  scores={n:predict(portable,select(d)) for n,d in data.items()}
  np.testing.assert_allclose(scores['clip2'],score(model,mean,scale,select(data['clip2'])),atol=2e-6,rtol=1e-4)
  threshold=threshold_zero_false_clear(scores['clip2'],data['clip2']['truth'][:,0])
  portable['threshold']=threshold;(args.data/f'{variant}.json').write_text(json.dumps(portable))
  frozen=args.data/f'{variant}-frozen-before-test.json'
  if frozen.exists():
   original=json.loads(frozen.read_text())
   for k in ['w1','b1','w2','b2','mean','scale']:np.testing.assert_array_equal(portable[k],original[k])
  modelpath=args.data/f'{variant}.pt';torch.save({'state_dict':model.state_dict(),'mean':mean,'scale':scale,'threshold':threshold,'training':training},modelpath)
  result={'training':training,'weights_sha256':hashlib.sha256(modelpath.read_bytes()).hexdigest(),'operating_point':'strictly below lowest fire score on calibration; scores are not calibrated probabilities','datasets':{}}
  for n,d in data.items():
   result['datasets'][n]=metrics(scores[n],d['truth'],threshold);np.save(args.data/f'{variant}-{n}-scores.npy',scores[n]);bad=np.flatnonzero((scores[n]<threshold)&(d['truth'][:,0]>0));chosen=bad[:48]
   if len(chosen):
    canvas=Image.new('RGB',(4*256,((len(chosen)+3)//4)*166));draw=ImageDraw.Draw(canvas)
    for j,i in enumerate(chosen):
     x,y=j%4*256,j//4*166;canvas.paste(Image.fromarray(d['thumbs'][i]),(x,y));draw.text((x+2,y+145),f"frame {d['frames'][i]} score {scores[n][i]:.4f}",fill='white')
    canvas.save(args.data/f'{variant}-{n}-false-clears.png')
  report['models'][variant]=result
 (args.data/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
if __name__=='__main__':main()
