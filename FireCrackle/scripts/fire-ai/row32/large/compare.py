"""Frozen-budget separate-colour capacity/type comparison. Test only after selection."""
import argparse,hashlib,json,sys,time
from pathlib import Path
from collections import Counter
import numpy as np
import torch
from torch.nn import functional as F
from models import make_model
sys.path.append(str(Path(__file__).resolve().parents[1]))
from model import normalize
from synthetic import PhaseRenderer
from train import metrics,calibrate,augment

@torch.inference_mode()
def predict(model,x,device):
    model.eval();return torch.cat([model(normalize(a.to(device))).float().cpu() for a in x.split(32)])

def real_data(base,extra,kind):
    data=np.load(base/'real.npz');rows=json.loads((base/'selected.json').read_text());test=[i for i,r in enumerate(rows) if r['kind']==kind and r['split']=='validation'];ex=torch.from_numpy(data['x'][test].transpose(0,3,1,2).copy()).float()/255;ey=torch.tensor(data['y'][test],dtype=torch.long)
    if kind=='soul':
        split=json.loads((base/'separate/soul/split.json').read_text());parts=[]
        for ids in [split['train_ids'],split['calibration_ids']]:parts.append((torch.from_numpy(data['x'][ids].transpose(0,3,1,2).copy()).float()/255,torch.tensor(data['y'][ids],dtype=torch.long),[rows[i] for i in ids]))
    else:
        metadata=json.loads((extra/'manifest.json').read_text());eligible={r['id'] for r in json.loads((base/'extra-eligible.json').read_text())};parts=[]
        for s in ['train','val']:
            all_rows=[r for r in metadata['samples'] if r['split']==s];d=np.load(extra/f'{s}.npz');ids=[i for i,r in enumerate(all_rows) if r['id'] in eligible];labels=d['y'][ids];phase=((labels//2)%32+np.where(labels//64==0,16,0))%32
            parts.append((torch.from_numpy(d['x'][ids].transpose(0,3,1,2).copy()).float()/255,torch.tensor(phase,dtype=torch.long),[all_rows[i] for i in ids]))
    assert max(r['frame'] for r in parts[0][2])+240<min(r['frame'] for r in parts[1][2])
    return parts,ex,ey,test,rows

def train(args):
    root=args.directory;out=root/args.architecture;out.mkdir(parents=True,exist_ok=True);torch.set_num_threads(4);device=torch.device('cuda' if torch.cuda.is_available() else 'cpu');sheets=np.load(args.data/'sprites.npy');results={};start=time.perf_counter()
    config={k:str(v) if isinstance(v,Path) else v for k,v in vars(args).items()};(out/'config.json').write_text(json.dumps(config,indent=2));print(json.dumps(config),flush=True)
    for kind,seed in [('orange',213),('soul',214)]:
        destination=out/kind;destination.mkdir(exist_ok=True);torch.manual_seed(seed);np.random.seed(seed)
        renderer=PhaseRenderer(np.load(args.backgrounds/'train.npz')['x'],sheets,device,kind);vr=PhaseRenderer(np.load(args.backgrounds/'val.npz')['x'],sheets,device,kind);samples=[vr.batch(128,900000+i) for i in range(8)];vx=torch.cat([x.cpu() for x,y in samples]);vy=torch.cat([y.cpu() for x,y in samples]);del samples,vr
        parts,ex,ey,test_ids,rows=real_data(args.data,args.extra,kind);tx,ty,tr=parts[0];cx,cy,cr=parts[1];counts=Counter(r['frame'] for r in tr);weights=torch.tensor([1/counts[r['frame']] for r in tr],device=device);tx,ty=tx.to(device),ty.to(device)
        model=make_model(args.architecture,True,root).to(device);parameters=sum(p.numel() for p in model.parameters());optimizer=torch.optim.AdamW(model.parameters(),lr=.0005,weight_decay=.01);scheduler=torch.optim.lr_scheduler.CosineAnnealingLR(optimizer,args.epochs);scaler=torch.amp.GradScaler('cuda',enabled=device.type=='cuda');best=float('inf');history=[]
        for epoch in range(args.epochs):
            model.train();total=0
            for step in range(args.steps):
                xx,yy=renderer.batch(128,100000+epoch*args.steps+step);xx,yy=xx.clone(),yy.clone();optimizer.zero_grad(set_to_none=True)
                for batch in range(0,128,args.microbatch):
                    with torch.autocast(device_type=device.type,enabled=device.type=='cuda'):loss=F.cross_entropy(model(normalize(xx[batch:batch+args.microbatch])),yy[batch:batch+args.microbatch],label_smoothing=.03)*(args.microbatch/128)
                    if not torch.isfinite(loss):raise ValueError('Nonfinite training loss')
                    scaler.scale(loss).backward();total+=float(loss.detach())
                scaler.step(optimizer);scaler.update()
            scheduler.step();m=metrics(predict(model,vx,device),vy);record=dict(architecture=args.architecture,colour=kind,stage='synthetic',epoch=epoch+1,loss=total/args.steps,validation=m,seconds=time.perf_counter()-start);history.append(record);print(json.dumps(record),flush=True)
            if m['loss']<best:best=m['loss'];torch.save(dict(state_dict=model.cpu().state_dict(),epoch=epoch+1),destination/'synthetic.pt');model.to(device)
            (destination/'history.json').write_text(json.dumps(history,indent=2))
        model.load_state_dict(torch.load(destination/'synthetic.pt',weights_only=True,map_location=device)['state_dict']);best=metrics(predict(model,cx,device),cy)['loss'];chosen=0;torch.save(dict(state_dict=model.cpu().state_dict(),epoch=0),destination/'best.pt');model.to(device);optimizer=torch.optim.AdamW(model.parameters(),lr=.00005,weight_decay=.02)
        for epoch in range(args.finetune_epochs):
            model.train()
            for module in model.modules():
                if isinstance(module,torch.nn.BatchNorm2d):module.eval()
            total=0
            for step in range(12):
                torch.manual_seed(400000+epoch*12+step)
                pick=torch.multinomial(weights,64,replacement=True);sx,sy=renderer.batch(64,3000000+epoch*12+step);xx=torch.cat([augment(tx[pick]),sx.clone()]);yy=torch.cat([ty[pick],sy.clone()]);optimizer.zero_grad(set_to_none=True)
                for batch in range(0,128,args.microbatch):
                    with torch.autocast(device_type=device.type,enabled=device.type=='cuda'):loss=F.cross_entropy(model(normalize(xx[batch:batch+args.microbatch])),yy[batch:batch+args.microbatch],label_smoothing=.03)*(args.microbatch/128)
                    if not torch.isfinite(loss):raise ValueError('Nonfinite adaptation loss')
                    scaler.scale(loss).backward();total+=float(loss.detach())
                scaler.step(optimizer);scaler.update()
            m=metrics(predict(model,cx,device),cy);record=dict(architecture=args.architecture,colour=kind,stage='adapt',epoch=epoch+1,loss=total/12,calibration=m,seconds=time.perf_counter()-start);history.append(record);print(json.dumps(record),flush=True)
            if m['loss']<best:best=m['loss'];chosen=epoch+1;torch.save(dict(state_dict=model.cpu().state_dict(),epoch=chosen),destination/'best.pt');model.to(device)
            (destination/'history.json').write_text(json.dumps(history,indent=2))
        model.load_state_dict(torch.load(destination/'best.pt',weights_only=True,map_location=device)['state_dict']);cal=predict(model,cx,device);threshold=calibrate(cal,cy,[r['frame'] for r in cr]);logits=predict(model,ex,device);result=dict(architecture=args.architecture,colour=kind,parameters=parameters,train=len(tr),calibration=len(cr),chosen_epoch=chosen,test=metrics(logits,ey,threshold),deterministic_correct=sum(rows[i]['baselinePhase']==rows[i]['phase'] for i in test_ids))
        result['groups']={src:dict(model=metrics(logits[[j for j,i in enumerate(test_ids) if rows[i]['source']==src]],ey[[j for j,i in enumerate(test_ids) if rows[i]['source']==src]],threshold),deterministic_correct=sum(rows[i]['baselinePhase']==rows[i]['phase'] for i in test_ids if rows[i]['source']==src)) for src in ['block','entity'] if any(rows[i]['source']==src for i in test_ids)}
        np.savez_compressed(destination/'predictions.npz',indices=test_ids,logits=logits.numpy(),truth=ey.numpy());(destination/'results.json').write_text(json.dumps(result,indent=2));results[kind]=result;print(json.dumps(result),flush=True);del model,renderer,optimizer;torch.cuda.empty_cache()
    report=dict(config=config,results=results,seconds=time.perf_counter()-start,data_hashes=json.loads((args.data/'data-hashes.json').read_text()),source_hashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in Path(__file__).parent.glob('*.py')});(out/'results.json').write_text(json.dumps(report,indent=2));print(json.dumps(dict(done=True,seconds=report['seconds'])),flush=True)

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('architecture',choices=['resnet101','vit_b16']);ap.add_argument('directory',type=Path);ap.add_argument('--data',type=Path,default=Path('.board/row32'));ap.add_argument('--extra',type=Path,default=Path('.board/fire-ai/survival-train-dense'));ap.add_argument('--backgrounds',type=Path,default=Path('.board/fire-ai/backgrounds-reviewed'));ap.add_argument('--epochs',type=int,default=8);ap.add_argument('--steps',type=int,default=64);ap.add_argument('--finetune-epochs',type=int,default=12);ap.add_argument('--microbatch',type=int,default=32);a=ap.parse_args();assert 128%a.microbatch==0;train(a)
