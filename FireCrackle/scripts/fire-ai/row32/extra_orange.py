"""Independent normal-fire model adaptation on an existing third recording.

Training crops were historically template-quality screened; this is disclosed
supervision selection, not proof of ownership. Test crops are never filtered.
"""
import argparse,json,time
from pathlib import Path
from collections import Counter
import numpy as np
import torch
from torch.nn import functional as F
from model import make_model,normalize
from train import predict,metrics,calibrate,augment
from synthetic import PhaseRenderer

def main(a):
    out=a.directory/'separate/orange-extra';out.mkdir(exist_ok=True);torch.set_num_threads(4);torch.manual_seed(215);np.random.seed(215);device=torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    manifest=json.loads((a.extra/'manifest.json').read_text());eligible={r['id'] for r in json.loads((a.directory/'extra-eligible.json').read_text())};extra={}
    for split in ['train','val']:
        rows=[r for r in manifest['samples'] if r['split']==split];d=np.load(a.extra/f'{split}.npz');assert len(rows)==len(d['y']);indices=[i for i,r in enumerate(rows) if r['id'] in eligible]
        labels=d['y'][indices];sheet=labels//64;row=(labels//2)%32;phase=(row+np.where(sheet==0,16,0))%32
        extra[split]=(torch.from_numpy(d['x'][indices].transpose(0,3,1,2).copy()).float()/255,torch.tensor(phase,dtype=torch.long),[rows[i] for i in indices])
    tx,ty,tr=extra['train'];cx,cy,cr=extra['val'];assert max(r['frame'] for r in tr)+240<min(r['frame'] for r in cr)
    tx=tx.to(device);ty=ty.to(device);counts=Counter(r['frame'] for r in tr);weights=torch.tensor([1/counts[r['frame']] for r in tr],device=device)
    data=np.load(a.directory/'real.npz');rows=json.loads((a.directory/'selected.json').read_text());ids=[i for i,r in enumerate(rows) if r['kind']=='orange' and r['split']=='validation'];ex=torch.from_numpy(data['x'][ids].transpose(0,3,1,2).copy()).float()/255;ey=torch.tensor(data['y'][ids],dtype=torch.long)
    renderer=PhaseRenderer(np.load(a.backgrounds/'train.npz')['x'],np.load(a.directory/'sprites.npy'),device,'orange');model=make_model().to(device);model.load_state_dict(torch.load(a.directory/'separate/orange/synthetic.pt',weights_only=True,map_location=device)['state_dict']);optimizer=torch.optim.AdamW(model.parameters(),lr=.00005,weight_decay=.02);scaler=torch.amp.GradScaler('cuda',enabled=device.type=='cuda')
    best=metrics(predict(model,cx,device),cy)['loss'];chosen=0;torch.save(dict(state_dict=model.cpu().state_dict(),epoch=0),out/'best.pt');model.to(device);history=[];start=time.perf_counter()
    for epoch in range(12):
        model.train()
        for module in model.modules():
            if isinstance(module,torch.nn.BatchNorm2d):module.eval()
        for step in range(12):
            pick=torch.multinomial(weights,64,replacement=True);sx,sy=renderer.batch(64,3000000+epoch*12+step);xx=torch.cat([augment(tx[pick]),sx.clone()]);yy=torch.cat([ty[pick],sy.clone()]);optimizer.zero_grad(set_to_none=True)
            with torch.autocast(device_type=device.type,enabled=device.type=='cuda'):loss=F.cross_entropy(model(normalize(xx)),yy,label_smoothing=.03)
            scaler.scale(loss).backward();scaler.step(optimizer);scaler.update()
        m=metrics(predict(model,cx,device),cy);record=dict(epoch=epoch+1,calibration=m,seconds=time.perf_counter()-start);history.append(record);print(json.dumps(record),flush=True)
        if m['loss']<best:best=m['loss'];chosen=epoch+1;torch.save(dict(state_dict=model.cpu().state_dict(),epoch=chosen),out/'best.pt');model.to(device)
    model.load_state_dict(torch.load(out/'best.pt',weights_only=True,map_location=device)['state_dict']);cal=predict(model,cx,device);threshold=calibrate(cal,cy,[r['frame'] for r in cr]);logits=predict(model,ex,device);report=dict(kind='orange',source=str(a.extra),train=dict(n=len(tr),frames=len(counts),sources=dict(Counter(r['source'] for r in tr))),calibration=dict(n=len(cr),frames=len({r['frame'] for r in cr})),chosen_epoch=chosen,test=metrics(logits,ey,threshold),deterministic_correct=sum(rows[i]['baselinePhase']==rows[i]['phase'] for i in ids),seconds=time.perf_counter()-start)
    report['groups']={src:dict(cnn=metrics(logits[[j for j,i in enumerate(ids) if rows[i]['source']==src]],ey[[j for j,i in enumerate(ids) if rows[i]['source']==src]],threshold),deterministic_correct=sum(rows[i]['baselinePhase']==rows[i]['phase'] for i in ids if rows[i]['source']==src)) for src in ['block','entity']}
    (out/'results.json').write_text(json.dumps(report,indent=2));(out/'history.json').write_text(json.dumps(history,indent=2));np.savez_compressed(out/'predictions.npz',indices=ids,logits=logits.numpy(),truth=ey.numpy());print(json.dumps(report),flush=True)

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('directory',type=Path);ap.add_argument('--extra',type=Path,required=True);ap.add_argument('--backgrounds',type=Path,required=True);main(ap.parse_args())
