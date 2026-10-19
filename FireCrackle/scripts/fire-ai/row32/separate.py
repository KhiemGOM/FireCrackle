"""Independent orange/soul models. Each has32 phase classes, no cross-colour fit."""
import argparse,hashlib,json,time
from collections import Counter
from pathlib import Path
import numpy as np
import torch
from torch.nn import functional as F
from model import make_model,normalize
from synthetic import PhaseRenderer
from train import predict,metrics,calibrate,augment

def main(args):
    base=args.directory;out=base/'separate';out.mkdir(exist_ok=True);torch.hub.set_dir(str(base/'torch'));torch.set_num_threads(4)
    device=torch.device('cuda' if torch.cuda.is_available() else 'cpu');d=np.load(base/'real.npz');x=torch.from_numpy(d['x'].transpose(0,3,1,2).copy()).float()/255;y=torch.tensor(d['y'],dtype=torch.long);rows=json.loads((base/'selected.json').read_text());sheets=np.load(base/'sprites.npy')
    results={};start=time.perf_counter()
    for kind,seed in [('orange',213),('soul',214)]:
        destination=out/kind;destination.mkdir(exist_ok=True);torch.manual_seed(seed);np.random.seed(seed)
        renderer=PhaseRenderer(np.load(args.backgrounds/'train.npz')['x'],sheets,device,kind);vr=PhaseRenderer(np.load(args.backgrounds/'val.npz')['x'],sheets,device,kind)
        val=[vr.batch(128,900000+i) for i in range(8)];vx=torch.cat([a.cpu() for a,b in val]);vy=torch.cat([b.cpu() for a,b in val]);del val,vr
        frames=sorted({r['frame'] for r in rows if r['kind']==kind and r['split']=='tune'});cut=frames[int(len(frames)*.75)]
        train_ids=[i for i,r in enumerate(rows) if r['kind']==kind and r['split']=='tune' and r['frame']<cut-240];cal_ids=[i for i,r in enumerate(rows) if r['kind']==kind and r['split']=='tune' and r['frame']>=cut];test_ids=[i for i,r in enumerate(rows) if r['kind']==kind and r['split']=='validation']
        split=dict(kind=kind,cut=cut,guard=240,train_ids=train_ids,calibration_ids=cal_ids,test_ids=test_ids,counts={name:dict(n=len(ids),frames=len({rows[i]['frame'] for i in ids}),classes=len({rows[i]['phase'] for i in ids})) for name,ids in [('train',train_ids),('calibration',cal_ids),('test',test_ids)]})
        assert train_ids and cal_ids and max(rows[i]['frame'] for i in train_ids)+240<min(rows[i]['frame'] for i in cal_ids)
        assert not(set(train_ids)&set(cal_ids)|set(train_ids)&set(test_ids)|set(cal_ids)&set(test_ids))
        (destination/'split.json').write_text(json.dumps(split,indent=2));print(json.dumps(split['counts']|{'stage':'split','kind':kind}),flush=True)
        model=make_model(True).to(device);optimizer=torch.optim.AdamW(model.parameters(),lr=.0005,weight_decay=.01);scheduler=torch.optim.lr_scheduler.CosineAnnealingLR(optimizer,args.epochs);scaler=torch.amp.GradScaler('cuda',enabled=device.type=='cuda');best=float('inf');history=[]
        for epoch in range(args.epochs):
            model.train();total=0
            for step in range(args.steps):
                a,b=renderer.batch(args.batch,100000+epoch*args.steps+step);a=a.clone();b=b.clone();optimizer.zero_grad(set_to_none=True)
                with torch.autocast(device_type=device.type,enabled=device.type=='cuda'):loss=F.cross_entropy(model(normalize(a)),b,label_smoothing=.03)
                scaler.scale(loss).backward();scaler.step(optimizer);scaler.update();total+=float(loss.detach())
            scheduler.step();m=metrics(predict(model,vx,device),vy);record=dict(kind=kind,stage='synthetic',epoch=epoch+1,loss=total/args.steps,validation=m,seconds=time.perf_counter()-start);history.append(record);print(json.dumps(record),flush=True)
            if m['loss']<best:best=m['loss'];torch.save(dict(state_dict=model.cpu().state_dict(),epoch=epoch+1),destination/'synthetic.pt');model.to(device)
            (destination/'history.json').write_text(json.dumps(history,indent=2))
        model.load_state_dict(torch.load(destination/'synthetic.pt',weights_only=True,map_location=device)['state_dict'])
        # Keep the synthetic checkpoint as a valid adaptation candidate.
        cx,cy=x[cal_ids],y[cal_ids];cal=predict(model,cx,device);best=metrics(cal,cy)['loss'];chosen=0
        torch.save(dict(state_dict=model.cpu().state_dict(),epoch=0),destination/'best.pt');model.to(device)
        tx=x[train_ids].to(device);ty=y[train_ids].to(device);counts=Counter(rows[i]['frame'] for i in train_ids);weights=torch.tensor([1/counts[rows[i]['frame']] for i in train_ids],device=device);optimizer=torch.optim.AdamW(model.parameters(),lr=.00005,weight_decay=.02)
        for epoch in range(args.finetune_epochs):
            model.train()
            for module in model.modules():
                if isinstance(module,torch.nn.BatchNorm2d):module.eval()
            total=0
            for step in range(12):
                ids=torch.multinomial(weights,args.batch//2,replacement=True);a,b=renderer.batch(args.batch//2,2000000+epoch*12+step);xx=torch.cat([augment(tx[ids]),a.clone()]);yy=torch.cat([ty[ids],b.clone()]);optimizer.zero_grad(set_to_none=True)
                with torch.autocast(device_type=device.type,enabled=device.type=='cuda'):loss=F.cross_entropy(model(normalize(xx)),yy,label_smoothing=.03)
                scaler.scale(loss).backward();scaler.step(optimizer);scaler.update();total+=float(loss.detach())
            m=metrics(predict(model,cx,device),cy);record=dict(kind=kind,stage='adapt',epoch=epoch+1,loss=total/12,validation=m,seconds=time.perf_counter()-start);history.append(record);print(json.dumps(record),flush=True)
            if m['loss']<best:best=m['loss'];chosen=epoch+1;torch.save(dict(state_dict=model.cpu().state_dict(),epoch=chosen),destination/'best.pt');model.to(device)
            (destination/'history.json').write_text(json.dumps(history,indent=2))
        model.load_state_dict(torch.load(destination/'best.pt',weights_only=True,map_location=device)['state_dict']);cal=predict(model,cx,device);threshold=calibrate(cal,cy,[rows[i]['frame'] for i in cal_ids]);logits=predict(model,x[test_ids],device);truth=y[test_ids]
        result=dict(kind=kind,split=split['counts'],cut=cut,guard=240,chosen_epoch=chosen,test=metrics(logits,truth,threshold),deterministic_correct=sum(rows[i]['baselinePhase']==rows[i]['phase'] for i in test_ids))
        result['groups']={src:dict(cnn=metrics(logits[[j for j,i in enumerate(test_ids) if rows[i]['source']==src]],truth[[j for j,i in enumerate(test_ids) if rows[i]['source']==src]],threshold),deterministic_correct=sum(rows[i]['baselinePhase']==rows[i]['phase'] for i in test_ids if rows[i]['source']==src)) for src in ['block','entity'] if any(rows[i]['source']==src for i in test_ids)}
        np.savez_compressed(destination/'predictions.npz',indices=test_ids,logits=logits.numpy(),truth=truth.numpy());(destination/'results.json').write_text(json.dumps(result,indent=2));results[kind]=result;print(json.dumps(result),flush=True)
        del model,renderer;torch.cuda.empty_cache()
    report=dict(results=results,seconds=time.perf_counter()-start,data_hashes=json.loads((base/'data-hashes.json').read_text()),source_hashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in Path(__file__).parent.iterdir() if p.suffix in ['.py','.mjs']})
    (out/'results.json').write_text(json.dumps(report,indent=2));print(json.dumps(dict(done=True,seconds=report['seconds'])),flush=True)

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('directory',type=Path);ap.add_argument('--backgrounds',type=Path,required=True);ap.add_argument('--epochs',type=int,default=8);ap.add_argument('--steps',type=int,default=64);ap.add_argument('--batch',type=int,default=128);ap.add_argument('--finetune-epochs',type=int,default=12);main(ap.parse_args())
