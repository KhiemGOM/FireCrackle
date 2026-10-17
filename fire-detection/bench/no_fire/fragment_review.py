"""Exact-frame visual review of the frozen radius4 rule's false clears.

Boxes locate capture-mod fire, not exact flame silhouettes or readability truth.
No original labels/thresholds are changed by this review.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import html
import json
import math
from pathlib import Path
import subprocess

import numpy as np
from PIL import Image, ImageDraw
from prepare import ROOT, SOURCES
from veil_native import apply
from blob_calibration import meaningful


def extract(name,cases,out):
    cases=sorted(cases,key=lambda r:r['frame'])
    expression='+'.join(f'eq(n\\,{r["frame"]})' for r in cases)
    command=[str(ROOT/'FireCrackle/src-tauri/runtime/ffmpeg.exe'),'-v','error','-threads','2','-i',str(ROOT/'fire-detection/data/video'/SOURCES[name]),'-vf',f'select={expression}','-frames:v',str(len(cases)),'-fps_mode','passthrough','-pix_fmt','rgb24','-f','rawvideo','pipe:1']
    proc=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    result=[]
    try:
        for row in cases:
            raw=proc.stdout.read(1920*1080*3)
            if len(raw)!=1920*1080*3:raise RuntimeError('Missing exact frame '+str(row['frame']))
            rgb=np.frombuffer(raw,np.uint8).reshape(1080,1920,3)
            original=Image.fromarray(rgb);corrected,used,share=apply(rgb,y0=12)
            image=Image.fromarray(corrected);stem=f'{name}-{row["frame"]}'
            original.save(out/f'{stem}-raw.jpg',quality=96)
            image.save(out/f'{stem}-auto.jpg',quality=96)
            annotated=image.copy();draw=ImageDraw.Draw(annotated)
            crops=[]
            for j,b in enumerate(row['truth']['boxes']):
                x0,y0,x1,y1=b;draw.rectangle(b,outline='#ff4343',width=4);draw.text((x0,max(0,y0-14)),str(j+1),fill='white',stroke_width=2,stroke_fill='black')
                # Keep a native-resolution PNG with margin, then let the browser zoom nearest-neighbour.
                pad=8;rect=(max(0,math.floor(x0)-pad),max(0,math.floor(y0)-pad),min(1920,math.ceil(x1)+pad),min(1080,math.ceil(y1)+pad))
                crop=image.crop(rect);filename=f'{stem}-crop{j+1}.png';crop.save(out/filename)
                crops.append({'file':filename,'box':b,'native_width':x1-x0,'native_height':y1-y0,'crop_width':crop.width,'crop_height':crop.height})
            annotated.resize((960,540)).save(out/f'{stem}-context.jpg',quality=93)
            native_max=max((min(1920,b[2])-max(0,b[0]) for b in row['truth']['boxes']),default=0)
            result.append({'source':name,'frame':row['frame'],'seconds':row['frame']/60,'score':row['scores']['all:r4'],'context':f'{stem}-context.jpg','raw':f'{stem}-raw.jpg','auto':f'{stem}-auto.jpg','unveiled':used,'veil_share':share,'crops':crops,'max_native_width':native_max,'raw_rgb_sha256':hashlib.sha256(raw).hexdigest()})
            print(f'Extracted {name} frame {row["frame"]}',flush=True)
        error=proc.stderr.read().decode(errors='replace')
        if proc.wait():raise RuntimeError(error)
    finally:
        proc.stdout.close();proc.stderr.close()
        if proc.poll() is None:proc.terminate();proc.wait()
    return result


def main():
    ap=argparse.ArgumentParser();ap.add_argument('out',type=Path);ap.add_argument('--cached',action='store_true');args=ap.parse_args();args.out.mkdir(parents=True,exist_ok=True)
    cache=ROOT/'.board/no-fire-parallel/fragments';threshold=2198;errors=[];evaluation=[]
    for name in ['clip1','quad1','survival1']:
        rows=json.loads((cache/f'{name}.json').read_text());evaluation+=rows
        errors +=[r for r in rows if r['truth']['substantial'] and r['scores']['all:r4']<threshold]
    assert len(errors)==13
    if args.cached:
        reviewed=json.loads((args.out/'manifest.json').read_text())['cases']
        assert {(r['source'],r['frame']) for r in reviewed}=={(r['source'],r['frame']) for r in errors}
    else:
        with ThreadPoolExecutor(max_workers=3) as pool:
            batches=list(pool.map(lambda name:extract(name,[r for r in errors if r['source']==name],args.out),['clip1','quad1','survival1']))
        reviewed=sum(batches,[])
    # Policy sensitivity only: labels keep original meaning, no recalibration or silent reclassification.
    sensitivity={}
    for width in [24,32,40,48,64,80,96,112]:
        cleared=[r for r in evaluation if r['scores']['all:r4']<threshold]
        fp=sum(meaningful(r['truth']['boxes'],width) for r in cleared)
        sensitivity[width]={'correct_clears_under_hypothetical_policy':len(cleared)-fp,'fire_cleared_under_hypothetical_policy':fp,'newly_ignored_fire_frames_among_all_evaluation':sum(r['truth']['substantial'] and not meaningful(r['truth']['boxes'],width) for r in evaluation)}
    manifest={'method':'Frozenall:r4<2198; exact native frame decoding; original truth unchanged','cases':reviewed,'hypothetical_width_policy_sensitivity':sensitivity,'limits':'Capture boxes are approximate extents, not exact fire pixel area, visible texture-column count or proof of labelability. Review changes must be applied to all methods if adopted.','script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    (args.out/'manifest.json').write_text(json.dumps(manifest,indent=2))
    cards=[]
    decisions=json.loads(Path(__file__).with_name('fragment_review_decisions.json').read_text())
    bad={(r['source'],r['frame']) for r in decisions['unacceptable_cases']}
    accepted={(r['source'],r['frame']) for r in decisions['acceptable_cases']}
    reopened={(r['source'],r['frame']) for r in decisions.get('reopened_cases',[])}
    assert bad.isdisjoint(accepted|reopened) and accepted.isdisjoint(reopened) and bad|accepted|reopened=={(r['source'],r['frame']) for r in reviewed}
    for r in reviewed:
        crops=''.join(f'<figure><figcaption>#{j+1}: {c["native_width"]:.1f} × {c["native_height"]:.1f} native px</figcaption><img class="crop" src="{c["file"]}" style="width:{c["crop_width"]*4}px;height:{c["crop_height"]*4}px"></figure>' for j,c in enumerate(r['crops']))
        cards.append(f'<article id="{r["source"]}-{r["frame"]}"><h2>{r["source"]} · frame {r["frame"]} · {r["seconds"]:.2f}s</h2><p>Score {r["score"]} &lt;2198 · auto-unveil {r["unveiled"]} · largest box width {r["max_native_width"]:.1f}px</p><a href="{r["auto"]}"><img class="context" src="{r["context"]}"></a><p><a href="{r["raw"]}">Original full-resolution picture</a> · <a href="{r["auto"]}">Shared auto-unveil full resolution</a></p><div class="crops">{crops}</div></article>')
        status='Unacceptable miss — remaining regression' if (r['source'],r['frame']) in bad else 'Acceptable pass — owner reviewed'
        colour='#ff7373' if (r['source'],r['frame']) in bad else '#75dba0'
        if (r['source'],r['frame']) in reopened:status='Portal case reopened — must abstain; undo available below';colour='#ffba66'
        cards[-1]=cards[-1].replace('<h2>',f'<p style="color:{colour};font-weight:bold">{html.escape(status)}</p><h2>',1)
    page='<!doctype html><meta charset="utf-8"><title>13 fire frames wrongly cleared</title><style>body{background:#10151d;color:#e8edf7;font:15px system-ui;margin:24px}h1{font-size:26px}p{color:#b8c4d9}a{color:#6dd6ff}article{border:1px solid #354259;border-radius:12px;padding:16px;margin:22px 0}.context{max-width:960px;width:100%}.crops{display:flex;gap:20px;overflow:auto;align-items:flex-start}figure{margin:0;flex-shrink:0}figcaption{margin-bottom:8px}.crop{image-rendering:pixelated;max-width:none}button{padding:10px;background:#334057;color:white;border:0;border-radius:6px}</style><h1>13 actual fire frames the91-clear rule missed</h1><p>Full-frame context, followed by every labelled fire box cropped at native resolution and enlarged4×. Red boxes locate capture-mod fire; boxes alone do not prove the flame is labelable. Click a context picture for full resolution.</p><p>Judge sprite readability, smoke/occlusion and distance. Original labels and frozen threshold remain unchanged.</p>'+''.join(cards)
    counts=decisions['reviewed_clear_outputs']
    page=page.replace('<h1>13 actual fire frames the91-clear rule missed</h1>',f'<h1>Owner review: {counts["acceptable"]} accepted / {counts["unacceptable"]} explicit misses / {len(reopened)} portal cases reopened</h1><p><a href="portal/">Open portal undo before/after gallery</a>. Detected translucency must abstain; portal cases are no longer accepted passes. Original capture labels remain unchanged.</p>')
    (args.out/'index.html').write_text(page,encoding='utf8')
    (args.out/'owner-review.json').write_text(json.dumps(decisions,indent=2))
    print(json.dumps({'cases':len(reviewed),'width_sensitivity':sensitivity},indent=2),flush=True)


if __name__=='__main__':main()
