"""Real fire crops only: whole-video train/calibration/test with ImageNet initialization.

No sprite atlas, synthetic fire renderer, temporal input or synthetic checkpoint.
Only ordinary flip/brightness/noise augmentation of the actual recorded RGB crops.
"""
import argparse
import collections
import hashlib
import json
from pathlib import Path
import sys
import time
import numpy as np
import torch
from torch import nn
from torch.nn import functional as F
from torchvision.models import resnet18

ROOT=Path(__file__).resolve().parents[5]
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'large'))
from models import make_model as larger_model
BASE=ROOT/'.board/row32-real'

def model_for(name,pretrained):
    if name!='resnet18':return larger_model(name,pretrained,ROOT/'.board/row32-large')
    model=resnet18(weights=None)
    if pretrained:model.load_state_dict(torch.load(ROOT/'.board/row32/torch/checkpoints/resnet18-f37072fd.pth',map_location='cpu',weights_only=True))
    model.conv1.stride=(1,1);model.maxpool=nn.Identity();model.avgpool=nn.AdaptiveAvgPool2d((2,2));model.fc=nn.Linear(2048,32)
    return model

def normalize(x):
    return (x-x.new_tensor([.485,.456,.406])[None,:,None,None])/x.new_tensor([.229,.224,.225])[None,:,None,None]

def augment(x):
    x=torch.where(torch.rand(len(x),1,1,1,device=x.device)<.5,x.flip(3),x)
    x=(x*(.85+.3*torch.rand(len(x),1,1,1,device=x.device))).clamp(0,1)
    return (x+torch.randn_like(x)*1.5/255).clamp(0,1)

@torch.inference_mode()
def predict(model,x,device):
    model.eval()
    return torch.cat([model(normalize(part.to(device))).float().cpu() for part in x.split(32)])

def metrics(logits,y):
    order=logits.argsort(1,descending=True);correct=order[:,0]==y
    return dict(n=len(y),correct=int(correct.sum()),accuracy=float(correct.float().mean()),top3=int((order[:,:3]==y[:,None]).any(1).sum()),loss=float(F.cross_entropy(logits,y)),macro_recall=float(torch.stack([correct[y==c].float().mean() for c in y.unique()]).mean()))

def validate_splits(rows):
    sets={s:{r['video'] for r in rows if r['split']==s} for s in ['train','calibration','test']}
    if any(not v for v in sets.values()):raise ValueError('Every split needs at least one recording')
    if any(sets[a]&sets[b] for a,b in [('train','calibration'),('train','test'),('calibration','test')]):raise ValueError('Recording crosses split')
    if any(not 0<=r['phase']<32 for r in rows):raise ValueError('Invalid animation phase')

def main(args):
    torch.set_num_threads(4);torch.manual_seed(219);np.random.seed(219)
    device=torch.device('cuda' if torch.cuda.is_available() else 'cpu');out=BASE/args.architecture;out.mkdir(exist_ok=True)
    metadata=json.loads((BASE/'manifest.json').read_text());rows=metadata['samples'];validate_splits(rows)
    data=np.load(BASE/'real.npz');split=data['split'];ids={s:np.flatnonzero(split==s) for s in ['train','calibration','test']}
    # Test RGB is not put through the network until checkpoint selection completes.
    tx=torch.from_numpy(data['x'][ids['train']].transpose(0,3,1,2).copy()).to(device).float()/255
    ty=torch.tensor(data['y'][ids['train']],device=device,dtype=torch.long)
    cx=torch.from_numpy(data['x'][ids['calibration']].transpose(0,3,1,2).copy()).float()/255;cy=torch.tensor(data['y'][ids['calibration']],dtype=torch.long)
    frames=collections.Counter((rows[i]['video'],rows[i]['frame']) for i in ids['train']);phases=collections.Counter(rows[i]['phase'] for i in ids['train'])
    weights=torch.tensor([1/(frames[(rows[i]['video'],rows[i]['frame'])]*np.sqrt(phases[rows[i]['phase']])) for i in ids['train']],device=device)
    model=model_for(args.architecture,True).to(device);optimizer=torch.optim.AdamW(model.parameters(),lr=.0002,weight_decay=.02);schedule=torch.optim.lr_scheduler.CosineAnnealingLR(optimizer,args.epochs);scaler=torch.amp.GradScaler('cuda',enabled=device.type=='cuda')
    best=float('inf');history=[];start=time.perf_counter()
    config=dict(architecture=args.architecture,epochs=args.epochs,steps=args.steps,batch=64,microbatch=32,seed=219,device=str(device),parameters=sum(p.numel() for p in model.parameters()),training='real recorded RGB only',initialization='generic ImageNet; no fire-trained checkpoint',dataset_sha256=metadata['dataset_sha256'],splits=metadata['splits'])
    (out/'config.json').write_text(json.dumps(config,indent=2));print(json.dumps(config),flush=True)
    for epoch in range(args.epochs):
        model.train();total=0
        for step in range(args.steps):
            indices=torch.multinomial(weights,64,replacement=True);xx=augment(tx[indices]);yy=ty[indices];optimizer.zero_grad(set_to_none=True)
            for j in range(0,64,32):
                with torch.autocast(device_type=device.type,enabled=device.type=='cuda'):
                    loss=F.cross_entropy(model(normalize(xx[j:j+32])),yy[j:j+32],label_smoothing=.03)/2
                if not torch.isfinite(loss):raise ValueError('Nonfinite loss')
                scaler.scale(loss).backward();total+=float(loss.detach())
            scaler.step(optimizer);scaler.update()
        schedule.step();cal=metrics(predict(model,cx,device),cy);record=dict(epoch=epoch+1,loss=total/args.steps,calibration=cal,seconds=round(time.perf_counter()-start,2));history.append(record);print(json.dumps(record),flush=True)
        if cal['loss']<best:
            best=cal['loss'];torch.save(dict(state_dict=model.cpu().state_dict(),epoch=epoch+1,config=config),out/'best.pt');model.to(device)
        (out/'history.json').write_text(json.dumps(history,indent=2))
    checkpoint=torch.load(out/'best.pt',map_location=device,weights_only=True);model.load_state_dict(checkpoint['state_dict']);cal_logits=predict(model,cx,device)
    ex=torch.from_numpy(data['x'][ids['test']].transpose(0,3,1,2).copy()).float()/255;ey=torch.tensor(data['y'][ids['test']],dtype=torch.long);test_logits=predict(model,ex,device)
    result=dict(config=config,chosen_epoch=checkpoint['epoch'],calibration=metrics(cal_logits,cy),test=metrics(test_logits,ey),groups={})
    for source in sorted({rows[i]['source'] for i in ids['test']}):
        ix=[j for j,i in enumerate(ids['test']) if rows[i]['source']==source];result['groups'][source]=metrics(test_logits[ix],ey[ix])
    np.savez_compressed(out/'predictions.npz',indices=ids['test'],logits=test_logits.numpy(),truth=ey.numpy(),calibration_indices=ids['calibration'],calibration_logits=cal_logits.numpy())
    # Paired historical control, still from the wholly held-out quad1 recording.
    old_rows=json.loads((ROOT/'.board/row32/selected.json').read_text());old=np.load(ROOT/'.board/row32/real.npz')
    old_ids=[i for i,r in enumerate(old_rows) if r['kind']=='orange' and r['split']=='validation']
    ox=torch.from_numpy(old['x'][old_ids].transpose(0,3,1,2).copy()).float()/255;oy=torch.tensor(old['y'][old_ids],dtype=torch.long)
    old_logits=predict(model,ox,device);result['historical_99']=metrics(old_logits,oy);result['historical_99']['deterministic_correct']=sum(old_rows[i]['phase']==old_rows[i]['baselinePhase'] for i in old_ids)
    np.savez_compressed(out/'historical-predictions.npz',indices=old_ids,logits=old_logits.numpy(),truth=oy.numpy())
    result['seconds']=time.perf_counter()-start;result['source_hashes']={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [Path(__file__),Path(__file__).with_name('prepare.py'),Path(__file__).with_name('inventory.py'),Path(__file__).with_name('select.mjs'),Path(__file__).parents[1]/'large/models.py']}
    (out/'results.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('architecture',choices=['resnet18','resnet101','vit_b16']);parser.add_argument('--epochs',type=int,default=12);parser.add_argument('--steps',type=int,default=32);main(parser.parse_args())
