"""Paired research continuation: V1 bag replay, with/without reviewed-positive auxiliary loss.

No label writing, no release integration. Protocol precedes fitting and calibration
precedes survival scoring. Survival is a familiar diagnostic, never a fresh holdout.
"""
import argparse
import json
from pathlib import Path
import random
import time
import numpy as np
import torch
from crop_v2 import load_base, validated_review


def fitting_crops(data, review):
    approved=set(validated_review([p['id'] for p in data['positives']],review))
    result=[p for p in data['positives'] if p['id'] in approved]
    for row in result:
        if row['source'] not in ('clip1','quad1') or not row.get('file'):
            raise ValueError('Auxiliary crops must belong to fitting recordings')
    return result


def validate_crop_roles(crops, base):
    fitting={}
    for source in ('clip1','quad1'):
        fitting[source]=base.target_rows(source,30,24)[0]
    for crop in crops:
        row=fitting[crop['source']].get(crop['frame'])
        if row is None or row['role']!='train' or not row['fire']:
            raise ValueError('Crop is not a meaningful-fire fitting frame')


def score_views(base,model,rows,cache,device):
    values=[]; winners=[]
    model.eval()
    with torch.inference_mode():
        for row in rows:
            arr=np.load(cache/row['file'])
            logits=model(base.tensor_views(arr,device)).cpu().numpy()
            values.append(float(logits.max()));winners.append(int(logits.argmax()))
    return np.array(values),winners


def run_arm(name, weight, base, baseline, crop_run, out, rows, crops, protocol, device):
    dest=out/name;dest.mkdir()
    random.seed(321);np.random.seed(321);torch.manual_seed(321)
    model=base.make_model(pretrained=False).to(device)
    model.load_state_dict(torch.load(baseline/'best.pt',map_location=device,weights_only=False)['state'])
    for p in model.features.parameters():p.requires_grad_(False)
    for block in list(model.features.children())[-3:]:
        for p in block.parameters():p.requires_grad_(True)
    train=[r for r in rows if r['role']=='train'];dev=[r for r in rows if r['role']=='development']
    if len(train)!=350 or len(dev)!=83:raise ValueError('Baseline frame IDs changed')
    pos=sum(r['fire'] for r in train);weights=[len(train)/(2*(len(train)-pos)),len(train)/(2*pos)]
    optimizer=torch.optim.AdamW([{'params':model.features.parameters(),'lr':1e-5},
                                {'params':model.head.parameters(),'lr':1e-4}],weight_decay=.001)
    crop_arrays=[np.load(crop_run/r['file']) for r in crops]
    crop_rng=np.random.default_rng(944)
    best=float('inf');history=[];started=time.time()
    for epoch in range(protocol['epochs']+1):
        losses=[]
        if epoch:
            model.train();model.features.eval()
            order=np.random.permutation(len(train))
            for start in range(0,len(order),4):
                batch=[train[i] for i in order[start:start+4]];bags=[]
                for row in batch:
                    arr=np.load(baseline/row['file']);k=row['raw_views']
                    offset=k if len(arr)>k and random.random()<.5 else 0
                    x=base.tensor_views(arr[offset:offset+k],device)
                    if random.random()<.5:x=x.flip(-1)
                    bags.append(x)
                logits=model(torch.cat(bags)).reshape(len(batch),bags[0].shape[0]).max(1).values
                targets=torch.tensor([r['fire'] for r in batch],device=device,dtype=torch.float32)
                sw=targets.new_tensor([weights[int(r['fire'])] for r in batch])
                bag_loss=(torch.nn.functional.binary_cross_entropy_with_logits(logits,targets,reduction='none')*sw).mean()
                loss=bag_loss
                if weight:
                    # Separate RNG keeps the next bag/dropout stream paired with control.
                    arr=np.stack([crop_arrays[i][int(crop_rng.integers(len(crop_arrays[i])))]
                                  for i in crop_rng.integers(len(crop_arrays),size=4)])
                    with torch.random.fork_rng(devices=[device.index or 0] if device.type=='cuda' else []):
                        crop_logits=model(base.tensor_views(arr,device))
                    loss=loss+weight*torch.nn.functional.softplus(-crop_logits).mean()
                optimizer.zero_grad();loss.backward();optimizer.step();losses.append(float(loss.detach()))
        scores,_=score_views(base,model,dev,baseline,device)
        dev_loss=float(torch.nn.functional.binary_cross_entropy_with_logits(torch.tensor(scores),torch.tensor([r['fire'] for r in dev],dtype=torch.float64)))
        entry={'epoch':epoch,'bag_plus_aux_train_loss':float(np.mean(losses)) if losses else None,
               'development_loss':dev_loss,'seconds':round(time.time()-started)}
        history.append(entry);print(json.dumps({'arm':name,**entry}),flush=True)
        (dest/'history.json').write_text(json.dumps(history,indent=2))
        if dev_loss<best:
            best=dev_loss;torch.save({'state':model.state_dict(),'epoch':epoch,'protocol':protocol,'arm':name},dest/'best.pt')
    checkpoint=torch.load(dest/'best.pt',map_location=device,weights_only=False);model.load_state_dict(checkpoint['state'])
    freeze={'selected_epoch':checkpoint['epoch'],'development_loss':best,'weights_sha256':base.sha(dest/'best.pt')}
    (dest/'freeze.json').write_text(json.dumps(freeze,indent=2))
    report={'protocol':protocol,'arm':name,'auxiliary_weight':weight,'freeze':freeze,'roles':{},'recordings':{}}
    threshold=None
    for role in ('calibration','development','test'):
        subset=[r for r in rows if r['role']==role];scores,winners=score_views(base,model,subset,baseline,device)
        if role=='calibration':
            threshold=base.clear_threshold(scores,[r['fire'] for r in subset])
            (dest/'calibration.json').write_text(json.dumps({'threshold':threshold,'weights_sha256':freeze['weights_sha256']}))
        report['roles'][role]=base.metrics(subset,scores,threshold)
        predicted=[dict(r,score=float(s),winning_view=int(win)) for r,s,win in zip(subset,scores,winners)]
        (dest/f'{role}-predictions.json').write_text(json.dumps(predicted,indent=2))
        for source in sorted({r['source'] for r in subset}):
            mask=np.array([r['source']==source for r in subset]);report['recordings'][f'{role}:{source}']=base.metrics([r for r in subset if r['source']==source],scores[mask],threshold)
        clear=base.decisions(scores,threshold,[r['abstain'] for r in subset])
        for label,items in [('correct-clears',[r for r,c in zip(predicted,clear) if c and not r['fire']]),
                            ('false-clears',[r for r,c in zip(predicted,clear) if c and r['fire']])]:
            for start in range(0,len(items),24):base.sheet(items[start:start+24],baseline,dest/f'{role}-{label}-{start//24}.png',label)
    report['threshold_logit']=threshold
    (dest/'report.json').write_text(json.dumps(report,indent=2))
    print(json.dumps({'arm':name,'result':report['roles']}),flush=True)
    return report


def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('out',type=Path)
    ap.add_argument('--data-root',type=Path,required=True);ap.add_argument('--baseline-run',type=Path,required=True)
    ap.add_argument('--crop-run',type=Path,required=True);args=ap.parse_args()
    out=args.out.resolve();out.mkdir(parents=True,exist_ok=True)
    if (out/'protocol.json').exists():raise ValueError('Use a fresh output directory')
    base=load_base(Path(__file__).with_name('pipeline.py'),args.data_root.resolve())
    baseline=args.baseline_run.resolve();crop_run=args.crop_run.resolve()
    prior=json.loads((baseline/'protocol.json').read_text());rows=json.loads((baseline/'dataset.json').read_text())['rows']
    for name,digest in prior['preprocessing_sha256'].items():
        if base.sha(args.data_root/'fire-detection/core/src'/name)!=digest:raise ValueError('Shared preprocessing changed')
    data=json.loads((crop_run/'dataset.json').read_text());review=json.loads((crop_run/'review.json').read_text())
    crops=fitting_crops(data,review);validate_crop_roles(crops,base)
    protocol={'version':3,'hypothesis':'Auxiliary verified-positive crops improve V1 without losing frame-context/bag supervision',
              'arms':{'control':0.,'positive_aux':.2},'epochs':4,'seed':321,'warm_start_sha256':base.sha(baseline/'best.pt'),
              'baseline_protocol_sha256':base.sha(baseline/'protocol.json'),'dataset_sha256':base.sha(baseline/'dataset.json'),
              'crop_review_sha256':base.sha(crop_run/'review.json'),'approved_crops':len(crops),
              'source_sha256':base.sha(__file__),'preprocessing_sha256':prior['preprocessing_sha256'],
              'inference':'Unchanged V1 global+8 native640px tiles; raw/auto max, original guard',
              'optimization':'AdamW1e-5backbone/1e-4head;last3blocks;fixed batch statistics;4bags+4aux crops per update',
              'selection':'Minimum same83development-frame BCE, including epoch0 V1 reference, then strict-minimum clip2 fire threshold',
              'status':'Exploratory familiar survival diagnostic; no fresh independent labels; excluded from0.2.1; no label writes'}
    (out/'protocol.json').write_text(json.dumps(protocol,indent=2))
    torch.set_num_threads(4);device=torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    results={name:run_arm(name,weight,base,baseline,crop_run,out,rows,crops,protocol,device) for name,weight in protocol['arms'].items()}
    (out/'comparison.json').write_text(json.dumps({k:{'freeze':r['freeze'],'roles':r['roles']} for k,r in results.items()},indent=2))


if __name__=='__main__':main()
