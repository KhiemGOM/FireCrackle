"""Compare survival weak supervision and synthetic ownership before real tests."""
import argparse,json,hashlib,time,subprocess
from pathlib import Path
import numpy as np
import torch
from torch.nn import functional as F
from PIL import Image,ImageDraw
from core import MaskNet,OwnershipRenderer,crop_native,input_tensor,spatial_masks,counts,metrics
from render import ROOT
from gpu_render import homography,projected
from survival import SurvivalPatches

OUT=ROOT/'.board/occlusion-mask'
BG=ROOT/'.board/fire-ai/backgrounds'
KINDS=OwnershipRenderer.kinds


def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def validation(renderer,count,seed):
    parts=[]
    for i in range(0,count,64):
        labels=torch.arange(i,i+64,device=renderer.device)%128
        # Balanced conditions, not the easiest random mixture.
        parts.append(renderer.scene(labels,seed+i,kind=KINDS[(i//64)%len(KINDS)]))
    return {k:torch.cat([p[k] for p in parts]) for k in ['x','y','foreign','rgb','kinds']}


@torch.inference_mode()
def predict(model,x):
    model.eval();return torch.cat([model(x[i:i+64]).sigmoid() for i in range(0,len(x),64)])


def preview(rgb,truth,foreign,prob,path):
    rows=min(32,len(rgb));canvas=Image.new('RGB',(8*128,((rows+7)//8)*150),(20,24,31));draw=ImageDraw.Draw(canvas)
    for i in range(rows):
        a=np.uint8(rgb[i].detach().cpu().numpy().transpose(1,2,0)*255)
        mask=np.zeros((64,64,3),np.uint8);mask[:,:,1]=np.uint8(truth[i,0].cpu()*255);mask[:,:,0]=np.uint8(foreign[i,0].cpu()*255)
        estimate=np.uint8(prob[i,0].detach().cpu().numpy()*255)
        pair=np.concatenate([a,mask,np.repeat(estimate[:,:,None],3,2)],axis=1)
        x,y=i%8*128,i//8*150;canvas.paste(Image.fromarray(pair).resize((128,128)),(x,y));draw.text((x+2,y+130),str(i),fill='white')
    canvas.save(path)


def train(args):
    OUT.mkdir(parents=True,exist_ok=True);torch.manual_seed(1701);torch.set_num_threads(4)
    device='cuda' if torch.cuda.is_available() else 'cpu'
    renderer=OwnershipRenderer(np.load(BG/'train.npz')['x'],device)
    val=validation(OwnershipRenderer(np.load(BG/'val.npz')['x'],device),512,40000000)
    real_train=SurvivalPatches('train',device);real_val=SurvivalPatches('val',device).batch(256,41000000)
    model=MaskNet().to(device);optimizer=torch.optim.AdamW(model.parameters(),lr=.0015,weight_decay=.0001)
    scheduler=torch.optim.lr_scheduler.CosineAnnealingLR(optimizer,args.epochs)
    scaler=torch.amp.GradScaler('cuda',enabled=device=='cuda');history=[];best=-1;start=time.perf_counter()
    labels=torch.Generator(device=device).manual_seed(1701)
    for epoch in range(args.epochs):
        model.train();total=0
        for step in range(args.steps):
            y=torch.randint(128,(64,),device=device,generator=labels)
            seed=30000000+epoch*args.steps+step
            if args.source=='survival':scene=real_train.batch(64,seed)
            elif args.source=='mixed':
                synthetic=renderer.scene(y[:32],seed);real=real_train.batch(32,seed)
                scene={k:torch.cat([synthetic[k],real[k]]) for k in ['x','y']}
                scene['valid']=torch.cat([torch.ones_like(synthetic['y']),real['valid']])
            else:scene=renderer.scene(y,seed)
            x,target=scene['x'].clone(),scene['y'].clone();valid=scene.get('valid',torch.ones_like(target)).clone()
            optimizer.zero_grad(set_to_none=True)
            with torch.autocast(device_type=device,dtype=torch.float16,enabled=device=='cuda'):
                logits=model(x);prob=logits.sigmoid()
                bce=(F.binary_cross_entropy_with_logits(logits,target,reduction='none')*valid).sum()/valid.sum().clamp_min(1)
                dice=1-(2*(prob*target*valid).sum((1,2,3))+1)/((prob*valid).sum((1,2,3))+(target*valid).sum((1,2,3))+1)
                loss=bce+dice.mean()
            scaler.scale(loss).backward();scaler.step(optimizer);scaler.update();total+=float(loss.detach())
        scheduler.step();prob=predict(model,val['x'])
        per_kind={k:metrics(counts(prob[val['kinds']==i]>=.5,val['y'][val['kinds']==i],val['foreign'][val['kinds']==i])) for i,k in enumerate(KINDS)}
        # No-target IoU is undefined for a perfect empty prediction; exclude this
        # class from selection, report its false positive area separately.
        synthetic_score=float(np.mean([per_kind[k]['iou'] or 0 for k in KINDS if k!='no_target']))
        rp=predict(model,real_val['x']);rv=real_val['valid'].bool()
        weak_metrics=metrics(counts((rp>=.5)&rv,real_val['y'].bool()&rv,real_val['foreign'].bool()&rv))
        score=(synthetic_score+(weak_metrics['iou'] or 0))/2
        record=dict(epoch=epoch+1,loss=total/args.steps,selection_iou=score,synthetic_macro_iou=synthetic_score,weak_survival=weak_metrics,by_kind=per_kind,seconds=time.perf_counter()-start)
        history.append(record);print(json.dumps(record),flush=True)
        if score>best:
            best=score;torch.save(dict(state_dict=model.state_dict(),epoch=epoch+1),OUT/'best.pt')
        (OUT/'history.json').write_text(json.dumps(history,indent=2))
    checkpoint=torch.load(OUT/'best.pt',map_location=device,weights_only=True);model.load_state_dict(checkpoint['state_dict'])
    # Frozen mask thresholds/blends are declared before real evaluation.
    protocol=dict(seed=1701,training_source=args.source,train_seed_start=30000000,val_seed_start=40000000,test_seed_start=50000000,
                  epochs=args.epochs,steps=args.steps,examples=args.epochs*args.steps*64,
                  parameters=sum(p.numel() for p in model.parameters()),selected_epoch=checkpoint['epoch'],
                  checkpoint_sha256=digest(OUT/'best.pt'),background_manifest_sha256=digest(BG/'manifest.json'),
                  selection='first maximal .5*mean synthetic validation IoU across seven target conditions + .5*weak survival validation IoU; same rule for all three training regimes',
                  masks=['colour','opening','majority','learned_soft','learned_half','learned_hard'],
                  rule='Each mask only multiplies existing sample weights; fixed scorer denominator. learned_half=.5+.5*p; hard threshold=.5.',
                  real_use='100 screened survival training crops;15 later weak-labelled survival selection crops. No real ownership truth. Exclude +/-60frame neighbours of both pools from final survival tests.',
                  real_train_ids=real_train.ids,real_selection_ids=SurvivalPatches('val',device).ids,
                  weak_rule='positive=opaque expected texel and G/R,B/R within .08/.12, gain within .25stops of robust median; transparent expected texels negative; other opaque pixels ignored; inner2x2of4x4 only; known injected occluders negative',
                  survival_train_sha256=digest(ROOT/'.board/fire-ai/survival-curated/train.npz'),survival_review_sha256=digest(ROOT/'.board/fire-ai/survival-curated/review.json'),
                  sources={p.name:digest(p) for p in Path(__file__).parent.glob('*.py')})
    (OUT/'freeze.json').write_text(json.dumps(protocol,indent=2))
    preview(val['rgb'][::16],val['y'][::16],val['foreign'][::16],predict(model,val['x'][::16]),OUT/'validation-preview.png')
    print(json.dumps(protocol),flush=True)


def load_model(device):
    protocol=json.loads((OUT/'freeze.json').read_text());assert protocol['checkpoint_sha256']==digest(OUT/'best.pt')
    model=MaskNet().to(device);model.load_state_dict(torch.load(OUT/'best.pt',map_location=device,weights_only=True)['state_dict']);model.eval()
    return model


@torch.inference_mode()
def masks_for(model,rgb):
    x=input_tensor(rgb);colour=(x[:,3:]+1)/2
    baseline=spatial_masks(colour);p=predict(model,x)
    return {**baseline,'learned_soft':p,'learned_half':.5+.5*p,'learned_hard':(p>=.5).float()}


@torch.inference_mode()
def synthetic():
    torch.set_num_threads(4);device='cuda' if torch.cuda.is_available() else 'cpu';model=load_model(device)
    renderer=OwnershipRenderer(np.load(BG/'val.npz')['x'],device);rows=[];pixel={};directory=OUT/'synthetic';directory.mkdir(exist_ok=True)
    for kind_index,kind in enumerate(KINDS):
        totals={};all_rgb=[];all_truth=[];all_foreign=[];all_prob=[]
        for batch in range(2):
            labels=torch.arange(batch*64,(batch+1)*64,device=device)
            scene=renderer.scene(labels,50000000+kind_index*100+batch,kind=kind)
            masks=masks_for(model,scene['rgb'])
            for name,m in masks.items():
                c=counts(m>=.5,scene['y'],scene['foreign']);totals[name]={k:totals.get(name,{}).get(k,0)+v for k,v in c.items()}
            for i in range(64):
                index=kind_index*128+batch*64+i
                native=np.uint8(scene['image'][i].cpu().numpy().transpose(1,2,0)*255)
                (directory/f'{index}.rgb').write_bytes(native.tobytes())
                # Oracle knows foreign ownership only, not target silhouette.
                (directory/f'{index}.oracle').write_bytes(np.uint8(~scene['occluder'][i,0].cpu().numpy()).tobytes())
                for name,m in masks.items():
                    if name!='colour':m[i,0].cpu().numpy().astype('<f4').tofile(directory/f'{index}.{name}')
                rows.append(dict(id=f'{kind}-{int(labels[i])}',frame=index,quad=(scene['supplied'][i].cpu().numpy()/160).tolist(),
                                 expected=[int(labels[i])//64,int(labels[i])%64//2,bool(int(labels[i])%2)],source=kind,split='validation',has_target=kind!='no_target'))
            all_rgb.append(scene['rgb'][::8]);all_truth.append(scene['y'][::8]);all_foreign.append(scene['foreign'][::8]);all_prob.append(masks['learned_soft'][::8])
        pixel[kind]={k:metrics(v) for k,v in totals.items()};preview(torch.cat(all_rgb),torch.cat(all_truth),torch.cat(all_foreign),torch.cat(all_prob),OUT/f'test-{kind}.png')
    (directory/'manifest.json').write_text(json.dumps(dict(width=160,height=160,samples=rows,oracle=True)))
    (OUT/'synthetic-pixels.json').write_text(json.dumps(pixel,indent=2));print(json.dumps(pixel),flush=True)


@torch.inference_mode()
def real():
    torch.set_num_threads(4);device='cuda' if torch.cuda.is_available() else 'cpu';model=load_model(device)
    datasets={'quad1':ROOT/'FireCrackle/src-tauri/target/actual-quad1','survival':ROOT/'.board/fire-ai/survival',
              'reviewed':ROOT/'.board/fire-ai/baseline-reviewed','additional':ROOT/'.board/boundary-robust/additional'}
    for name,source in datasets.items():
        manifest=json.loads((source/'manifest.json').read_text());w,h=manifest['width'],manifest['height']
        samples=[s for s in manifest['samples'] if s['split']=='validation']
        if name in ['survival','additional']:
            freeze=json.loads((OUT/'freeze.json').read_text());used=[int(s.split('-')[0]) for s in freeze['real_train_ids']+freeze['real_selection_ids']]
            samples=[s for s in samples if all(abs(s['frame']-f)>60 for f in used)]
        for mode in ['exact','rough']:
            destination=OUT/f'{name}-{mode}';destination.mkdir(exist_ok=True);rows=[];frame=-1
            for index,s in enumerate(samples):
                if frame!=s['frame']:
                    frame=s['frame'];image=np.fromfile(source/f'{frame}.rgb',np.uint8).reshape(h,w,3)
                    native=torch.tensor(image.transpose(2,0,1).copy(),device=device).float()[None]/255
                quad=torch.tensor(s['quad'],device=device,dtype=torch.float32)[None]
                if mode=='rough':
                    uv=torch.tensor([[(u-.5)*1.12+.5+.03+(i==1)*.02,(v-.5)*.92+.5-.02+(i==2)*.02] for i,(u,v) in enumerate([(0,0),(1,0),(1,1),(0,1)])],device=device)
                    quad=projected(homography(quad),uv)
                crop=crop_native(native,quad*torch.tensor([w,h],device=device))
                masks=masks_for(model,crop)
                for mask,value in masks.items():
                    if mask!='colour':value[0,0].cpu().numpy().astype('<f4').tofile(destination/f'{index}.{mask}')
                rows.append({**s,'frame':s['frame'],'quad':quad[0].cpu().tolist(),'mask_index':index})
            (destination/'manifest.json').write_text(json.dumps(dict(width=w,height=h,samples=rows,native_source=str(source),original_manifest_sha256=digest(source/'manifest.json'),mode=mode)))
            print(name,mode,len(rows),flush=True)


def codec():
    """Existing exact same codec diagnostic crops; no pixel ownership labels."""
    device='cuda' if torch.cuda.is_available() else 'cpu';model=load_model(device);torch.set_num_threads(4)
    for name in ['uncompressed','h264-crf24','h264-crf32']:
        source=ROOT/'.board/fire-ai/large-bg/codec'/f'{name}.npz';out=OUT/f'codec-{name}';out.mkdir(exist_ok=True);rows=[]
        with np.load(source) as data:images,labels=data['x'],data['y']
        for start in range(0,len(images),64):
            rgb=torch.tensor(images[start:start+64].transpose(0,3,1,2).copy(),device=device).float()/255
            with torch.inference_mode():masks=masks_for(model,rgb)
            for j in range(len(rgb)):
                i=start+j;truth=int(labels[i]);(out/f'{i}.rgb').write_bytes(images[i].tobytes())
                for mask,value in masks.items():
                    if mask!='colour':value[j,0].cpu().numpy().astype('<f4').tofile(out/f'{i}.{mask}')
                rows.append(dict(id=f'{name}-{i}',frame=i,quad=[[0,0],[1,0],[1,1],[0,1]],expected=[truth//64,truth%64//2,bool(truth%2)],source=name,split='validation'))
        (out/'manifest.json').write_text(json.dumps(dict(width=64,height=64,samples=rows,source_sha256=digest(source))))
        print(name,len(rows),flush=True)


def latency():
    torch.set_num_threads(4);results={}
    for device in ['cpu']+(['cuda'] if torch.cuda.is_available() else []):
        model=load_model(device);rgb=torch.ones(1,3,64,64,device=device)*.5
        with torch.inference_mode():
            for _ in range(20):model(input_tensor(rgb)).sigmoid().cpu()
            start=time.perf_counter()
            for _ in range(200):model(input_tensor(rgb)).sigmoid().cpu()
        results[device+'_ms']=(time.perf_counter()-start)*5
    (OUT/'latency.json').write_text(json.dumps(results,indent=2));print(results)


if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('action',choices=['train','synthetic','real','codec','latency']);ap.add_argument('--epochs',type=int,default=8);ap.add_argument('--steps',type=int,default=128)
    ap.add_argument('--source',choices=['synthetic','survival','mixed'],default='survival');ap.add_argument('--run',default='survival');args=ap.parse_args();OUT=OUT/args.run
    if args.action=='train':train(args)
    else:globals()[args.action]()
