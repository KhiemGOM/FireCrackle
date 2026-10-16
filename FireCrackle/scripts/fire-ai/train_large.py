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
    ap=argparse.ArgumentParser();ap.add_argument('backgrounds',type=Path);ap.add_argument('out',type=Path);ap.add_argument('--epochs',type=int,default=16);ap.add_argument('--steps',type=int,default=512)
    ap.add_argument('--architecture',choices=['mobilenet_v3_small','resnet18'],default='mobilenet_v3_small')
    ap.add_argument('--paired-control',action='store_true',help='Train small control on identical batches with independent model RNG streams')
    args=ap.parse_args()
    if args.paired_control and args.architecture=='mobilenet_v3_small':ap.error('Paired control requires a larger primary architecture')
    args.out.mkdir(parents=True,exist_ok=True);torch.manual_seed(71);np.random.seed(71);torch.set_num_threads(4)
    device=torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    train=Renderer(np.load(args.backgrounds/'train.npz')['x'],device);val=Renderer(np.load(args.backgrounds/'val.npz')['x'],device)
    vx,vy=frozen_samples(val,2048,20000000)
    np.savez_compressed(args.out/'synthetic-val.npz',x=np.uint8(((vx[:,:3]+1)/2*255).numpy().transpose(0,2,3,1)),y=vy.numpy())
    preview,_,_,_=train.batch(torch.arange(128,device=device),9999999,return_native=True)
    contact_sheet(np.uint8(((preview[:64,:3].cpu()+1)/2*255).numpy().transpose(0,2,3,1)),[f'appearance{i}' for i in range(64)],args.out/'training-preview.png')
    runs=[]
    for architecture,directory in [(args.architecture,args.out)]+([('mobilenet_v3_small',args.out/'small-control')] if args.paired_control else []):
        directory.mkdir(parents=True,exist_ok=True);torch.manual_seed(71)
        model=make_model(architecture).to(device);optimizer=torch.optim.AdamW(model.parameters(),lr=.002,weight_decay=.01)
        run=dict(architecture=architecture,directory=directory,model=model,optimizer=optimizer,
                 scheduler=torch.optim.lr_scheduler.CosineAnnealingLR(optimizer,args.epochs),
                 scaler=torch.amp.GradScaler('cuda',enabled=device.type=='cuda'),
                 rng=torch.cuda.get_rng_state() if device.type=='cuda' else torch.get_rng_state(),
                 best=-1,history=[],parameters=sum(p.numel() for p in model.parameters()))
        runs.append(run)
    # Label ordering does not depend on model initialization or dropout draws.
    labels=torch.Generator(device=device).manual_seed(71)
    start=time.perf_counter();step=0
    for epoch in range(args.epochs):
        for run in runs:run['model'].train();run['loss']=0.;run['correct']=0
        for _ in range(args.steps):
            y=torch.randperm(128,device=device,generator=labels);xx=train.batch(y,10000000+step);step+=1
            # Clone inference tensors before the autograd forward.
            xx=xx.clone()
            for run in runs:
                if device.type=='cuda':torch.cuda.set_rng_state(run['rng'])
                else:torch.set_rng_state(run['rng'])
                model,optimizer,scaler=run['model'],run['optimizer'],run['scaler']
                optimizer.zero_grad(set_to_none=True)
                with torch.autocast(device_type=device.type,dtype=torch.float16,enabled=device.type=='cuda'):
                    logits=model(xx);loss=torch.nn.functional.cross_entropy(logits,y)
                scaler.scale(loss).backward();scaler.step(optimizer);scaler.update()
                run['rng']=torch.cuda.get_rng_state() if device.type=='cuda' else torch.get_rng_state()
                run['loss']+=float(loss.detach());run['correct']+=int((logits.argmax(1)==y).sum())
        for run in runs:
            run['scheduler'].step();metrics,_,_=evaluate(run['model'],vx,vy,device)
            record=dict(architecture=run['architecture'],epoch=epoch+1,unique_training_examples=step*128,loss=run['loss']/args.steps,train_top1=run['correct'],synthetic_validation=metrics,seconds=time.perf_counter()-start)
            run['history'].append(record);print(json.dumps(record),flush=True)
            if metrics['top1']>run['best']:
                run['best']=metrics['top1'];torch.save(dict(state_dict=run['model'].state_dict(),epoch=epoch+1,seed=71,architecture=run['architecture']),run['directory']/'best.pt')
            (run['directory']/'history.json').write_text(json.dumps(run['history'],indent=2))
    for run in runs:
        freeze=dict(architecture=run['architecture'],parameters=run['parameters'],paired_control=args.paired_control,unique_training_examples=step*128,epochs=args.epochs,steps_per_epoch=args.steps,seed=71,render_seed_start=10000000,validation_seed_start=20000000,checkpoint_sha256=hashlib.sha256((run['directory']/'best.pt').read_bytes()).hexdigest(),background_manifest_sha256=hashlib.sha256((args.backgrounds/'manifest.json').read_bytes()).hexdigest(),selection='synthetic validation only; first maximal top1 checkpoint',sources={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in Path(__file__).parent.glob('*.py')})
        (run['directory']/'freeze.json').write_text(json.dumps(freeze,indent=2));print(json.dumps(freeze),flush=True)


if __name__=='__main__':main()
