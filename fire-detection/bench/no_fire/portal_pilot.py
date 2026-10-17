"""Portal correction examples plus full-duration conservative abstention scan.

Detection/fitting/inverse are canonical Rust through thin portal_undo bindings.
Portal correction is for inspection; the no-fire rule abstains on suspected
translucency even when a correction is available.
"""
import argparse
from concurrent.futures import ProcessPoolExecutor
import hashlib
import json
from pathlib import Path
import re
import subprocess
import time

import numpy as np
from PIL import Image,ImageDraw
from portal_undo import load_texture,apply_portal,translucency_guard
from veil_native import apply,library
from colour_support import frames
from prepare import ROOT,SOURCES


def world_mask(h,w):
    """Temporary GUI envelope proxy; replace with caller's per-piece GUI mask."""
    m=np.ones((h,w),np.uint8);m[:12]=0
    m[h*88//100:,w//4:w*3//4]=0;m[:h*18//100,w*85//100:]=0
    return m


def scan_source(name,out):
    cache=ROOT/'.board/no-fire-parallel/fragments';baseline={r['frame']:r for r in json.loads((cache/f'{name}.json').read_text())}
    results=[];start=time.time()
    for n,rgb in frames(name,90,2):
        if n not in baseline:continue
        g=translucency_guard(rgb,world_mask(*rgb.shape[:2]))
        old=baseline[n];results.append({'source':name,'frame':n,'truth':old['truth'],'original_clear':old['scores']['all:r4']<2198,'clear_with_guard':old['scores']['all:r4']<2198 and not g['abstain'],'guard':g})
        if len(results)%200==0:print(json.dumps({'source':name,'guard_scan_frames':len(results),'seconds':round(time.time()-start)}),flush=True)
    assert len(results)==len(baseline)
    (out/f'{name}-guard.json').write_text(json.dumps(results));return name,results


def counts(rows,key):
    return {'TP':sum(r[key] and not r['truth']['substantial'] for r in rows),'FP':sum(r[key] and r['truth']['substantial'] for r in rows),'translucency_abstentions':sum(r['guard']['abstain'] for r in rows) if key=='clear_with_guard' else 0,'frames':len(rows)}


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--jar',type=Path,required=True);ap.add_argument('--out',type=Path,required=True);ap.add_argument('--scan',action='store_true');args=ap.parse_args();args.out.mkdir(parents=True,exist_ok=True)
    atlas=load_texture(args.jar);library()
    rawdir=ROOT/'.board/portal-undo/frames';rawdir.mkdir(parents=True,exist_ok=True)
    ids=[50760,51840,51930,52020]
    ffmpeg=ROOT/'FireCrackle/src-tauri/runtime/ffmpeg.exe'
    # CFR60 source starts0. Input-seek plus preserved PTS proves each selected frame time.
    command=[str(ffmpeg),'-hide_banner','-loglevel','info','-threads','6','-ss','843','-copyts','-i',str(ROOT/'fire-detection/data/video'/SOURCES['survival1']),'-vf','select=eq(n\\,180)+eq(n\\,1260)+eq(n\\,1350)+eq(n\\,1440),showinfo','-frames:v','4','-fps_mode','passthrough','-y',str(rawdir/'portal-%02d.png')]
    run=subprocess.run(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True);log=run.stderr.decode(errors='replace');(args.out/'extract.log').write_text(log)
    times=[float(t) for t in re.findall(r'pts_time:([0-9.]+)',log)];assert times[:4]==[n/60 for n in ids],times
    baseline={r['frame']:r for r in json.loads((ROOT/'.board/no-fire-parallel/fragments/survival1.json').read_text())}
    helper=subprocess.Popen([str(ROOT/'.board/portal-undo/fragment-score.exe'),'1920','1080'],stdin=subprocess.PIPE,stdout=subprocess.PIPE)
    cases=[];cards=[]
    try:
        for j,n in enumerate(ids,1):
            rgb=np.asarray(Image.open(rawdir/f'portal-{j:02d}.png').convert('RGB'));m=world_mask(*rgb.shape[:2])
            # Screen gradient is later in the render stack, so undo it before portal fit.
            menu,menu_used,_=apply(rgb,y0=12);fixed,info,valid=apply_portal(menu,atlas,m);guard=translucency_guard(rgb,m)
            helper.stdin.write(fixed.tobytes());helper.stdin.flush();e=json.loads(helper.stdout.readline());after=e['raw']['r4']
            stem=f'survival1-{n}';Image.fromarray(rgb).save(args.out/f'{stem}-before.png');Image.fromarray(fixed).save(args.out/f'{stem}-after.png');Image.fromarray(valid*255).save(args.out/f'{stem}-valid.png')
            sheet=Image.new('RGB',(1280,390),'#111923');sheet.paste(Image.fromarray(rgb).resize((640,360)),(0,25));sheet.paste(Image.fromarray(fixed).resize((640,360)),(640,25));d=ImageDraw.Draw(sheet);d.text((5,5),f'Original portal frame {n}',fill='white');d.text((645,5),f'Undo: phase{info["phase"]}, opacity{info["opacity"]:.3f}',fill='white');sheet.save(args.out/f'{stem}-comparison.jpg',quality=94)
            crops=[]
            for k,b in enumerate(baseline[n]['truth']['boxes']):
                rect=(max(0,int(b[0])-8),max(0,int(b[1])-8),min(1920,int(b[2]+1)+8),min(1080,int(b[3]+1)+8))
                for label,a in [('before',rgb),('after',fixed)]:Image.fromarray(a).crop(rect).save(args.out/f'{stem}-crop{k+1}-{label}.png')
                crops.append(k+1)
            case={'source':'survival1','frame':n,'pts_seconds':times[j-1],'menu_unveiled':menu_used,'fit':info,'guard':guard,'original_r4':baseline[n]['scores']['all:r4'],'corrected_r4':after,'corrected_retains_fire':max(after,baseline[n]['scores']['all:r4'])>=2198,'raw_rgb_sha256':hashlib.sha256(rgb.tobytes()).hexdigest()};cases.append(case)
            zoom=''.join(f'<figure><figcaption>Fire region{k}</figcaption><img src="{stem}-crop{k}-before.png"><img src="{stem}-crop{k}-after.png"></figure>' for k in crops)
            cards.append(f'<article><h2>Frame {n} · phase{info["phase"]} · opacity{info["opacity"]:.3f}</h2><p>Fire score {case["original_r4"]} → {after} (threshold2198). Algorithm: <b>ABSTAIN</b> on suspected translucency; correction is inspection only.</p><a href="{stem}-after.png"><img class="wide" src="{stem}-comparison.jpg"></a><div class="crops">{zoom}</div></article>')
            print(json.dumps(case),flush=True)
    finally:
        helper.stdin.close();helper.stdout.close();assert helper.wait()==0
    controls=[]
    for name in ['clip1-21330','clip1-22230','clip1-22860','clip1-22950','clip1-23040','clip1-23310','quad1-5310','quad1-5760','survival1-41850']:
        rgb=np.asarray(Image.open(ROOT/f'.board/no-fire-parallel/fragment-review/{name}-raw.jpg').convert('RGB'));_,fit,_=apply_portal(rgb,atlas,world_mask(*rgb.shape[:2]));controls.append({'case':name,'fit':fit})
    report={'cases':cases,'nonportal_review_copy_controls':controls,'mask':'Temporary fixed GUI-envelope proxy, not oracle. Core accepts real world/GUI masks and external translucent-world masks.','guard_policy':'ABSTAIN on known supplied translucency or >=64connected purple portal/effectcandidate pixels. A no-hit is not proof of opacity; automatic water/glass/ice recognition not implemented.','inverse_policy':'KnownRGBA portaltexture perphase+opacity, robust gridboundaryfit, invalid/lowtransmittance pixels unchanged withvaliditymap. Reconstructed pixels may amplifycompression and retain gridseams.','thresholds':'Phasefit opacity>=.1, purple share>=.2, boundaryresidualimprovement>=.35; frozen before cohortscan. Originalfireclear threshold2198unchanged.','assets':'Vanilla16x512portal atlas loaded locally from gamejar, never committed.','atlas_sha256':hashlib.sha256(atlas.tobytes()).hexdigest(),'source_sha256':{n:hashlib.sha256((ROOT/'fire-detection/core/src'/n).read_bytes()).hexdigest() for n in ['veil.rs','portal.rs','veil_abi.rs']}}
    if args.scan:
        with ProcessPoolExecutor(max_workers=4) as pool:
            data=dict(pool.map(scan_source,['clip2','clip1','quad1','survival1'],[args.out]*4))
        evaluation=sum((data[n] for n in ['clip1','quad1','survival1']),[])
        report['guard_evaluation']={'original':counts(evaluation,'original_clear'),'guarded':counts(evaluation,'clear_with_guard'),'remaining_errors':[{'source':r['source'],'frame':r['frame']} for r in evaluation if r['clear_with_guard'] and r['truth']['substantial']],'note':'Original frozen capture-truth metrics; prior manual exceptions are not silently used as labels. Full fresh guardscan, reused unchanged component-score decisions.'}
    (args.out/'report.json').write_text(json.dumps(report,indent=2))
    page='<!doctype html><meta charset="utf-8"><title>Portal undo</title><style>body{background:#10151d;color:#e8edf7;font:15px system-ui;margin:22px}article{border:1px solid #354259;padding:16px;margin:20px 0;border-radius:12px}.wide{width:100%;max-width:1280px}.crops{display:flex;overflow:auto;gap:24px}figure{margin:8px;flex-shrink:0}figure img{image-rendering:pixelated;height:210px;max-width:none;margin-right:12px}a{color:#6dd6ff}</style><h1>Portal animation undo: original → recovered</h1><p>Automatic texture-phase/opacity fit; no fire labels used for fitting. Four exact native video frames. The no-fire algorithm abstains on suspected translucency; these reconstructions are for inspection.</p><p>Some grid seams and compression noise remain. GUI handling uses a temporary envelope proxy; valid-pixel maps are available alongside each image.</p>'+''.join(cards)
    (args.out/'index.html').write_text(page,encoding='utf8');print(json.dumps(report.get('guard_evaluation',{})),flush=True)


if __name__=='__main__':main()
