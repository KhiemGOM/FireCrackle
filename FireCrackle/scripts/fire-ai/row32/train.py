"""Synthetic pretraining, then two recording-held-out phase classification folds."""
import argparse,copy,hashlib,json,time
from pathlib import Path
from collections import Counter
import numpy as np
import torch
from torch.nn import functional as F
from model import make_model,normalize
from synthetic import PhaseRenderer

@torch.inference_mode()
def predict(model,x,device,batch=128):
    model.eval();return torch.cat([model(normalize(a.to(device))).float().cpu() for a in x.split(batch)])

def metrics(logits,y,threshold=None):
    probs=logits.softmax(1);confidence=probs.max(1).values;order=logits.argsort(1,descending=True);good=order[:,0]==y
    result=dict(n=len(y),correct=int(good.sum()),top3=int((order[:,:3]==y[:,None]).any(1).sum()),accuracy=float(good.float().mean()),loss=float(F.cross_entropy(logits,y)),macro_recall=float(torch.stack([good[y==c].float().mean() for c in y.unique()]).mean()))
    if threshold is not None:
        selected=confidence>=threshold;result['accepted']=int(selected.sum());result['accepted_correct']=int((selected&good).sum());result['accepted_wrong']=int((selected&~good).sum());result['threshold']=threshold
    return result

def calibrate(logits,y,frames):
    p=logits.softmax(1);conf=p.max(1).values;correct=p.argmax(1)==y
    for t in np.arange(0,1.001,.01):
        selected=conf>=t
        if selected.sum()>=5 and (selected&~correct).sum()==0 and len({frames[i] for i in torch.where(selected)[0].tolist()})>=2:return float(t)
    return 1.01

def augment(x):
    n=len(x);flip=torch.rand(n,1,1,1,device=x.device)<.5;x=torch.where(flip,x.flip(3),x)
    x=(x*(.85+.3*torch.rand(n,1,1,1,device=x.device))).clamp(0,1)
    return (x+torch.randn_like(x)*1.5/255).clamp(0,1)

def main(args):
    out=args.directory;out.mkdir(parents=True,exist_ok=True);torch.hub.set_dir(str(out/'torch'));torch.set_num_threads(4);torch.manual_seed(213);np.random.seed(213)
    device=torch.device('cuda' if torch.cuda.is_available() else 'cpu');scaler=torch.amp.GradScaler('cuda',enabled=device.type=='cuda')
    info=dict(torch=torch.__version__,device=str(device),gpu=torch.cuda.get_device_name() if device.type=='cuda' else None,config={k:str(v) if isinstance(v,Path) else v for k,v in vars(args).items()})
    print(json.dumps(info),flush=True)
    sheets=np.load(out/'sprites.npy');bg=args.backgrounds
    renderer=PhaseRenderer(np.load(bg/'train.npz')['x'],sheets,device);val_renderer=PhaseRenderer(np.load(bg/'val.npz')['x'],sheets,device)
    vs=[val_renderer.batch(128,900000+i) for i in range(8)];vx=torch.cat([a.cpu() for a,b in vs]);vy=torch.cat([b.cpu() for a,b in vs]);del vs,val_renderer
    d=np.load(out/'real.npz');x=torch.from_numpy(d['x'].transpose(0,3,1,2).copy()).float()/255;y=torch.tensor(d['y'],dtype=torch.long);rows=json.loads((out/'selected.json').read_text())
    model=make_model(True).to(device);info['parameters']=sum(p.numel() for p in model.parameters());optimizer=torch.optim.AdamW(model.parameters(),lr=.0005,weight_decay=.01);schedule=torch.optim.lr_scheduler.CosineAnnealingLR(optimizer,args.epochs)
    best=float('inf');history=[];start=time.perf_counter()
    for epoch in range(args.epochs):
        model.train();total=0
        for step in range(args.steps):
            xx,yy=renderer.batch(args.batch,100000+epoch*args.steps+step)
            # Renderer outputs inference tensors; clone before autograd uses RGB.
            xx=xx.clone();yy=yy.clone();optimizer.zero_grad(set_to_none=True)
            with torch.autocast(device_type=device.type,enabled=device.type=='cuda'):
                logits=model(normalize(xx));loss=F.cross_entropy(logits,yy,label_smoothing=.03)
            scaler.scale(loss).backward();scaler.step(optimizer);scaler.update();total+=float(loss.detach())
        schedule.step();validation=metrics(predict(model,vx,device),vy);record=dict(stage='synthetic',epoch=epoch+1,loss=total/args.steps,validation=validation,seconds=time.perf_counter()-start);history.append(record);print(json.dumps(record),flush=True)
        if validation['loss']<best:
            best=validation['loss'];torch.save(dict(state_dict=model.cpu().state_dict(),epoch=epoch+1),out/'synthetic.pt');model.to(device)
        (out/'history.json').write_text(json.dumps(history,indent=2))
    base=torch.load(out/'synthetic.pt',map_location='cpu',weights_only=True);base_state=copy.deepcopy(base['state_dict']);results={}
    # Each fold starts from the same synthetic checkpoint. A held recording is
    # never used for checkpoint selection, training, calibration or augmentation.
    for train_kind,test_kind in [('orange','soul'),('soul','orange')]:
        torch.manual_seed(214);model.load_state_dict(base_state);model.to(device)
        train_ids=np.where((d['kind']==train_kind)&(d['split']=='tune'))[0];cal_ids=np.where((d['kind']==train_kind)&(d['split']=='validation'))[0];test_ids=np.where((d['kind']==test_kind)&(d['split']=='validation'))[0]
        tx=x[train_ids].to(device);ty=y[train_ids].to(device);counts=Counter(rows[i]['frame'] for i in train_ids);weights=torch.tensor([1/counts[rows[i]['frame']] for i in train_ids],device=device)
        cx,cy=x[cal_ids],y[cal_ids];cal_frames=[rows[i]['frame'] for i in cal_ids];ex,ey=x[test_ids],y[test_ids]
        baseline_logits=predict(model,ex,device);baseline=metrics(baseline_logits,ey)
        optimizer=torch.optim.AdamW(model.parameters(),lr=.00005,weight_decay=.02);best=float('inf');chosen=0
        for epoch in range(args.finetune_epochs):
            model.train()
            # Freeze batch statistics during small-real-data adaptation.
            for module in model.modules():
                if isinstance(module,torch.nn.BatchNorm2d):module.eval()
            total=0
            for step in range(12):
                ids=torch.multinomial(weights,args.batch//2,replacement=True);rx=augment(tx[ids]);ry=ty[ids]
                sx,sy=renderer.batch(args.batch//2,2000000+epoch*12+step);xx=torch.cat([rx,sx.clone()]);yy=torch.cat([ry,sy.clone()]);optimizer.zero_grad(set_to_none=True)
                with torch.autocast(device_type=device.type,enabled=device.type=='cuda'):
                    loss=F.cross_entropy(model(normalize(xx)),yy,label_smoothing=.03)
                scaler.scale(loss).backward();scaler.step(optimizer);scaler.update();total+=float(loss.detach())
            validation=metrics(predict(model,cx,device),cy);record=dict(stage='adapt_'+train_kind,epoch=epoch+1,loss=total/12,validation=validation,seconds=time.perf_counter()-start);history.append(record);print(json.dumps(record),flush=True)
            if validation['loss']<best:
                best=validation['loss'];chosen=epoch+1;torch.save(dict(state_dict=model.cpu().state_dict(),epoch=chosen,train_kind=train_kind),out/f'{train_kind}.pt');model.to(device)
            (out/'history.json').write_text(json.dumps(history,indent=2))
        model.load_state_dict(torch.load(out/f'{train_kind}.pt',map_location=device,weights_only=True)['state_dict']);cal=predict(model,cx,device);threshold=calibrate(cal,cy,cal_frames);logits=predict(model,ex,device)
        deterministic=sum(rows[i]['baselinePhase']==rows[i]['phase'] for i in test_ids)
        result=dict(train_kind=train_kind,test_kind=test_kind,train=len(train_ids),calibration=len(cal_ids),test=len(test_ids),chosen_epoch=chosen,synthetic_only=baseline,adapted=metrics(logits,ey,threshold),deterministic_correct=deterministic)
        result['groups']={src:metrics(logits[[j for j,i in enumerate(test_ids) if rows[i]['source']==src]],ey[[j for j,i in enumerate(test_ids) if rows[i]['source']==src]],threshold) for src in ['block','entity'] if any(rows[i]['source']==src for i in test_ids)}
        results[train_kind+'_to_'+test_kind]=result;print(json.dumps(result),flush=True)
        np.savez_compressed(out/f'predictions-{test_kind}.npz',indices=test_ids,logits=logits.numpy(),synthetic_logits=baseline_logits.numpy(),truth=ey.numpy())
    # Batch1 includes transfer, normalization and synchronized model execution.
    timing={};sample=x[:1]
    for target in ['cpu']+(['cuda'] if torch.cuda.is_available() else []):
        model.to(target).eval();dur=[]
        with torch.inference_mode():
            for i in range(120):
                if target=='cuda':torch.cuda.synchronize()
                t=time.perf_counter();model(normalize(sample.to(target)))
                if target=='cuda':torch.cuda.synchronize()
                if i>=20:dur.append((time.perf_counter()-t)*1000)
        timing[target]=dict(median_ms=float(np.median(dur)),p95_ms=float(np.percentile(dur,95)),cpu_threads=4)
    info.update(results=results,timing=timing,seconds=time.perf_counter()-start,data_hashes=json.loads((out/'data-hashes.json').read_text()),source_hashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in Path(__file__).parent.glob('*.py')})
    (out/'results.json').write_text(json.dumps(info,indent=2));print(json.dumps(dict(timing=timing,seconds=info['seconds'])),flush=True)

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('directory',type=Path);ap.add_argument('--backgrounds',type=Path,required=True);ap.add_argument('--epochs',type=int,default=8);ap.add_argument('--steps',type=int,default=64);ap.add_argument('--batch',type=int,default=128);ap.add_argument('--finetune-epochs',type=int,default=12);main(ap.parse_args())
