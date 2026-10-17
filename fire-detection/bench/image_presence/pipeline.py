"""Offline tiled image-CNN pilot. Never edits application labels or auto-confirms frames.

All pixels come from recordings, never label geometry. Geometry is used only for
the width24 frame target and diagnostic drawings. Frame bags use max pooling:
a positive frame does NOT incorrectly make every background tile a positive.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import random
import subprocess
import sys
import time

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT/'fire-detection/bench/no_fire'))
from prepare import SOURCES
from veil_native import apply as unveil
from portal_undo import translucency_guard


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024*1024), b''): digest.update(chunk)
    return digest.hexdigest()


def tile_boxes(width, height, side=640):
    """Four horizontal by two vertical overlapping windows at 1920x1080."""
    side = min(side, width, height)
    nx = max(1, int(np.ceil((width-side)/(side*.75)))+1)
    ny = max(1, int(np.ceil((height-side)/(side*.75)))+1)
    return [(int(x),int(y),int(x)+side,int(y)+side)
            for y in np.linspace(0,height-side,ny).round().astype(int)
            for x in np.linspace(0,width-side,nx).round().astype(int)]


def strip_crop(rgb):
    return rgb[max(1,int(rgb.shape[0]*.012)):]


def views(rgb, size=224):
    image = Image.fromarray(strip_crop(rgb))
    boxes = tile_boxes(*image.size)
    return np.stack([np.asarray(image.resize((size,size),Image.Resampling.BILINEAR))] +
                    [np.asarray(image.crop(b).resize((size,size),Image.Resampling.BILINEAR)) for b in boxes])


def split_role(source, frame, total):
    if source == 'clip2': return 'calibration'
    if source == 'survival1': return 'test'
    cut = int(total*.8)
    if abs(frame-cut) <= 180: return 'excluded_guard'
    return 'train' if frame < cut else 'development'


def clear_threshold(scores, fire):
    scores = np.asarray(scores); fire = np.asarray(fire, bool)
    if not np.isfinite(scores).all() or not fire.any():
        raise ValueError('Calibration requires finite scores and meaningful fire')
    return float(scores[fire].min())


def decisions(scores, threshold, abstain):
    scores = np.asarray(scores)
    return np.isfinite(scores) & (scores < threshold) & ~np.asarray(abstain,bool)


def target_rows(source, stride, min_width):
    path = ROOT/f'fire-detection/data/joined/{source}.jsonl'
    rows = {}; total = 0; rejected = 0
    with path.open(encoding='utf8') as stream:
        for line in stream:
            r = json.loads(line); total = max(total,r['n']+1)
            if r['n'] % stride: continue
            label = r.get('label')
            if (not r.get('tick_ok') or not isinstance(label,dict) or
                not isinstance(label.get('fire'),bool) or bool(label.get('fires')) != label['fire']):
                rejected += 1; continue
            boxes = [(np.asarray(f['box'],float)*np.array([1920/label['w'],1080/label['h']]*2)).tolist()
                     for f in label.get('fires',[]) if f.get('box')]
            # Missing geometry for a reported fire is unknown, not a negative.
            if label['fire'] and not boxes:
                rejected += 1; continue
            meaningful = any(b[2]-b[0] >= min_width for b in boxes)
            rows[r['n']] = {'source':source,'frame':r['n'],'fire':meaningful,
                'raw_fire':label['fire'],'boxes':boxes,
                'truth_veiled':any(f.get('veil',0)>=.6 for f in label.get('fires',[]))}
    for row in rows.values(): row['role'] = split_role(source,row['frame'],total)
    return rows, {'joined_sha256':sha(path),'total_frames':total,'rejected_sampled_labels':rejected}


def decode(source, stride):
    video = ROOT/'fire-detection/data/video'/SOURCES[source]
    binary = ROOT/'FireCrackle/src-tauri/runtime/ffmpeg.exe'
    command = [str(binary),'-v','error','-threads','3','-i',str(video),'-vf',
               f'select=not(mod(n\\,{stride})),scale=1920:1080',
               '-fps_mode','passthrough','-pix_fmt','rgb24','-f','rawvideo','pipe:1']
    proc = subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    try:
        n = 0; size = 1920*1080*3
        while True:
            raw = bytearray()
            while len(raw)<size:
                chunk = proc.stdout.read(size-len(raw))
                if not chunk: break
                raw.extend(chunk)
            if not raw: break
            if len(raw)!=size: raise RuntimeError('Truncated video frame')
            yield n,np.frombuffer(raw,np.uint8).reshape(1080,1920,3)
            n += stride
        error = proc.stderr.read().decode(errors='replace')
        if proc.wait(): raise RuntimeError(error)
    finally:
        if proc.poll() is None: proc.terminate();proc.wait()
        proc.stdout.close();proc.stderr.close()


def prepare(out, protocol):
    cache = out/'cache'; cache.mkdir(exist_ok=True)
    provenance = {}; all_rows = []
    for source in SOURCES:
        targets, info = target_rows(source,protocol['stride'],protocol['min_width'])
        info['video_sha256'] = sha(ROOT/'fire-detection/data/video'/SOURCES[source])
        provenance[source] = info
        manifest = cache/f'{source}.json'
        if manifest.exists():
            saved = json.loads(manifest.read_text())
            if saved['provenance'] != info or saved['preprocessing_sha256'] != protocol['preprocessing_sha256'] or saved['pipeline_sha256'] != protocol['pipeline_sha256']:
                raise ValueError('Stale cache: use a new output directory')
            all_rows += saved['rows']; continue
        rows = []; start = time.time(); seen = set()
        for frame,rgb in decode(source,protocol['stride']):
            if frame not in targets: continue
            seen.add(frame); row = targets[frame]
            corrected,detected,share = unveil(rgb,y0=max(1,int(rgb.shape[0]*.012)))
            guard = translucency_guard(rgb)
            raw_views = views(rgb)
            arr = np.concatenate([raw_views,views(corrected)]) if detected else raw_views
            stem = f'{source}-{frame}'
            np.save(cache/f'{stem}.npy', arr)
            Image.fromarray(rgb).resize((384,216)).save(cache/f'{stem}.jpg',quality=85)
            row.update({'file':f'cache/{stem}.npy','thumbnail':f'cache/{stem}.jpg',
                        'raw_views':len(raw_views),'auto_unveil':detected,'veil_share':share,
                        'abstain':guard['abstain'],'guard':guard})
            rows.append(row)
            if len(rows)%100==0: print(json.dumps({'preparing':source,'frames':len(rows),'seconds':round(time.time()-start)}),flush=True)
        if seen != set(targets): raise ValueError(f'{source}: video/labels mismatch: {len(set(targets)-seen)} missing samples')
        manifest.write_text(json.dumps({'provenance':info,'preprocessing_sha256':protocol['preprocessing_sha256'],
                                       'pipeline_sha256':protocol['pipeline_sha256'],'rows':rows}))
        all_rows += rows
        print(json.dumps({'prepared':source,'frames':len(rows),'seconds':round(time.time()-start)}),flush=True)
    (out/'dataset.json').write_text(json.dumps({'provenance':provenance,'rows':all_rows},indent=2))
    return all_rows


def make_model(pretrained=True):
    import torch
    from torchvision.models import mobilenet_v3_small, MobileNet_V3_Small_Weights
    class BagModel(torch.nn.Module):
        def __init__(self):
            super().__init__()
            base = mobilenet_v3_small(weights=MobileNet_V3_Small_Weights.DEFAULT if pretrained else None)
            self.features = base.features
            self.head = torch.nn.Sequential(torch.nn.Linear(576,128),torch.nn.ReLU(),
                                            torch.nn.Dropout(.2),torch.nn.Linear(128,1))
        def forward(self,x):
            # x: images, returns one logit per view. Frame score is maximum over views.
            return self.head(self.features(x).mean((2,3))).squeeze(-1)
    return BagModel()


def tensor_views(arr, device):
    import torch
    x = torch.from_numpy(np.asarray(arr).copy()).permute(0,3,1,2).to(device,dtype=torch.float32)/255
    mean = x.new_tensor([.485,.456,.406])[None,:,None,None]
    std = x.new_tensor([.229,.224,.225])[None,:,None,None]
    return (x-mean)/std


def score(model, rows, out, device):
    import torch
    model.eval(); scores = []
    with torch.inference_mode():
        for row in rows:
            arr = np.load(out/row['file'])
            # Maximum of both raw + canonical conditional-unveil views.
            logit = model(tensor_views(arr,device)).max()
            scores.append(float(logit.cpu()))
    return np.array(scores)


def train(out, rows, protocol):
    import torch
    random.seed(protocol['seed']);np.random.seed(protocol['seed']);torch.manual_seed(protocol['seed'])
    torch.set_num_threads(4)
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    model = make_model().to(device)
    train_rows = [r for r in rows if r['role']=='train']
    dev = [r for r in rows if r['role']=='development']
    if len({r['fire'] for r in train_rows})<2 or not dev: raise ValueError('Both train classes and development data required')
    npos = sum(r['fire'] for r in train_rows); nneg = len(train_rows)-npos
    weights = [len(train_rows)/(2*nneg),len(train_rows)/(2*npos)]
    optimizer = torch.optim.AdamW([{'params':model.features.parameters(),'lr':protocol['backbone_lr']},
                                   {'params':model.head.parameters(),'lr':protocol['head_lr']}],weight_decay=.001)
    best = float('inf'); history = []; start = time.time()
    for epoch in range(protocol['epochs']):
        model.train()
        # Keep pretrained batch statistics fixed for small bags/limited recordings.
        model.features.eval()
        for param in model.features.parameters(): param.requires_grad_(False)
        if epoch >= protocol['frozen_epochs']:
            for block in list(model.features.children())[-3:]:
                for param in block.parameters(): param.requires_grad_(True)
        order = np.random.permutation(len(train_rows)); losses=[]
        for start_idx in range(0,len(order),protocol['batch_frames']):
            batch = [train_rows[i] for i in order[start_idx:start_idx+protocol['batch_frames']]]
            bags = []
            for row in batch:
                arr = np.load(out/row['file']); k = row['raw_views']
                offset = k if len(arr)>k and random.random()<.5 else 0
                x = tensor_views(arr[offset:offset+k],device)
                if random.random()<.5: x = x.flip(-1)
                bags.append(x)
            k = len(bags[0]); logits = model(torch.cat(bags)).reshape(len(batch),k).max(1).values
            targets = torch.tensor([r['fire'] for r in batch],device=device,dtype=torch.float32)
            sample_weights = torch.tensor([weights[int(r['fire'])] for r in batch],device=device)
            loss = (torch.nn.functional.binary_cross_entropy_with_logits(logits,targets,reduction='none')*sample_weights).mean()
            optimizer.zero_grad();loss.backward();optimizer.step();losses.append(float(loss.detach()))
        dev_scores = score(model,dev,out,device)
        dev_loss = float(torch.nn.functional.binary_cross_entropy_with_logits(torch.tensor(dev_scores),torch.tensor([r['fire'] for r in dev],dtype=torch.float64)))
        entry = {'epoch':epoch+1,'train_loss':float(np.mean(losses)),'development_loss':dev_loss,'seconds':round(time.time()-start)}
        history.append(entry);print(json.dumps(entry),flush=True)
        (out/'history.json').write_text(json.dumps(history,indent=2))
        if dev_loss<best:
            best = dev_loss
            torch.save({'state':model.state_dict(),'epoch':epoch+1,'protocol':protocol},out/'best.pt')
    checkpoint = torch.load(out/'best.pt',map_location=device,weights_only=False)
    model.load_state_dict(checkpoint['state'])
    # Save selection evidence before any calibration or test scoring.
    freeze = {'selected_epoch':checkpoint['epoch'],'best_development_loss':best,
              'weights_sha256':sha(out/'best.pt'),'device':str(device),'torch':torch.__version__,
              'training_frames':len(train_rows),'development_frames':len(dev)}
    (out/'freeze.json').write_text(json.dumps(freeze,indent=2))
    return model, device, freeze


def metrics(rows,scores,threshold):
    fire = np.array([r['fire'] for r in rows],bool); abstain = np.array([r['abstain'] for r in rows],bool)
    clear = decisions(scores,threshold,abstain)
    unguarded = decisions(scores,threshold,np.zeros(len(rows),bool))
    counts = {'frames':len(rows),'meaningful_fire':int(fire.sum()),'clear_eligible':int((~fire).sum()),
              'correct_clears':int((clear&~fire).sum()),'false_clears':int((clear&fire).sum()),
              'translucency_abstentions':int(abstain.sum()),'unguarded_false_clears':int((unguarded&fire).sum()),
              'unguarded_correct_clears':int((unguarded&~fire).sum())}
    counts['clear_coverage'] = counts['correct_clears']/max(1,counts['clear_eligible'])
    counts['false_clear_rate'] = counts['false_clears']/max(1,counts['meaningful_fire'])
    counts['at_logit_zero'] = {'false_clears':int(((scores<0)&fire).sum()),'correct_clears':int(((scores<0)&~fire).sum())}
    # ROC area, grouping tied scores rather than ordering ties arbitrarily.
    if fire.any() and (~fire).any():
        order = np.argsort(-scores,kind='stable'); s = scores[order]; y = fire[order]
        ends = np.r_[np.flatnonzero(s[:-1]!=s[1:]),len(s)-1]
        tp = np.r_[0,np.cumsum(y)[ends]]/fire.sum()
        fp = np.r_[0,np.cumsum(~y)[ends]]/(~fire).sum()
        counts['roc_auc'] = float(np.trapezoid(tp,fp))
    return counts


def sheet(rows,out,path,title):
    rows = rows[:24]
    if not rows: return
    image = Image.new('RGB',(384*4,252*((len(rows)+3)//4)), '#20242c')
    for i,row in enumerate(rows):
        thumb = Image.open(out/row['thumbnail']).convert('RGB');d=ImageDraw.Draw(thumb)
        for b in row['boxes']: d.rectangle(tuple(v/5 for v in b),outline='red',width=1)
        x,y=(i%4)*384,(i//4)*252;image.paste(thumb,(x,y))
        ImageDraw.Draw(image).text((x+3,y+218),f"{title} {row['source']} #{row['frame']} fire={row['fire']}",fill='white')
        if 'score' in row: ImageDraw.Draw(image).text((x+3,y+233),f"logit={row['score']:.3f} guard={row['abstain']}",fill='white')
    image.save(path)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('out',type=Path);ap.add_argument('--stride',type=int,default=90)
    ap.add_argument('--epochs',type=int,default=10);ap.add_argument('--min-width',type=float,default=24)
    args = ap.parse_args();out=args.out.resolve();out.mkdir(parents=True,exist_ok=True)
    if args.stride<1 or args.epochs<1 or args.min_width<0: ap.error('Invalid sampling/training settings')
    os.environ['TORCH_HOME']=str(out/'torch')
    core = ROOT/'fire-detection/core/src'
    protocol = {'architecture':'ImageNet MobileNetV3-Small, max over frame views, 576-128-1 head',
        'seed':321,'stride':args.stride,'epochs':args.epochs,'frozen_epochs':2,'batch_frames':4,
        'backbone_lr':.0001,'head_lr':.001,'min_width':args.min_width,
        'preprocessing_sha256':{name:sha(core/name) for name in ['veil.rs','veil_abi.rs','portal.rs']},
        'pipeline_sha256':sha(__file__),'views':'224px whole screen plus overlapping native640px tiles, top1.2% stripped',
        'branches':'random raw/auto per training frame; maximum across raw+auto in scoring',
        'split':'clip1+quad1 first80% train, last20% development, +/-180frame guard; clip2 calibration; survival1 test',
        'threshold':'strictly below minimum meaningful-fire logit on calibration; purple/supplied-translucency guard abstains',
        'limitations':['Exploratory familiar recordings, not pristine external holdout',
                       'Width24 label geometry is an approximate visibility proxy',
                       'No automatic water/glass/ice recognition; no guard hit does not prove opacity',
                       'Manual review only; never writes app labels']}
    protocol_path = out/'protocol.json'
    if protocol_path.exists() and json.loads(protocol_path.read_text()) != protocol:
        raise ValueError('Protocol differs; use a new output directory')
    protocol_path.write_text(json.dumps(protocol,indent=2))
    rows = prepare(out,protocol)
    summary = {role: {'frames':sum(r['role']==role for r in rows),
                     'fire':sum(r['role']==role and r['fire'] for r in rows)}
               for role in ['train','development','calibration','test','excluded_guard']}
    print(json.dumps({'dataset':summary}),flush=True)
    train_rows = [r for r in rows if r['role']=='train']
    sheet(train_rows[::max(1,len(train_rows)//24)],out,out/'training-preview.png','TRAIN')
    model,device,freeze = train(out,rows,protocol)
    calibration = [r for r in rows if r['role']=='calibration']
    cal_scores = score(model,calibration,out,device)
    threshold = clear_threshold(cal_scores,[r['fire'] for r in calibration])
    (out/'calibration.json').write_text(json.dumps({'threshold':threshold,'weights_sha256':freeze['weights_sha256']}))
    report = {'protocol':protocol,'freeze':freeze,'dataset':summary,'threshold_logit':threshold,'roles':{},'recordings':{}}
    for role in ['development','calibration','test']:
        subset = [r for r in rows if r['role']==role]
        scores = cal_scores if role=='calibration' else score(model,subset,out,device)
        report['roles'][role] = metrics(subset,scores,threshold)
        for row,s in zip(subset,scores): row['score']=float(s)
        for source in sorted({r['source'] for r in subset}):
            mask = np.array([r['source']==source for r in subset])
            report['recordings'][source] = metrics([r for r in subset if r['source']==source],scores[mask],threshold)
        clear = decisions(scores,threshold,[r['abstain'] for r in subset])
        errors = [r for r,c in zip(subset,clear) if c and r['fire']]
        clears = [r for r,c in zip(subset,clear) if c and not r['fire']]
        sheet(errors,out,out/f'{role}-false-clears.png','FALSE CLEAR')
        sheet(clears[::max(1,len(clears)//24)],out,out/f'{role}-correct-clears.png','CLEAR')
        (out/f'{role}-predictions.json').write_text(json.dumps(subset,indent=2))
    (out/'report.json').write_text(json.dumps(report,indent=2))
    print(json.dumps({'result':report['roles'],'weights':freeze}),flush=True)


if __name__=='__main__': main()
