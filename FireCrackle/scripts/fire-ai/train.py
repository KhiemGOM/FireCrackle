"""Synthetic-only pilot. Select checkpoint on synthetic validation, never real clips."""
import argparse
import hashlib
import json
import time
from pathlib import Path
import numpy as np
import torch
from torch import nn
from torchvision.models import mobilenet_v3_small,resnet18
from render import colour_mask, contact_sheet


def make_model(architecture="mobilenet_v3_small"):
    if architecture == "resnet18":
        model=resnet18(weights=None,num_classes=128)
        # Small-input stem retains the fire pixel structure before residual blocks.
        model.conv1=nn.Conv2d(4,64,3,stride=1,padding=1,bias=False)
        model.maxpool=nn.Identity()
        return model
    if architecture != "mobilenet_v3_small":
        raise ValueError(f"Unknown architecture: {architecture}")
    model=mobilenet_v3_small(weights=None,num_classes=128)
    # Keep more spatial detail at 64x64; all remaining blocks are unmodified.
    old=model.features[0][0]
    model.features[0][0]=nn.Conv2d(4,old.out_channels,3,stride=1,padding=1,bias=False)
    return model


def checkpoint_model(checkpoint):
    # Existing pilot checkpoints predate explicit architecture metadata.
    model=make_model(checkpoint.get("architecture","mobilenet_v3_small"))
    model.load_state_dict(checkpoint["state_dict"])
    return model


def inputs(rgb):
    masks=np.stack([colour_mask(im) for im in rgb])
    x=np.concatenate([rgb,masks[:,:,:,None]],axis=3)
    return torch.from_numpy(x.transpose(0,3,1,2).copy()).float()/127.5-1


@torch.inference_mode()
def evaluate(model,x,y,device):
    model.eval();pred=[]
    for i in range(0,len(y),256):
        pred.append(model(x[i:i+256].to(device)).float().cpu())
    logits=torch.cat(pred);prob=logits.softmax(1);order=logits.argsort(1,descending=True)
    correct=order[:,0].eq(y);conf=prob.max(1).values
    out=dict(n=len(y),top1=int(correct.sum()),top3=int((order[:,:3]==y[:,None]).any(1).sum()),mean_confidence=float(conf.mean()))
    for threshold in [.5,.8,.95]:
        accepted=conf>=threshold
        out[str(threshold)]=dict(accepted=int(accepted.sum()),wrong=int((accepted&~correct).sum()))
    return out,order,conf


def main():
    ap=argparse.ArgumentParser();ap.add_argument("data",type=Path);ap.add_argument("--epochs",type=int,default=20);ap.add_argument("--seed",type=int,default=17);ap.add_argument("--evaluate-only",action="store_true");args=ap.parse_args()
    torch.manual_seed(args.seed);np.random.seed(args.seed);torch.set_num_threads(4)
    device=torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(dict(torch=torch.__version__,device=str(device),gpu=torch.cuda.get_device_name() if device.type=="cuda" else None),flush=True)
    train=np.load(args.data/"train.npz");val=np.load(args.data/"val.npz")
    x,y=inputs(train["x"]),torch.tensor(train["y"],dtype=torch.long)
    vx,vy=inputs(val["x"]),torch.tensor(val["y"],dtype=torch.long)
    model=make_model().to(device);optimizer=torch.optim.AdamW(model.parameters(),lr=.002,weight_decay=.01)
    scheduler=torch.optim.lr_scheduler.CosineAnnealingLR(optimizer,args.epochs)
    # These 16k small crops fit in device memory; avoid repeated transfer cost.
    x,y=x.to(device),y.to(device)
    best=-1;history=[];start=time.perf_counter()
    for epoch in range(0 if args.evaluate_only else args.epochs):
        model.train();permutation=torch.randperm(len(y),device=device);loss_sum=0.;good=0
        for ids in permutation.split(256):
            optimizer.zero_grad(set_to_none=True);logits=model(x[ids]);loss=nn.functional.cross_entropy(logits,y[ids])
            loss.backward();optimizer.step()
            loss_sum+=float(loss.detach())*len(ids);good+=int((logits.argmax(1)==y[ids]).sum())
        scheduler.step();metrics,_,_=evaluate(model,vx,vy,device)
        record=dict(epoch=epoch+1,loss=loss_sum/len(y),train_top1=good,validation=metrics,seconds=time.perf_counter()-start)
        history.append(record);print(json.dumps(record),flush=True)
        if metrics["top1"]>best:
            best=metrics["top1"];torch.save(dict(state_dict=model.state_dict(),epoch=epoch+1,seed=args.seed),args.data/"best.pt")
        (args.data/"history.json").write_text(json.dumps(history,indent=2))
    model.load_state_dict(torch.load(args.data/"best.pt",map_location=device,weights_only=True)["state_dict"])
    results={}
    for mode in ["val","clean","hard","rough"]:
        data=np.load(args.data/f"{mode}.npz");xx=inputs(data["x"]);yy=torch.tensor(data["y"],dtype=torch.long)
        result,order,confidence=evaluate(model,xx,yy,device);results[mode]=result
        np.savez(args.data/f"predictions-{mode}.npz",order=order.numpy(),confidence=confidence.numpy(),truth=yy.numpy())
        wrong=torch.where(order[:,0]!=yy)[0].numpy()[:32]
        contact_sheet(data["x"][wrong],[f"T{int(yy[i])} P{int(order[i,0])} {confidence[i]:.2f}" for i in wrong],args.data/f"errors-{mode}.png")
        print(mode,json.dumps(result),flush=True)
    results["parameters"]=sum(p.numel() for p in model.parameters());results["training_seconds"]=json.loads((args.data/"history.json").read_text())[-1]["seconds"]
    results["checkpoint_sha256"]=hashlib.sha256((args.data/"best.pt").read_bytes()).hexdigest()
    results["sources"]={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in Path(__file__).parent.glob("*.py")}
    results["device"]=str(device);results["torch"]=torch.__version__
    # Batch-1 model only; CPU benchmark includes no crop/mask or transfer time.
    model.cpu().eval();one=vx[:1]
    with torch.inference_mode():
        for _ in range(20):model(one)
        times=[]
        for _ in range(200):
            t=time.perf_counter();model(one);times.append((time.perf_counter()-t)*1000)
    results["cpu_ms"]=dict(median=float(np.median(times)),p95=float(np.quantile(times,.95)),threads=4)
    (args.data/"results.json").write_text(json.dumps(results,indent=2));print(json.dumps(results),flush=True)


if __name__=="__main__":main()
