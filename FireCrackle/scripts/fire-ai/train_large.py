"""Fresh synthetic-only training on real no-fire backgrounds; no real target IO."""
import argparse,hashlib,json,time
from pathlib import Path
import numpy as np
import torch
from train import make_model,evaluate
from gpu_render import Renderer
from render import contact_sheet


def frozen_samples(renderer,count,seed):
    xs=[];ys=[]
    for step in range(count//128):
        y=torch.arange(128,device=renderer.device)
        xs.append(renderer.batch(y,seed+step).cpu());ys.append(y.cpu())
    return torch.cat(xs),torch.cat(ys)


def main():
    ap=argparse.ArgumentParser();ap.add_argument('backgrounds',type=Path);ap.add_argument('out',type=Path);ap.add_argument('--epochs',type=int,default=16);ap.add_argument('--steps',type=int,default=512);args=ap.parse_args()
    args.out.mkdir(parents=True,exist_ok=True);torch.manual_seed(71);np.random.seed(71);torch.set_num_threads(4)
    device=torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    train=Renderer(np.load(args.backgrounds/'train.npz')['x'],device);val=Renderer(np.load(args.backgrounds/'val.npz')['x'],device)
    vx,vy=frozen_samples(val,2048,20000000)
    np.savez_compressed(args.out/'synthetic-val.npz',x=np.uint8(((vx[:,:3]+1)/2*255).numpy().transpose(0,2,3,1)),y=vy.numpy())
    preview,_,_,_=train.batch(torch.arange(128,device=device),9999999,return_native=True)
    contact_sheet(np.uint8(((preview[:64,:3].cpu()+1)/2*255).numpy().transpose(0,2,3,1)),[f'appearance{i}' for i in range(64)],args.out/'training-preview.png')
    model=make_model().to(device);optimizer=torch.optim.AdamW(model.parameters(),lr=.002,weight_decay=.01)
    scheduler=torch.optim.lr_scheduler.CosineAnnealingLR(optimizer,args.epochs)
    scaler=torch.amp.GradScaler('cuda',enabled=device.type=='cuda')
    best=-1;history=[];start=time.perf_counter();step=0
    for epoch in range(args.epochs):
        model.train();total=0.;correct=0
        for _ in range(args.steps):
            y=torch.randperm(128,device=device);xx=train.batch(y,10000000+step);step+=1
            # Clone inference tensors before the autograd forward.
            xx=xx.clone();optimizer.zero_grad(set_to_none=True)
            with torch.autocast(device_type=device.type,dtype=torch.float16,enabled=device.type=='cuda'):
                logits=model(xx);loss=torch.nn.functional.cross_entropy(logits,y)
            scaler.scale(loss).backward();scaler.step(optimizer);scaler.update()
            total+=float(loss.detach());correct+=int((logits.argmax(1)==y).sum())
        scheduler.step();metrics,_,_=evaluate(model,vx,vy,device)
        record=dict(epoch=epoch+1,unique_training_examples=step*128,loss=total/args.steps,train_top1=correct,synthetic_validation=metrics,seconds=time.perf_counter()-start)
        history.append(record);print(json.dumps(record),flush=True)
        if metrics['top1']>best:
            best=metrics['top1'];torch.save(dict(state_dict=model.state_dict(),epoch=epoch+1,seed=71),args.out/'best.pt')
        (args.out/'history.json').write_text(json.dumps(history,indent=2))
    freeze=dict(unique_training_examples=step*128,epochs=args.epochs,steps_per_epoch=args.steps,seed=71,render_seed_start=10000000,validation_seed_start=20000000,checkpoint_sha256=hashlib.sha256((args.out/'best.pt').read_bytes()).hexdigest(),background_manifest_sha256=hashlib.sha256((args.backgrounds/'manifest.json').read_bytes()).hexdigest(),selection='synthetic validation only; first maximal top1 checkpoint',sources={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in Path(__file__).parent.glob('*.py')})
    (args.out/'freeze.json').write_text(json.dumps(freeze,indent=2));print(json.dumps(freeze),flush=True)


if __name__=='__main__':main()
