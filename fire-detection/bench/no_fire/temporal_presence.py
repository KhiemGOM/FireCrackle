"""Adapt a deterministic temporal fire-presence score to NO-FIRE acceptance.

Positive means clear no-fire/negligible fire. No trained model. Calibration is
one recording; thresholds are frozen before scoring other recordings. These
recordings are familiar research data, not a pristine blind benchmark.
"""
import argparse
import hashlib
import json
import subprocess
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from blob_pilot import truth_rows
from features import unveil
from prepare import ROOT, SOURCES


def phase_shift(reference, current):
    """Integer translation to apply to current; PSR-like peak/std confidence."""
    a = reference.astype(float)-np.mean(reference)
    b = current.astype(float)-np.mean(current)
    window = np.hanning(a.shape[0])[:,None]*np.hanning(a.shape[1])[None,:]
    cross = np.fft.fft2(a*window)*np.conj(np.fft.fft2(b*window))
    cross /= np.maximum(np.abs(cross), 1e-9)
    corr = np.fft.ifft2(cross).real
    y,x = np.unravel_index(np.argmax(corr),corr.shape)
    result = []
    for index, size, before, centre, after in (
        (y,corr.shape[0],corr[(y-1)%corr.shape[0],x],corr[y,x],corr[(y+1)%corr.shape[0],x]),
        (x,corr.shape[1],corr[y,(x-1)%corr.shape[1]],corr[y,x],corr[y,(x+1)%corr.shape[1]])):
        denominator = before-2*centre+after
        offset = .5*(before-after)/denominator if abs(denominator)>1e-9 else 0.
        result.append((index if index<=size//2 else index-size)+np.clip(offset,-.5,.5))
    return result, float(corr[y,x]/max(float(corr.std()),1e-9))


def registration_gray(rgb):
    a = np.asarray(Image.fromarray(rgb).resize((320,180),Image.Resampling.BOX),float)
    gray = a.mean(axis=2)
    gray[:3] = 0;gray[158:,80:240] = 0;gray[:33,272:] = 0
    return gray


def translate(rgb, dy, dx):
    h,w = rgb.shape[:2]; result=np.zeros_like(rgb); valid=np.zeros((h,w),bool)
    y0,y1=max(0,dy),min(h,h+dy);x0,x1=max(0,dx),min(w,w+dx)
    if y1>y0 and x1>x0:
        result[y0:y1,x0:x1]=rgb[y0-dy:y1-dy,x0-dx:x1-dx];valid[y0:y1,x0:x1]=True
    return result,valid


def warm(rgb):
    r,g,b=np.moveaxis(rgb.astype(np.int16),-1,0)
    return (r>=35)&(r>=.9*g)&(g>=.23*r)&(b<=.8*r)&(r-b>=12)


def usable(h,w):
    result=np.ones((h,w),bool);result[:12]=False
    # Same explicit diagnostic HUD exclusion as the spatial pilot.
    result[h*88//100:,w//4:w*3//4]=False;result[:h*18//100,w*85//100:]=False
    return result


def local_count(mask, cell=16):
    h,w=mask.shape;h=h//cell*cell;w=w//cell*cell
    if h<2*cell or w<2*cell:return int(mask.sum())
    cells=mask[:h,:w].reshape(h//cell,cell,w//cell,cell).sum(axis=(1,3))
    total=cells[:-1,:-1]+cells[1:,:-1]+cells[:-1,1:]+cells[1:,1:]
    return int(total.max(initial=0))


def texture_scores(a,b,c,valid):
    # Work at decoded resolution; no small-fire opening or image resize here.
    wa,wb,wc=warm(a),warm(b),warm(c)
    persistent=wa&wb&wc&valid
    aa,bb,cc=a.astype(np.int16),b.astype(np.int16),c.astype(np.int16)
    d1=bb-aa;d2=cc-bb
    changing=persistent&(np.abs(d1).max(axis=2)>=24)&(np.abs(d2).max(axis=2)>=24)
    # Brightness reversals are less likely to be a simple moving colour edge.
    red1=d1[:,:,0].astype(np.int32);red2=d2[:,:,0].astype(np.int32)
    reversal=changing&(red1*red2<0)&(np.abs(red1)>=12)&(np.abs(red2)>=12)
    return {'change':local_count(changing),'reversal':local_count(reversal)}


def score_burst(images):
    base=images[0];h,w=base.shape[:2];domain=usable(h,w);gray=registration_gray(base)
    shifted=[base];valid=domain.copy();registration=[]
    for image in images[1:]:
        shift,confidence=phase_shift(gray,registration_gray(image))
        dy,dx=round(shift[0]*h/180),round(shift[1]*w/320)
        registration.append({'dy':dy,'dx':dx,'confidence':confidence})
        if confidence<8 or abs(dy)>48 or abs(dx)>48:
            return {'change':None,'reversal':None,'reason':'uncertain_camera_registration','registration':registration}
        moved,inside=translate(image,dy,dx)
        if int((warm(base)&domain&~inside).sum())>=16:
            return {'change':None,'reversal':None,'reason':'warm_pixels_leave_overlap','registration':registration}
        shifted.append(moved);valid &= inside
    residual=float(np.median(np.abs(shifted[0].astype(np.int16)-shifted[1].astype(np.int16))[domain]))
    if residual>24:
        return {'change':None,'reversal':None,'reason':'large_registration_residual','registration':registration}
    raw=texture_scores(*shifted,valid)
    fixed=[unveil(im) for im in shifted]
    auto=texture_scores(*(item[0] for item in fixed),valid) if any(item[1] for item in fixed) else raw
    # Either branch retaining fire evidence prevents a clear decision.
    return {k:max(raw[k],auto[k]) for k in raw}|{'raw':raw,'auto':auto,'reason':'scored','registration':registration,'residual':residual}


def burst_frames(name,stride,threads):
    ffmpeg=ROOT/'FireCrackle/src-tauri/runtime/ffmpeg.exe'
    expression=f'not(mod(n\\,3))*lte(mod(n\\,{stride})\\,6)'
    command=[str(ffmpeg),'-v','error','-threads',str(threads),'-i',str(ROOT/'fire-detection/data/video'/SOURCES[name]),
        '-vf',f'select={expression}','-fps_mode','passthrough','-pix_fmt','rgb24','-f','rawvideo','pipe:1']
    proc=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    group=[];anchor=0
    try:
        while True:
            raw=proc.stdout.read(1920*1080*3)
            if not raw:break
            if len(raw)!=1920*1080*3:raise RuntimeError('Truncated RGB frame')
            group.append(np.frombuffer(raw,np.uint8).reshape(1080,1920,3))
            if len(group)==3:
                yield anchor,group;anchor+=stride;group=[]
        error=proc.stderr.read().decode(errors='replace')
        if proc.wait()!=0:raise RuntimeError(error)
    finally:
        proc.stdout.close();proc.stderr.close()
        if proc.poll() is None:proc.terminate();proc.wait()


def calibrate(rows,field,budget):
    # Strict low-score acceptance. Equal scores stay together; zero is meaningful.
    scores=np.array([r['scores'][field] if r['scores'][field] is not None else np.inf for r in rows])
    truth=np.array([r['truth']['substantial'] for r in rows],bool)
    # An all-unknown calibration fire class provides no evidence for clearing.
    if not np.any(truth & np.isfinite(scores)):
        return 0.
    allowed=int(np.floor(truth.sum()*budget))
    candidates=np.unique(np.r_[0.,scores[np.isfinite(scores)]])
    valid=[float(t) for t in candidates if int(((scores<t)&truth).sum())<=allowed]
    return max(valid,default=0.)


def metrics(rows,field,threshold):
    truth=np.array([r['truth']['substantial'] for r in rows],bool)
    score=np.array([r['scores'][field] if r['scores'][field] is not None else np.inf for r in rows])
    positive=score<threshold
    tp=int((positive&~truth).sum());fp=int((positive&truth).sum())
    fn=int((~positive&~truth).sum());tn=int((~positive&truth).sum())
    return {'TP':tp,'FP':fp,'FN':fn,'TN':tn,'precision':tp/(tp+fp) if tp+fp else None,
        'recall':tp/(tp+fn) if tp+fn else None,'false_positive_rate':fp/(fp+tn) if fp+tn else None,
        'forced_review':int((~np.isfinite(score)).sum())}


def main():
    ap=argparse.ArgumentParser();ap.add_argument('out',type=Path);ap.add_argument('--stride',type=int,default=90)
    ap.add_argument('--threads',type=int,default=6);ap.add_argument('--min-fire-side',type=float,default=4)
    args=ap.parse_args()
    if args.stride<9 or args.stride%3:ap.error('Stride must be a multiple of3 and at least9')
    args.out.mkdir(parents=True,exist_ok=True)
    protocol={'objective':'Positive=clear no-fire/negligible; FP=meaningful fire wrongly cleared.',
        'calibration':'clip2','evaluation':['clip1','quad1','survival1'],'stride':args.stride,'burst_offsets':[0,3,6],
        'label_frame':'burst anchor (first frame); next6frames are video-only evidence',
        'min_fire_side':args.min_fire_side,'calibration_FP_budgets':[0,.01,.05],
        'source_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    (args.out/'protocol.json').write_text(json.dumps(protocol,indent=2));data={};thresholds={};report={'protocol':protocol,'sources':{}}
    for name in ['clip2','clip1','quad1','survival1']:
        truth=truth_rows(name,args.stride,args.min_fire_side);rows=[];start=time.time()
        for n,images in burst_frames(name,args.stride,args.threads):
            if n not in truth:continue
            row={'source':name,'frame':n,'truth':truth[n],'scores':score_burst(images)};rows.append(row)
            if len(rows)%200==0:print(json.dumps({'source':name,'frames':len(rows),'seconds':round(time.time()-start)}),flush=True)
        (args.out/f'{name}.json').write_text(json.dumps(rows));data[name]=rows
        if name=='clip2':
            thresholds={f'{field}:{budget}':{'field':field,'budget':budget,'threshold':calibrate(rows,field,budget)}
                for field in ['change','reversal'] for budget in [0.,.01,.05]}
            (args.out/'frozen-thresholds.json').write_text(json.dumps(thresholds,indent=2))
        report['sources'][name]={'frames':len(rows),'meaningful_fire':sum(r['truth']['substantial'] for r in rows),
            'variants':{key:metrics(rows,cfg['field'],cfg['threshold']) for key,cfg in thresholds.items()},'seconds':round(time.time()-start,2)}
        (args.out/'report.json').write_text(json.dumps(report,indent=2))
        print(json.dumps({name:report['sources'][name]}),flush=True)
    test=sum((data[n] for n in protocol['evaluation']),[])
    report['evaluation_combined']={key:metrics(test,cfg['field'],cfg['threshold']) for key,cfg in thresholds.items()}
    (args.out/'report.json').write_text(json.dumps(report,indent=2))


if __name__=='__main__':main()
