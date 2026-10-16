"""Train on screened survival for fixed10epochs; no quad1 IO or model selection."""
import argparse,hashlib,json,math,time
from pathlib import Path
import numpy as np
import torch
from torch import nn
from train import make_model,inputs,evaluate


def augment(x,y):
    x=x.clone();y=y.clone();flip=torch.rand(len(y),device=x.device)<.5
    x[flip]=x[flip].flip(-1);y[flip]=y[flip]^1
    rgb=(x[:,:3]+1)/2
    gain=torch.empty(len(y),1,1,1,device=x.device).uniform_(.75,1.25)
    tint=torch.empty(len(y),3,1,1,device=x.device).uniform_(.95,1.05)
    rgb=(rgb*gain*tint).clamp(0,1)
    r,g,b=rgb[:,0],rgb[:,1],rgb[:,2]
    mask=(r>=25/255)&(g<=1.12*r)&(((g>=.25*r)&(b<=.65*r))|((r>=130/255)&(g>=.8*r)))
    x=torch.cat([rgb*2-1,mask[:,None].float()*2-1],dim=1)
    # Sub-texel position uncertainty, no rotation or vertical inversion.
    theta=torch.eye(2,3,device=x.device).expand(len(y),-1,-1).clone()
    theta[:,:,2]=torch.empty(len(y),2,device=x.device).uniform_(-.025,.025)
    grid=nn.functional.affine_grid(theta,x.shape,align_corners=False)
    return nn.functional.grid_sample(x,grid,align_corners=False,padding_mode="border"),y


def main():
    ap=argparse.ArgumentParser();ap.add_argument("initial",type=Path);ap.add_argument("real",type=Path);ap.add_argument("synthetic",type=Path);ap.add_argument("out",type=Path);ap.add_argument("--epochs",type=int,default=10);args=ap.parse_args()
    args.out.mkdir(parents=True,exist_ok=True);torch.manual_seed(29);np.random.seed(29);torch.set_num_threads(4)
    device=torch.device("cuda" if torch.cuda.is_available() else "cpu")
    real=np.load(args.real/"train.npz");valid=np.load(args.real/"val.npz");synthetic=np.load(args.synthetic/"train.npz");synval=np.load(args.synthetic/"val.npz")
    x,y=inputs(real["x"]).to(device),torch.tensor(real["y"],dtype=torch.long,device=device)
    sx,sy=inputs(synthetic["x"]).to(device),torch.tensor(synthetic["y"],dtype=torch.long,device=device)
    vx,vy=inputs(valid["x"]),torch.tensor(valid["y"],dtype=torch.long)
    svx,svy=inputs(synval["x"]),torch.tensor(synval["y"],dtype=torch.long)
    counts=torch.bincount(y,minlength=128).float();weights=1/counts[y]
    model=make_model().to(device);model.load_state_dict(torch.load(args.initial,map_location=device,weights_only=True)["state_dict"])
    optimizer=torch.optim.AdamW(model.parameters(),lr=.0002,weight_decay=.01);scheduler=torch.optim.lr_scheduler.CosineAnnealingLR(optimizer,args.epochs)
    history=[];start=time.perf_counter();steps=max(16,math.ceil(len(y)/128)*2)
    initial,_,_=evaluate(model,vx,vy,device);print("initial-survival-val",json.dumps(initial),flush=True)
    for epoch in range(args.epochs):
        model.train();total=0
        for _ in range(steps):
            ids=torch.multinomial(weights,128,replacement=True);sid=torch.randint(len(sy),(128,),device=device)
            xx,yy=augment(torch.cat([x[ids],sx[sid]]),torch.cat([y[ids],sy[sid]]))
            optimizer.zero_grad(set_to_none=True);loss=nn.functional.cross_entropy(model(xx),yy);loss.backward();optimizer.step();total+=float(loss.detach())
        scheduler.step();metrics,_,_=evaluate(model,vx,vy,device);synmetrics,_,_=evaluate(model,svx,svy,device)
        record=dict(epoch=epoch+1,loss=total/steps,survival_validation=metrics,synthetic_validation=synmetrics,seconds=time.perf_counter()-start)
        history.append(record);print(json.dumps(record),flush=True)
        (args.out/"history.json").write_text(json.dumps(history,indent=2))
    torch.save(dict(state_dict=model.state_dict(),epoch=args.epochs,seed=29),args.out/"best.pt")
    report=dict(initial=initial,train_crops=len(y),real_validation_crops=len(vy),steps_per_epoch=steps,selection=f"fixed{args.epochs}epochs; survival validation monitored, no checkpoint selection",initial_sha256=hashlib.sha256(args.initial.read_bytes()).hexdigest(),checkpoint_sha256=hashlib.sha256((args.out/"best.pt").read_bytes()).hexdigest(),training_seconds=time.perf_counter()-start,sources={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in Path(__file__).parent.glob("*.py")})
    (args.out/"freeze.json").write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)


if __name__=="__main__":main()
