"""Orange-only temporal no-fire ablation; labels score only the burst anchor.

Three actual frames at offsets0/3/6. Unguarded low-motion scores are risky ablations.
GUI rectangles are an explicitly labelled proxy, never an oracle mask.
"""
import argparse
import hashlib
import json
import time
from collections import deque
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from blob_pilot import truth_rows
from blob_calibration import meaningful
from temporal_presence import burst_frames, phase_shift, registration_gray, translate, calibrate, metrics
from veil_native import apply
from prepare import ROOT


def orange(rgb):
    r,g,b=np.moveaxis(rgb.astype(np.int16),-1,0)
    return (r>=64)&(g>=.23*r)&(g<=.88*r)&(b<=.5*r)&(r-b>=24)


def local(mask,side=24):
    """Same half-window stride and boundary coverage as spatial orange pilot."""
    h,w=mask.shape;side=min(side,h,w)
    if side<1:return 0
    ys=sorted(set(range(0,h-side+1,max(1,side//2)))|{h-side})
    xs=sorted(set(range(0,w-side+1,max(1,side//2)))|{w-side})
    sums=np.pad(mask.astype(np.uint32).cumsum(0,dtype=np.uint32).cumsum(1,dtype=np.uint32),((1,0),(1,0)))
    y=np.array(ys)[:,None];x=np.array(xs)[None,:]
    return int((sums[y+side,x+side]+sums[y,x]-sums[y,x+side]-sums[y+side,x]).max())


def domains(h,w):
    full=np.ones((h,w),bool);full[:min(12,h)]=False
    proxy=full.copy();proxy[h*88//100:,w//4:w*3//4]=False;proxy[:h*18//100,w*85//100:]=False
    return {'all':full,'hud_proxy':proxy}


def texture(images,valid):
    masks=[orange(im) for im in images]
    a,b,c=[im.astype(np.int16) for im in images]
    d1=b-a;d2=c-b
    # Orange in the anchor is mandatory; neighbours cannot invent anchor fire truth.
    changing=masks[0]&(masks[1]|masks[2])&valid&(np.abs(d1).max(2)>=24)&(np.abs(d2).max(2)>=24)
    reversal=changing&(d1[:,:,0].astype(np.int32)*d2[:,:,0].astype(np.int32)<0)
    return {'change':local(changing),'reversal':local(reversal)}


def score(images):
    base=images[0];h,w=base.shape[:2];ds=domains(h,w)
    # Unveil unshifted originals: a translated black border must not alter veil detection.
    fixed=[apply(im,y0=min(12,h-1)) for im in images]
    auto=[r[0] for r in fixed]
    output={};info={'unveiled':[r[1] for r in fixed]}
    for scope,domain in ds.items():
        anchor=max(local(orange(branch[0])&domain) for branch in [images,auto])
        maximum=max(local(orange(im)&domain) for branch in [images,auto] for im in branch)
        output[f'{scope}:anchor']=anchor
        output[f'{scope}:spatial_burst']=maximum
    gray=registration_gray(base);shifts=[];valid=ds['all'].copy()
    raw_aligned=[base];auto_aligned=[auto[0]]
    for i,image in enumerate(images[1:],1):
        shift,confidence=phase_shift(gray,registration_gray(image))
        dy,dx=round(shift[0]*h/180),round(shift[1]*w/320)
        shifts.append({'dy':dy,'dx':dx,'confidence':confidence})
        if any(r[1] for r in fixed) and (dy or dx):
            info['reason']='auto_shift_uncertainty';break
        if confidence<8 or abs(dy)>48 or abs(dx)>48:
            info['reason']='uncertain_registration';break
        moved,inside=translate(image,dy,dx)
        if int((orange(base)&ds['all']&~inside).sum())>=16:
            info['reason']='orange_leaves_overlap';break
        raw_aligned.append(moved);auto_aligned.append(translate(auto[i],dy,dx)[0]);valid &= inside
    else:
        residual=float(np.median(np.abs(base.astype(np.int16)-raw_aligned[1].astype(np.int16))[ds['all']]))
        info['residual']=residual
        info['reason']='scored' if residual<=24 else 'large_registration_residual'
    info['registration']=shifts
    for scope,domain in ds.items():
        if info['reason']!='scored':
            for field in ['change','reversal','guarded_change']:output[f'{scope}:{field}']=None
            continue
        raw=texture(raw_aligned,valid&domain);corrected=texture(auto_aligned,valid&domain)
        for field in raw:output[f'{scope}:{field}']=max(raw[field],corrected[field])
        # Predeclared spatial veto: lack of flicker alone never overrules dense orange.
        output[f'{scope}:guarded_change']=output[f'{scope}:change'] if output[f'{scope}:anchor']<440 else None
    return output,info


def scored_frames(name,threads,workers):
    """Bound the frame queue; parallel CPU scoring without caching the whole video."""
    pending=deque()
    with ProcessPoolExecutor(max_workers=workers) as pool:
        for n,images in burst_frames(name,90,threads):
            pending.append((n,pool.submit(score,images)))
            if len(pending)>=workers*2:
                frame,result=pending.popleft();yield frame,result.result()
        while pending:
            frame,result=pending.popleft();yield frame,result.result()


def main():
    ap=argparse.ArgumentParser();ap.add_argument('out',type=Path);ap.add_argument('--threads',type=int,default=2);ap.add_argument('--workers',type=int,default=4);ap.add_argument('--full-eval',action='store_true');args=ap.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    protocol={'objective':'TP=correct clear, FP=meaningful fire cleared','calibration':'clip2','evaluation':['clip1','quad1','survival1'],'stride':90,'offsets':[0,3,6],'target':'anchor only;24px horizontal native visible box width; no height cutoff','gui':'all=full frame;hud_proxy=fixed rectangles, NOT GUI oracle; truth unmodified','registration':'phase correlation; uncertain/large shift/residual => motion scores unknown and force review','unveil':'canonical applied before alignment; max raw/auto evidence','guard':'guarded_change forces review if anchor local24 >=440; static fire is not assumed absent','source_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'shared_veil_sha256':hashlib.sha256((ROOT/'fire-detection/core/src/veil.rs').read_bytes()).hexdigest(),'limits':'Familiar videos; temporally correlated samples; no independent holdout; no app writes'}
    (args.out/'protocol.json').write_text(json.dumps(protocol,indent=2));report={'protocol':protocol,'sources':{}};all_rows=[]
    for name in ['clip2','clip1','quad1','survival1']:
        truth=truth_rows(name,90,0);rows=[];start=time.time()
        for n,(scores,info) in scored_frames(name,args.threads,args.workers):
            if n not in truth:continue
            target=truth[n];target['substantial']=meaningful(target['boxes'],24)
            rows.append({'source':name,'frame':n,'truth':target,'scores':scores,'info':info})
            if len(rows)%50==0:print(json.dumps({'source':name,'frames':len(rows),'seconds':round(time.time()-start)}),flush=True)
        (args.out/f'{name}.json').write_text(json.dumps(rows))
        if name=='clip2':
            thresholds={k:calibrate(rows,k,0) for k in rows[0]['scores']}
            # These two spatial rules retain the historical frozen440 cutoff for comparison.
            for k in thresholds:
                if k.endswith(':anchor') or k.endswith(':spatial_burst'):thresholds[k]=440
            (args.out/'frozen-thresholds.json').write_text(json.dumps(thresholds,indent=2))
        else:all_rows+=rows
        report['sources'][name]={'frames':len(rows),'seconds':round(time.time()-start,2),'variants':{k:metrics(rows,k,t) for k,t in thresholds.items()}}
        (args.out/'report.json').write_text(json.dumps(report,indent=2))
        if name=='clip2' and not args.full_eval and all(t==0 for k,t in thresholds.items() if k.endswith((':change',':reversal',':guarded_change'))):
            report['early_stop']='Every motion threshold is zero: no nonnegative motion score can ever clear. Anchor/spatial_burst are unchanged/subsets of existing spatial rule; no evaluation pixel decode needed.'
            (args.out/'report.json').write_text(json.dumps(report,indent=2));print(report['early_stop'],flush=True);return
    report['evaluation']={k:metrics(all_rows,k,t) for k,t in thresholds.items()}
    report['false_clears']={k:[{'source':r['source'],'frame':r['frame']} for r in all_rows if r['truth']['substantial'] and r['scores'][k] is not None and r['scores'][k]<t] for k,t in thresholds.items()}
    (args.out/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report['evaluation']),flush=True)


if __name__=='__main__':main()
