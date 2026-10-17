"""Recorded partial-supervision experiment with frozen colour/mask baselines."""
import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageDraw
from torch.nn import functional as F

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(HERE.parent/'occlusion'))
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(ROOT/'fire-detection/bench/no_fire'))
from core import MaskNet, OwnershipRenderer, input_tensor, crop_native, spatial_masks
from run import validation, predict
from gpu_render import homography, projected
from veil_native import apply as unveil

OUT = ROOT/'.board/occlusion-recorded'
SEED = 19017


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def data(device):
    manifest = json.loads((OUT/'manifest.json').read_text())
    with np.load(OUT/'recorded.npz') as a:
        tensors = {k:torch.tensor(a[k].copy(),device=device) for k in a.files}
    tensors['rgb'] = tensors['rgb'].permute(0,3,1,2).float()/255
    for k in ['target','valid','foreign']:
        tensors[k] = tensors[k][:,None].float()
    groups = {s:torch.tensor([i for i,r in enumerate(manifest['samples']) if r['split']==s],device=device)
              for s in ['train','validation','test']}
    return manifest,tensors,groups


def augment(real, indices, generator):
    rgb=real['rgb'][indices].clone();y=real['target'][indices].clone();valid=real['valid'][indices].clone()
    # Complete observation and labels flip together; no target sprite identity input.
    flip=torch.rand(len(indices),1,1,1,device=rgb.device,generator=generator)<.5
    rgb=torch.where(flip,rgb.flip(-1),rgb);y=torch.where(flip,y.flip(-1),y);valid=torch.where(flip,valid.flip(-1),valid)
    rgb=(rgb*(.85+.3*torch.rand(len(indices),1,1,1,device=rgb.device,generator=generator))).clamp(0,1)
    # Label uncertainty is preserved during augmentation, never filled with negatives.
    return input_tensor(rgb),y,valid


@torch.inference_mode()
def measured(model,real,ids):
    p=predict(model,input_tensor(real['rgb'][ids]))
    v=real['valid'][ids].bool();y=real['target'][ids].bool();f=real['foreign'][ids].bool()
    def one(pred):
        tp=int((pred&y&v).sum());fp=int((pred&~y&v).sum());fn=int((~pred&y&v).sum())
        return dict(iou=tp/max(1,tp+fp+fn),precision=tp/max(1,tp+fp),recall=tp/max(1,tp+fn),
                    foreign_retention=int((pred&f&v).sum())/max(1,int((f&v).sum())),tp=tp,fp=fp,fn=fn,known_pixels=int(v.sum()))
    return one(p>=.5)


def train(args):
    torch.set_num_threads(4);torch.manual_seed(SEED)
    device='cuda' if torch.cuda.is_available() else 'cpu';manifest,real,groups=data(device)
    backgrounds=np.load(ROOT/'.board/fire-ai/backgrounds/train.npz')['x']
    renderer=OwnershipRenderer(backgrounds,device)
    val=validation(OwnershipRenderer(np.load(ROOT/'.board/fire-ai/backgrounds/val.npz')['x'],device),512,61000000)
    directory=OUT/args.run;directory.mkdir(exist_ok=True)
    model=MaskNet().to(device)
    initial=ROOT/'.board/occlusion-mask/survival/best.pt'
    if args.run=='finetune':
        model.load_state_dict(torch.load(initial,map_location=device,weights_only=True)['state_dict'])
    # Freeze every decision before any held-out test prediction.
    protocol=dict(seed=SEED,run=args.run,epochs=args.epochs,steps=args.steps,batch=48,
                  new_recorded_per_step=24,synthetic_per_step=24,initial_sha256=sha(initial) if args.run=='finetune' else None,
                  selection='maximal 0.5 known-pixel recorded-validation IoU + 0.5 synthetic-validation IoU; test is never used',
                  supervision='Locally audited, partial renderer labels; frame warnings retained, unknown excluded; NOT certified oracle',
                  data_sha256=sha(OUT/'recorded.npz'),manifest_sha256=sha(OUT/'manifest.json'),
                  veil_sha256=sha(ROOT/'fire-detection/core/src/veil.rs'),model_input='RGB plus existing broad colour mask, no candidate row/sheet',
                  evaluation='Frozen colour baseline and prior survival model; soft, half-strength, hard masks at fixed .5 threshold; downstream unchanged matcher')
    (directory/'protocol.json').write_text(json.dumps(protocol,indent=2))
    optimizer=torch.optim.AdamW(model.parameters(),lr=.0003 if args.run=='finetune' else .0015,weight_decay=.0001)
    scheduler=torch.optim.lr_scheduler.CosineAnnealingLR(optimizer,args.epochs)
    scaler=torch.amp.GradScaler('cuda',enabled=device=='cuda');generator=torch.Generator(device=device).manual_seed(SEED)
    history=[];best=-1;start=time.perf_counter()
    for epoch in range(args.epochs):
        model.train();total=0
        for step in range(args.steps):
            indices=groups['train'][torch.randint(len(groups['train']),(24,),device=device,generator=generator)]
            x,y,valid=augment(real,indices,generator)
            synth=renderer.scene(torch.randint(128,(24,),device=device,generator=generator),62000000+epoch*args.steps+step)
            x=torch.cat([x,synth['x']]);y=torch.cat([y,synth['y']]);valid=torch.cat([valid,torch.ones_like(synth['y'])])
            optimizer.zero_grad(set_to_none=True)
            with torch.autocast(device_type=device,dtype=torch.float16,enabled=device=='cuda'):
                logits=model(x);p=logits.sigmoid()
                # Per-example normalization prevents dense synthetic labels drowning sparse real labels.
                bce=(F.binary_cross_entropy_with_logits(logits,y,reduction='none')*valid).sum((1,2,3))/valid.sum((1,2,3)).clamp_min(1)
                dice=1-(2*(p*y*valid).sum((1,2,3))+1)/((p*valid).sum((1,2,3))+(y*valid).sum((1,2,3))+1)
                loss=(bce+dice).mean()
            scaler.scale(loss).backward();scaler.step(optimizer);scaler.update();total+=float(loss.detach())
        scheduler.step();recorded=measured(model,real,groups['validation'])
        sp=predict(model,val['x'])>=.5;sy=val['y'].bool()
        synthetic_iou=int((sp&sy).sum())/max(1,int((sp|sy).sum()))
        score=.5*(recorded['iou']+synthetic_iou)
        record=dict(epoch=epoch+1,loss=total/args.steps,recorded_validation=recorded,synthetic_iou=synthetic_iou,selection=score,seconds=time.perf_counter()-start)
        history.append(record);print(json.dumps(record),flush=True)
        if score>best:
            best=score;torch.save(dict(state_dict=model.state_dict(),epoch=epoch+1,score=score),directory/'best.pt')
        (directory/'history.json').write_text(json.dumps(history,indent=2))
    protocol['checkpoint_sha256']=sha(directory/'best.pt');(directory/'protocol.json').write_text(json.dumps(protocol,indent=2))


def load(run,device):
    path=ROOT/'.board/occlusion-mask/survival/best.pt' if run=='previous' else OUT/run/'best.pt'
    model=MaskNet().to(device);model.load_state_dict(torch.load(path,map_location=device,weights_only=True)['state_dict']);model.eval()
    return model,path


@torch.inference_mode()
def evaluate(args):
    torch.set_num_threads(4);device='cuda' if torch.cuda.is_available() else 'cpu'
    manifest,real,groups=data(device);summary={};models={r:load(r,device) for r in ['previous','finetune','scratch']}
    for run,(model,path) in models.items():
        summary[run]=dict(recorded_test=measured(model,real,groups['test']),checkpoint_sha256=sha(path))
    ids=groups['test'];rgb=real['rgb'][ids];col=(input_tensor(rgb)[:,3:]>=0)
    v=real['valid'][ids].bool();y=real['target'][ids].bool()
    summary['colour']=dict(recorded_test=dict(iou=int((col&y&v).sum())/max(1,int(((col|y)&v).sum())),
        precision=int((col&y&v).sum())/max(1,int((col&v).sum())),recall=int((col&y&v).sum())/max(1,int((y&v).sum()))))
    # Freeze selected runs before downstream matcher results are read.
    (OUT/'mask-results.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary),flush=True)
    for run,(model,path) in models.items():
        destinations=[('new-test',None)]
        destinations += [(name,source) for name,source in [
            ('quad1',ROOT/'FireCrackle/src-tauri/target/actual-quad1'),
            ('survival',ROOT/'.board/fire-ai/survival'),
            ('reviewed',ROOT/'.board/fire-ai/baseline-reviewed')]]
        if args.rough:
            destinations=[(name+'-rough',source) for name,source in destinations if name!='reviewed']
        for name,source in destinations:
            dest=OUT/run/name;dest.mkdir(parents=True,exist_ok=True);rows=[]
            native_dir=OUT/('native-'+name.removesuffix('-rough'));native_dir.mkdir(exist_ok=True)
            if source is None:
                indices=groups['test'].cpu().tolist()
                examples=[];current=None
                for i in indices:
                    s=manifest['samples'][i]
                    if not args.rough:
                        examples.append((i,s,real['rgb'][i:i+1]));continue
                    if current!=s['frame']:
                        current=s['frame'];arr=np.array(Image.open(Path(manifest['session'])/f'frame-{current:08}-rgb.png').convert('RGB'))
                        arr,_,_=unveil(arr);h,w=arr.shape[:2]
                        native=torch.tensor(arr.transpose(2,0,1).copy(),device=device).float()[None]/255
                    quad=torch.tensor(s['quad'],device=device,dtype=torch.float32)[None]
                    uv=torch.tensor([[(u-.5)*1.12+.5+.03+(j==1)*.02,(v-.5)*.92+.5-.02+(j==2)*.02] for j,(u,v) in enumerate([(0,0),(1,0),(1,1),(0,1)])],device=device)
                    quad=projected(homography(quad),uv)*torch.tensor([w,h],device=device)
                    examples.append((i,s,crop_native(native,quad).clamp(0,1)))
            else:
                original=json.loads((source/'manifest.json').read_text());w,h=original['width'],original['height'];examples=[];current=None
                samples=[s for s in original['samples'] if s['split']=='validation']
                # Preserve the previous survival train/selection exclusion when testing its frozen checkpoint.
                old=json.loads((ROOT/'.board/occlusion-mask/survival/freeze.json').read_text())
                used=[int(x.split('-')[0]) for x in old['real_train_ids']+old['real_selection_ids']]
                if name.startswith('survival'):samples=[s for s in samples if all(abs(s['frame']-f)>60 for f in used)]
                for i,s in enumerate(samples):
                    if current!=s['frame']:
                        current=s['frame'];arr=np.fromfile(source/f'{current}.rgb',np.uint8).reshape(h,w,3)
                        arr,_,_=unveil(arr);native=torch.tensor(arr.transpose(2,0,1).copy(),device=device).float()[None]/255
                    quad=torch.tensor(s['quad'],device=device,dtype=torch.float32)[None]
                    if args.rough:
                        uv=torch.tensor([[(u-.5)*1.12+.5+.03+(j==1)*.02,(v-.5)*.92+.5-.02+(j==2)*.02] for j,(u,v) in enumerate([(0,0),(1,0),(1,1),(0,1)])],device=device)
                        quad=projected(homography(quad),uv)
                    quad=quad*torch.tensor([w,h],device=device)
                    examples.append((i,s,crop_native(native,quad).clamp(0,1)))
            for index,s,crop in examples:
                # Score the ORIGINAL native pixels, not a resampled 64px substitute.
                # Only the mask network receives a rectified crop.
                frame=s['frame'];native_file=native_dir/f'{frame}.rgb'
                if not native_file.exists():
                    if source is None:
                        arr=np.array(Image.open(Path(manifest['session'])/f'frame-{frame:08}-rgb.png').convert('RGB'))
                    else:
                        arr=np.fromfile(source/f'{frame}.rgb',np.uint8).reshape(h,w,3)
                    arr,_,_=unveil(arr);native_file.write_bytes(np.ascontiguousarray(arr).tobytes())
                if source is None:
                    with Image.open(Path(manifest['session'])/f'frame-{frame:08}-rgb.png') as original_image:
                        width,height=original_image.size
                else:
                    width,height=w,h
                score_quad=torch.tensor(s['quad'],device=device,dtype=torch.float32)[None]
                if args.rough:
                    uv=torch.tensor([[(u-.5)*1.12+.5+.03+(j==1)*.02,(v-.5)*.92+.5-.02+(j==2)*.02] for j,(u,v) in enumerate([(0,0),(1,0),(1,1),(0,1)])],device=device)
                    score_quad=projected(homography(score_quad),uv)
                p=model(input_tensor(crop)).sigmoid()[0,0]
                spatial=spatial_masks((input_tensor(crop)[:,3:]+1)/2)
                for mask,value in {'opening':spatial['opening'][0,0],'majority':spatial['majority'][0,0],'learned_soft':p,'learned_half':.5+.5*p,'learned_hard':(p>=.5).float()}.items():
                    value.cpu().numpy().astype('<f4').tofile(dest/f'{index}.{mask}')
                rows.append(dict(id=s['id'],frame=frame,mask_index=index,quad=score_quad[0].cpu().tolist(),expected=s['expected'],source=name,split='validation'))
            (dest/'manifest.json').write_text(json.dumps(dict(width=width,height=height,native_source=str(native_dir),samples=rows,warning='Native-pixel unchanged matcher; 64px mask field only. Partial recorded supervision, not oracle.')))
            print(run,name,len(rows),flush=True)
    # Train-only audit view avoids inspecting test labels to tune data screening.
    canvas=Image.new('RGB',(8*192,3*146),'#10141c');draw=ImageDraw.Draw(canvas)
    for j,index in enumerate(groups['train'][:24].cpu().tolist()):
        im=np.uint8(real['rgb'][index].cpu().numpy().transpose(1,2,0)*255)
        m=np.zeros((64,64,3),np.uint8);valid=real['valid'][index,0].bool().cpu().numpy();target=real['target'][index,0].bool().cpu().numpy()
        m[valid&target]=[0,240,100];m[valid&~target]=[220,40,40];m[~valid]=[65,65,65]
        pred=np.uint8(models['finetune'][0](input_tensor(real['rgb'][index:index+1])).sigmoid()[0,0].cpu().numpy()*255)
        pair=np.concatenate([im,m,np.repeat(pred[...,None],3,-1)],1);x=j%8*192;yy=j//8*146
        canvas.paste(Image.fromarray(pair).resize((192,128)),(x,yy));draw.text((x,yy+130),manifest['samples'][index]['id'],fill='white')
    canvas.save(OUT/'training-audit.png')


@torch.inference_mode()
def synthetic(args):
    """Same previously frozen synthetic controls, never selected by new test scores."""
    torch.set_num_threads(4);device='cuda' if torch.cuda.is_available() else 'cpu'
    source=ROOT/'.board/occlusion-mask/survival/synthetic'
    original=json.loads((source/'manifest.json').read_text());seen={};chosen=[]
    for sample in original['samples']:
        kind=sample['source'];seen[kind]=seen.get(kind,0)+1
        if seen[kind]<=32:chosen.append(sample)
    for run in ['previous','finetune','scratch']:
        model,_=load(run,device);dest=OUT/run/'synthetic';dest.mkdir(parents=True,exist_ok=True)
        for index,s in enumerate(chosen):
            arr=np.fromfile(source/f'{s["frame"]}.rgb',np.uint8).reshape(160,160,3)
            image=torch.tensor(arr.transpose(2,0,1).copy(),device=device).float()[None]/255
            quad=torch.tensor(s['quad'],device=device,dtype=torch.float32)[None]*160
            crop=crop_native(image,quad);p=model(input_tensor(crop)).sigmoid()[0,0]
            spatial=spatial_masks((input_tensor(crop)[:,3:]+1)/2)
            for mask,value in {'opening':spatial['opening'][0,0],'majority':spatial['majority'][0,0],'learned_soft':p,'learned_half':.5+.5*p,'learned_hard':(p>=.5).float()}.items():
                value.cpu().numpy().astype('<f4').tofile(dest/f'{index}.{mask}')
        (dest/'manifest.json').write_text(json.dumps(dict(width=160,height=160,native_source=str(source),samples=chosen,
                    original_manifest_sha256=sha(source/'manifest.json'),selection='first32 per condition,8 conditions; no test-score selection')))
        print(run,'synthetic',len(chosen),flush=True)


if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('action',choices=['train','evaluate','synthetic']);ap.add_argument('--run',choices=['finetune','scratch'],default='finetune');ap.add_argument('--epochs',type=int,default=6);ap.add_argument('--steps',type=int,default=96);ap.add_argument('--rough',action='store_true')
    args=ap.parse_args();globals()[args.action](args)
