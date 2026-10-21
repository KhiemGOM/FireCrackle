"""Research v2: reviewed source crops + hard negatives + dense320px image scan.

Run prepare, record a bool for EVERY positive candidate in review.json, then train.
Geometry is training supervision only; inference is an exhaustive image-only scan.
Nothing writes application labels, and all outputs require manual review.
"""
import argparse
from collections import defaultdict
import importlib.util
import json
import os
from pathlib import Path
import random
import sys
import time
import numpy as np
from PIL import Image, ImageDraw


def crop_box(box, side=320):
    x0,y0,x1,y1=box
    x=int(round((x0+x1-side)/2)); y=int(round((y0+y1-side)/2))
    x=max(0,min(1920-side,x));y=max(12,min(1080-side,y))
    return x,y,x+side,y+side


def dense_boxes():
    # Same <=25% stride overlap as v1, with320px native tiles instead of640px.
    xs=np.linspace(0,1600,8).round().astype(int)
    ys=np.linspace(12,760,5).round().astype(int)
    return [(int(x),int(y),int(x)+320,int(y)+320) for y in ys for x in xs]


def classify_role(source,frame,total):
    if source=='clip2':return 'calibration'
    if source=='survival1':return 'test'
    if source not in ('clip1','quad1'):raise ValueError('Unknown recording role')
    cut=int(total*.8)
    if abs(frame-cut)<=180:return 'excluded_guard'
    return 'train' if frame<cut else 'development'


def validated_review(candidates,review):
    if set(candidates)!=set(review) or any(type(v) is not bool for v in review.values()):
        raise ValueError('Review must supply an explicit boolean for every positive candidate')
    return [i for i in candidates if review[i]]


def load_base(path,data_root):
    # Load canonical bindings from the requested data checkout before the baseline
    # module changes sys.path. No private copy of veil/portal rules.
    sys.path.insert(0,str(data_root/'fire-detection/bench/no_fire'))
    import prepare,veil_native,portal_undo
    spec=importlib.util.spec_from_file_location('image_presence_baseline',path)
    base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
    base.ROOT=data_root
    return base


def resize_crop(rgb,box):
    return np.asarray(Image.fromarray(rgb).crop(box).resize((224,224),Image.Resampling.BILINEAR))


def scan_views(rgb):
    return np.stack([resize_crop(rgb,b) for b in dense_boxes()])


def candidates(base,out):
    rng=random.Random(321);groups=defaultdict(list); metadata={}; provenance={}
    for source in ('clip1','quad1'):
        rows,info=base.target_rows(source,30,24); metadata[source]=rows;provenance[source]=info
        path=base.ROOT/f'fire-detection/data/joined/{source}.jsonl'
        for line in path.open(encoding='utf8'):
            r=json.loads(line)
            if r['n'] not in rows or rows[r['n']]['role']!='train' or not rows[r['n']]['fire']:continue
            lab=r['label'];eligible=[]
            for fire in lab.get('fires',[]):
                if not fire.get('box') or fire.get('vis',0)<.5:continue
                box=np.asarray(fire['box'])*np.array([1920/lab['w'],1080/lab['h']]*2)
                if box[2]-box[0]<24 or box[3]<=12 or box[1]>=1080:continue
                eligible.append((fire,box.tolist()))
            if not eligible:continue
            fire,box=rng.choice(eligible);width=box[2]-box[0]
            group=f"{source}:{fire.get('src','unknown')}:{'24-48' if width<48 else '48-96' if width<96 else '96+'}"
            groups[group].append({'id':f'{source}-{r["n"]}','source':source,'frame':r['n'],
                'source_kind':fire.get('src'),'source_box':box,'crop_box':crop_box(box),
                'visibility':fire['vis'],'group':group})
    for group in groups.values():rng.shuffle(group)
    chosen=[]
    while len(chosen)<192 and any(groups.values()):
        for key in sorted(groups):
            if groups[key] and len(chosen)<192:chosen.append(groups[key].pop())
    (out/'candidate-plan.json').write_text(json.dumps(chosen,indent=2))
    return chosen,metadata,provenance


def contact_sheets(items,out):
    for page in range((len(items)+47)//48):
        sheet=Image.new('RGB',(8*224,6*250),'#20242c');draw=ImageDraw.Draw(sheet)
        for index,item in enumerate(items[page*48:(page+1)*48]):
            arr=np.load(out/item['file']);tile=Image.fromarray(arr[-1]).copy();d=ImageDraw.Draw(tile)
            x0,y0,_,_=item['crop_box'];b=item['source_box']
            scaled=((b[0]-x0)*.7,(b[1]-y0)*.7,(b[2]-x0)*.7,(b[3]-y0)*.7)
            d.rectangle(scaled,outline='cyan',width=1)
            x=(index%8)*224;y=(index//8)*250;sheet.paste(tile,(x,y))
            draw.text((x+2,y+225),item['id'],fill='white')
            draw.text((x+2,y+237),f"{item['source_kind']} w={b[2]-b[0]:.0f} vis={item['visibility']:.2f}",fill='white')
        sheet.save(out/f'positive-review-{page+1}.png')


def prepare(base,out,protocol):
    cache=out/'cache';cache.mkdir(exist_ok=True)
    chosen,metadata,provenance=candidates(base,out)
    by_frame={(i['source'],i['frame']):i for i in chosen}
    dev=[];neg=[];pos=[];rng=random.Random(322)
    for source in ('clip1','quad1'):
        start=time.time();processed=0
        rows=metadata[source]
        for frame,rgb in base.decode(source,30):
            if frame not in rows:continue
            row=rows[frame];role=row['role']
            if role=='excluded_guard' or role=='development' and frame%90:continue
            is_candidate=(source,frame) in by_frame
            is_negative=role=='train' and not row['raw_fire']
            if not is_candidate and not is_negative and role!='development':continue
            auto,detected,_=base.unveil(rgb,y0=12)
            if is_candidate:
                item=by_frame[(source,frame)];box=item['crop_box'];arr=[resize_crop(rgb,box)]
                if detected:arr.append(resize_crop(auto,box))
                item['file']=f'cache/{item["id"]}-positive.npy';np.save(out/item['file'],np.stack(arr));pos.append(item)
            if is_negative:
                boxes=rng.sample(dense_boxes(),4);raw=np.stack([resize_crop(rgb,b) for b in boxes]);arr=[raw]
                if detected:arr.append(np.stack([resize_crop(auto,b) for b in boxes]))
                filename=f'cache/{source}-{frame}-negative.npy';np.save(out/filename,np.stack(arr))
                neg.append({'source':source,'frame':frame,'file':filename,'proposals':4,'raw_fire':False})
            if role=='development':
                arr=[scan_views(rgb)]
                if detected:arr.append(scan_views(auto))
                row['file']=f'cache/{source}-{frame}-development.npy';np.save(out/row['file'],np.concatenate(arr))
                row['guard']=base.translucency_guard(rgb);row['abstain']=row['guard']['abstain'];dev.append(row)
            processed+=1
            if processed%100==0:print(json.dumps({'prepare':source,'processed':processed,'seconds':round(time.time()-start)}),flush=True)
        print(json.dumps({'prepared':source,'seconds':round(time.time()-start)}),flush=True)
    missing=set(i['id'] for i in chosen)-set(i['id'] for i in pos)
    if missing:raise ValueError(f'Missing positive images: {missing}')
    manifest={'positives':pos,'negative_frames':neg,'development':dev,'provenance':provenance,
              'sampled_fit_frames':sum(r['role']=='train' for rows in metadata.values() for r in rows.values())}
    (out/'dataset.json').write_text(json.dumps(manifest,indent=2));contact_sheets(pos,out)
    print(json.dumps({'positive_candidates':len(pos),'negative_frames':len(neg),'development_frames':len(dev),
                      'sampled_fit_frames':manifest['sampled_fit_frames']}),flush=True)


def chunk_logits(model,arr,base,device,batch_size=32):
    import torch
    with torch.inference_mode():
        return np.concatenate([model(base.tensor_views(arr[i:i+batch_size],device)).cpu().numpy()
                               for i in range(0,len(arr),batch_size)])


def development(model,rows,out,base,device):
    model.eval()
    return np.array([chunk_logits(model,np.load(out/r['file']),base,device).max() for r in rows])


def mine_negatives(base,model,items,out,device):
    chosen=[]
    for row in items:
        arr=np.load(out/row['file']);a,p,h,w,c=arr.shape
        scores=chunk_logits(model,arr.reshape(a*p,h,w,c),base,device).reshape(a,p).max(0)
        for index in np.argsort(scores)[-2:]:
            chosen.append({'file':row['file'],'index':int(index),'fire':False,
                           'source':row['source'],'frame':row['frame'],'mining_logit':float(scores[index])})
    (out/'mined-negatives.json').write_text(json.dumps(chosen,indent=2));return chosen


def train(base,out,protocol,baseline_run):
    import torch
    random.seed(321);np.random.seed(321);torch.manual_seed(321);torch.set_num_threads(4)
    device=torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    data=json.loads((out/'dataset.json').read_text());review=json.loads((out/'review.json').read_text())
    approved=set(validated_review([p['id'] for p in data['positives']],review))
    if not approved:raise ValueError('No verified positive crops')
    # Mine only confirmed no-fire frames from the fit recordings, never calibration/test.
    miner=base.make_model(pretrained=False).to(device).eval()
    miner.load_state_dict(torch.load(baseline_run/'best.pt',map_location=device,weights_only=False)['state'])
    negatives=mine_negatives(base,miner,data['negative_frames'],out,device);del miner
    positives=[dict(r,fire=True) for r in data['positives'] if r['id'] in approved]
    samples=positives+negatives
    # Small crop corpus fits in memory. Each item retains raw/auto variants.
    arrays=[]
    for item in samples:
        arr=np.load(out/item['file'])
        arrays.append(arr[:,item['index']] if not item['fire'] else arr)
    model=base.make_model(pretrained=True).to(device)
    optimizer=torch.optim.AdamW([{'params':model.features.parameters(),'lr':.00005},
                                {'params':model.head.parameters(),'lr':.0005}],weight_decay=.001)
    counts=[len(negatives),len(positives)];weights=[len(samples)/(2*n) for n in counts]
    history=[];best=float('inf');start=time.time()
    for epoch in range(8):
        model.train();model.features.eval()
        for param in model.features.parameters():param.requires_grad_(False)
        if epoch>=2:
            for block in list(model.features.children())[-3:]:
                for param in block.parameters():param.requires_grad_(True)
        losses=[];order=np.random.permutation(len(samples))
        for start_idx in range(0,len(order),32):
            indexes=order[start_idx:start_idx+32];images=[]
            for index in indexes:
                arr=arrays[index];image=arr[random.randrange(len(arr))]
                if random.random()<.5:image=image[:,::-1]
                brightness=random.uniform(.85,1.15)
                images.append(np.clip(image.astype(np.float32)*brightness,0,255).astype(np.uint8))
            logits=model(base.tensor_views(np.stack(images),device))
            truth=torch.tensor([samples[i]['fire'] for i in indexes],device=device,dtype=torch.float32)
            weight=torch.tensor([weights[int(samples[i]['fire'])] for i in indexes],device=device)
            loss=(torch.nn.functional.binary_cross_entropy_with_logits(logits,truth,reduction='none')*weight).mean()
            optimizer.zero_grad();loss.backward();optimizer.step();losses.append(float(loss.detach()))
        dev=development(model,data['development'],out,base,device)
        dev_loss=float(torch.nn.functional.binary_cross_entropy_with_logits(torch.tensor(dev),
                     torch.tensor([r['fire'] for r in data['development']],dtype=torch.float32)))
        entry={'epoch':epoch+1,'crop_loss':float(np.mean(losses)),'development_frame_loss':dev_loss,
               'seconds':round(time.time()-start)};history.append(entry);print(json.dumps(entry),flush=True)
        (out/'history.json').write_text(json.dumps(history,indent=2))
        if dev_loss<best:
            best=dev_loss;torch.save({'state':model.state_dict(),'epoch':epoch+1,'protocol':protocol},out/'best.pt')
    checkpoint=torch.load(out/'best.pt',map_location=device,weights_only=False);model.load_state_dict(checkpoint['state']);model.eval()
    freeze={'epoch':checkpoint['epoch'],'weights_sha256':base.sha(out/'best.pt'),
            'review_sha256':base.sha(out/'review.json'),'positive_crops':len(positives),
            'negative_crops':len(negatives),'sampled_fit_frames':data['sampled_fit_frames'],
            'development_frames':len(data['development']),'best_development_frame_loss':best}
    (out/'freeze.json').write_text(json.dumps(freeze,indent=2))
    return model,device,freeze


def evaluate(base,out,model,device,freeze,protocol,baseline_run):
    report={'protocol':protocol,'freeze':freeze,'recordings':{}}
    for source in ('clip2','survival1'):
        reference=json.loads((baseline_run/'cache'/f'{source}.json').read_text())['rows']
        wanted={r['frame']:dict(r) for r in reference};rows=[];scores=[];start=time.time()
        for frame,rgb in base.decode(source,90):
            if frame not in wanted:continue
            auto,detected,_=base.unveil(rgb,y0=12);arr=scan_views(rgb)
            if detected:arr=np.concatenate([arr,scan_views(auto)])
            score=float(chunk_logits(model,arr,base,device).max());row=wanted[frame]
            row['score']=score;row['guard']=base.translucency_guard(rgb);row['abstain']=row['guard']['abstain']
            # Store thumbnails only; no generated per-frame labels enter app data.
            filename=f'{source}-{frame}.jpg';Image.fromarray(rgb).resize((384,216)).save(out/'cache'/filename,quality=85)
            row['thumbnail']='cache/'+filename;rows.append(row);scores.append(score)
            if len(rows)%100==0:print(json.dumps({'evaluate':source,'frames':len(rows),'seconds':round(time.time()-start)}),flush=True)
        if len(rows)!=len(wanted):raise ValueError('Evaluation frame IDs differ from baseline')
        scores=np.array(scores)
        if source=='clip2':
            threshold=base.clear_threshold(scores,[r['fire'] for r in rows])
            (out/'calibration.json').write_text(json.dumps({'threshold':threshold,'weights_sha256':freeze['weights_sha256']}))
        metrics=base.metrics(rows,scores,threshold);report['recordings'][source]=metrics
        (out/f'{source}-predictions.json').write_text(json.dumps(rows,indent=2))
        clear=base.decisions(scores,threshold,[r['abstain'] for r in rows])
        errors=[r for r,c in zip(rows,clear) if c and r['fire']];clears=[r for r,c in zip(rows,clear) if c and not r['fire']]
        base.sheet(errors,out,out/f'{source}-false-clears.png','FALSE CLEAR')
        base.sheet(clears[::max(1,len(clears)//24)],out,out/f'{source}-correct-clears.png','CLEAR')
        report['threshold_logit']=threshold;(out/'report.json').write_text(json.dumps(report,indent=2))
        print(json.dumps({'evaluated':source,**metrics}),flush=True)


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('stage',choices=['prepare','train']);ap.add_argument('out',type=Path)
    ap.add_argument('--data-root',type=Path,default=Path(__file__).resolve().parents[3])
    ap.add_argument('--baseline-source',type=Path,default=Path(__file__).with_name('pipeline.py'))
    ap.add_argument('--baseline-run',type=Path,required=True)
    args=ap.parse_args();out=args.out.resolve();out.mkdir(parents=True,exist_ok=True)
    base=load_base(args.baseline_source.resolve(),args.data_root.resolve())
    os.environ['TORCH_HOME']=str(args.baseline_run.resolve()/'torch')
    core=base.ROOT/'fire-detection/core/src'
    protocol={'version':2,'source_sha256':base.sha(__file__),'baseline_source_sha256':base.sha(args.baseline_source),
        'preprocessing_sha256':{n:base.sha(core/n) for n in ('veil.rs','veil_abi.rs','portal.rs')},
        'architecture':'ImageNet MobileNetV3-Small,576-128-1 crop head; max of40native320px overlapping tiles',
        'fit_stride':30,'development_calibration_test_stride':90,'positive_candidates':192,'min_source_width':24,
        'positive_visibility_min':.5,'review':'Explicit human/agent visual review of all proposed positives before fitting',
        'negative_mining':'Two hardest of4random320px crops per true no-fire fit frame, scored by frozen v1 model',
        'seed':321,'epochs':8,'frozen_epochs':2,'batch_crops':32,'backbone_lr':.00005,'head_lr':.0005,
        'brightness':[.85,1.15],'horizontal_flip_probability':.5,'split':'Same as v1, no fit/calibration/test recording overlap',
        'checkpoint':'Minimum development whole-frame BCE, before calibration and survival scoring',
        'clearing':'Strictly below minimum meaningful-fire calibration score plus canonical translucency abstention',
        'status':'Research only; excluded from0.2.1; survival is a familiar diagnostic set, not fresh independent validation'}
    pp=out/'protocol.json'
    if pp.exists() and json.loads(pp.read_text())!=protocol:raise ValueError('Changed protocol; use fresh directory')
    pp.write_text(json.dumps(protocol,indent=2))
    if args.stage=='prepare':prepare(base,out,protocol)
    else:
        model,device,freeze=train(base,out,protocol,args.baseline_run.resolve())
        evaluate(base,out,model,device,freeze,protocol,args.baseline_run.resolve())


if __name__=='__main__':main()
