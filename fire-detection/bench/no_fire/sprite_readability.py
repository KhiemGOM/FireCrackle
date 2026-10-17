"""Offline real-video horizontal texel-edge audit; never a no-fire labeller.

Projected width is sampling geometry, NOT a readability verdict. This diagnostic
compares known high-contrast opaque neighbouring texels with decoded RGB samples.
Overlap, visibility errors and phase errors can lower the result as well as blur.
"""
import argparse
import html
import json
import math
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from colour_support import homography, project
from fire_size_gallery import decode
from prepare import ROOT

TARGETS = [.4, .7, 1, 1.5, 2, 3, 4, 6]


def sample(rgb, xy):
    """Sample actual native pixels; do not invent detail by interpolation."""
    p = np.floor(xy).astype(int)
    valid = (p[:, 0] >= 0) & (p[:, 0] < rgb.shape[1]) & (p[:, 1] >= 0) & (p[:, 1] < rgb.shape[0])
    p[:, 0] = np.clip(p[:, 0], 0, rgb.shape[1]-1)
    p[:, 1] = np.clip(p[:, 1], 0, rgb.shape[0]-1)
    return rgb[p[:, 1], p[:, 0]].astype(float), valid


def audit(rgb, sprite, matrix):
    yy, xx = np.mgrid[:16, :15]
    expected = sprite[:, 1:, :3].astype(float)-sprite[:, :-1, :3].astype(float)
    strength = np.linalg.norm(expected, axis=2)
    eligible = (sprite[:, 1:, 3] >= 230) & (sprite[:, :-1, 3] >= 230) & (strength >= 70)
    left = np.c_[xx.ravel()+.5, yy.ravel()+.5]/16
    right = left+[1/16, 0]
    a, va = sample(rgb, project(matrix, left))
    b, vb = sample(rgb, project(matrix, right))
    # Within-texel colour variation is a local noise/overlap reference.
    noise = np.zeros(len(a))
    for uv, centre in [(left, a), (right, b)]:
        for offset in ([.15/16, 0], [-.15/16, 0], [0, .15/16], [0, -.15/16]):
            other, valid = sample(rgb, project(matrix, uv+offset))
            noise = np.maximum(noise, np.linalg.norm(other-centre, axis=1))
            va &= valid
    expected = expected.reshape(-1, 3)
    observed = b-a
    amplitude = np.linalg.norm(observed, axis=1)
    cosine = (observed*expected).sum(axis=1)/np.maximum(amplitude*strength.ravel(), 1e-9)
    eligible = eligible.ravel() & va & vb
    passed = eligible & (amplitude >= 12) & (cosine >= .5) & (amplitude >= 2*noise)
    pitch = np.linalg.norm(project(matrix, right)-project(matrix, left), axis=1)
    return {'eligible_pairs': int(eligible.sum()), 'retained_pairs': int(passed.sum()),
        'retained_fraction': float(passed.sum()/eligible.sum()) if eligible.any() else None,
        'median_texel_pitch': float(np.median(pitch)),
        'median_observed_contrast': float(np.median(amplitude[eligible])) if eligible.any() else None,
        'median_local_noise': float(np.median(noise[eligible])) if eligible.any() else None,
        'pass_mask': passed.reshape(16, 15).tolist(), 'eligible_mask': eligible.reshape(16, 15).tolist()}


def candidates(per_target):
    pools = [[] for _ in TARGETS]
    for name in ('quad1', 'survival1'):
        for line in (ROOT/f'fire-detection/data/joined/{name}.jsonl').open(encoding='utf8'):
            r = json.loads(line); lab = r.get('label')
            if not r.get('tick_ok') or r['n'] % 30 or not lab: continue
            for fire in lab.get('fires', []):
                if fire.get('src') != 'block' or fire.get('vis', 0) < .999 or fire.get('veil', 1) > .05: continue
                options = []
                for q in fire.get('quads', []):
                    if q.get('vis', 0) < .999 or not q.get('c'): continue
                    corners = np.asarray(q['c']).reshape(4, 2)*[1920/lab['w'],1080/lab['h']]
                    if (corners[:, 0] < 12).any() or (corners[:, 0] >= 1908).any() or (corners[:, 1] < 24).any() or (corners[:, 1] >= 1068).any(): continue
                    try: matrix = homography(np.asarray(q['uv']).reshape(4, 2), corners)
                    except np.linalg.LinAlgError: continue
                    uv = np.array([[.25,.5],[.5,.5],[.75,.5]])
                    pitch = float(np.median(np.linalg.norm(project(matrix, uv+[1/32,0])-project(matrix, uv-[1/32,0]),axis=1)))
                    options.append((pitch, matrix, corners, q))
                if not options: continue
                # Prefer the face giving this source its largest horizontal detail.
                pitch, matrix, corners, q = max(options,key=lambda x:x[0])
                if pitch <= 0: continue
                case = {'source':name,'frame':r['n'],'matrix':matrix.tolist(),'corners':corners.tolist(),
                    'sheet':q['s'],'row':q['row'],'pitch':pitch,'source_box':fire['box'],
                    'source_box_native':(np.asarray(fire['box'])*[1920/lab['w'],1080/lab['h'],1920/lab['w'],1080/lab['h']]).tolist()}
                for target,pool in zip(TARGETS,pools):
                    distance = abs(math.log2(pitch/target))
                    if distance > .4 or any(c['source']==name and abs(c['frame']-r['n'])<180 for _,c in pool): continue
                    pool.append((distance,case));pool.sort(key=lambda x:x[0]);del pool[per_target:]
    return [dict(c,target_pitch=t) for t,pool in zip(TARGETS,pools) for _,c in pool]


def draw(case, rgb, sprite, path):
    corners=np.asarray(case['corners']); cx,cy=corners.mean(axis=0)
    image=Image.fromarray(rgb); canvas=Image.new('RGB',(1000,350),'#151b25'); d=ImageDraw.Draw(canvas)
    native=image.crop((round(cx)-80,round(cy)-64,round(cx)+80,round(cy)+64))
    canvas.paste(native,(12,50));canvas.paste(native.resize((480,384),Image.Resampling.NEAREST).crop((0,0,320,270)),(185,50))
    # Rectification is labelled explicitly; native crop above remains unresampled.
    yy,xx=np.mgrid[:128,:128];uv=np.c_[xx.ravel()+.5,yy.ravel()+.5]/128
    values,_=sample(rgb,project(np.asarray(case['matrix']),uv))
    rect=Image.fromarray(values.astype(np.uint8).reshape(128,128,3))
    canvas.paste(rect,(525,50));canvas.paste(Image.fromarray(sprite).resize((128,128),Image.Resampling.NEAREST),(675,50))
    rd=ImageDraw.Draw(canvas)
    for i in range(17):
        rd.line((525+i*8,50,525+i*8,178),fill='#456080',width=1)
        rd.line((525,50+i*8,653,50+i*8),fill='#456080',width=1)
    d.text((12,15),f"{case['source']} frame {case['frame']} | sheet {case['sheet']} row {case['row']}",fill='white')
    d.text((12,31),'Native 160x128 crop',fill='white');d.text((185,31),'3x native pixels (crop)',fill='white')
    d.text((525,31),'Decoded, UV rectified',fill='white');d.text((675,31),'Known sprite',fill='white')
    m=case['measurement']; n=m['eligible_pairs']; passed=m['retained_pairs']
    d.text((525,198),f"{m['median_texel_pitch']:.2f} video px / sprite column",fill='#7fe2ff')
    d.text((525,220),f"{passed}/{n} strong horizontal colour edges retained",fill='white')
    d.text((525,242),'Diagnostic only; overlap/phase can also lower this.',fill='#abb8c9')
    d.text((12,330),'No bounding-box width threshold. No no-fire labels changed.',fill='#ffd46b')
    canvas.save(path)


def controlled(out):
    """Resize/re-encode an actual clear flame, holding scene/geometry fixed.

    Additional compression is a sensitivity test, not an estimate of the original
    recording's encoder. No enlargement beyond the original sampling pitch.
    """
    report=json.loads((out/'readability.json').read_text())
    # Visually reviewed: clear isolated ground flame, no foreground block/portal.
    case=next(c for c in report['cases'] if c['source']=='survival1' and c['frame']==3030)
    rgb=decode(case['source'],case['frame']);corners=np.asarray(case['corners'])
    lo=np.maximum(np.floor(corners.min(axis=0)).astype(int)-16,0)
    hi=np.minimum(np.ceil(corners.max(axis=0)).astype(int)+16,[1920,1080])
    crop=Image.fromarray(rgb[lo[1]:hi[1],lo[0]:hi[0]])
    sprite=np.asarray(Image.open(ROOT/f'fire-detection/data/assets/fire_{case["sheet"]}.png').convert('RGBA'))[case['row']*16:(case['row']+1)*16]
    ffmpeg=str(ROOT/'FireCrackle/src-tauri/runtime/ffmpeg.exe');rows=[]
    targets=[.5,.75,1,1.5,2,3]
    for pitch in targets:
        scale=pitch/case['pitch'];w=max(2,round(crop.width*scale/2)*2);h=max(2,round(crop.height*scale/2)*2)
        small=crop.resize((w,h),Image.Resampling.BOX)
        matrix=np.diag([w/crop.width,h/crop.height,1.])@np.array([[1,0,-lo[0]],[0,1,-lo[1]],[0,0,1.]])@np.asarray(case['matrix'])
        for crf in (None,18,28,38):
            if crf is None:decoded=np.asarray(small)
            else:
                encoded=out/f'controlled-{pitch}-crf{crf}.mkv'
                subprocess.run([ffmpeg,'-v','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{w}x{h}','-i','pipe:0','-frames:v','1','-c:v','libx264','-preset','medium','-crf',str(crf),'-pix_fmt','yuv420p',str(encoded)],input=small.tobytes(),check=True)
                raw=subprocess.check_output([ffmpeg,'-v','error','-i',str(encoded),'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'])
                decoded=np.frombuffer(raw,np.uint8).reshape(h,w,3)
            m=audit(decoded,sprite,matrix)
            name=f'controlled-{pitch}-{crf}.png';Image.fromarray(decoded).save(out/name)
            rows.append({'target_pitch':pitch,'crf':crf,'measurement':m,'image':name,'width':w,'height':h})
    data={'source':case['source'],'frame':case['frame'],'base_pitch':case['pitch'],
        'definition':'Same real clear flame, BOX downsampled. CRF rows are additional single-frame H.264 yuv420p encodes, not the original video settings. This isolates resize/re-encode sensitivity but does not validate a universal human readability boundary.', 'rows':rows}
    (out/'controlled.json').write_text(json.dumps(data,indent=2))
    tiles=[]
    for r in rows:
        tile=Image.new('RGB',(340,330),'#141b25');d=ImageDraw.Draw(tile)
        photo=Image.open(out/r['image']);s=min(290/photo.width,245/photo.height)
        photo=photo.resize((round(photo.width*s),round(photo.height*s)),Image.Resampling.NEAREST)
        tile.paste(photo,((340-photo.width)//2,50))
        m=r['measurement'];label='no extra encode' if r['crf'] is None else f'extra CRF {r["crf"]}'
        d.text((10,10),f'{m["median_texel_pitch"]:.2f} video px/sprite column',fill='white')
        d.text((10,28),label,fill='#9acaff')
        d.text((10,305),f'{m["retained_pairs"]}/{m["eligible_pairs"]} high-contrast edge pairs retained',fill='white')
        tiles.append(tile)
    sheet=Image.new('RGB',(340*6,330*4),'#0d121a')
    for i,tile in enumerate(tiles):sheet.paste(tile,((i//4)*340,(i%4)*330))
    sheet.save(out/'controlled-comparison.png')
    body=''.join(f'<tr><td>{r["target_pitch"]}</td><td>{"none" if r["crf"] is None else r["crf"]}</td><td>{r["measurement"]["retained_pairs"]}/{r["measurement"]["eligible_pairs"]}</td></tr>' for r in rows)
    page=f'<!doctype html><meta charset="utf-8"><title>Real flame detail sensitivity</title><style>body{{background:#111822;color:white;font:16px system-ui;margin:24px}}td{{padding:6px 18px}}img{{max-width:100%}}a{{color:#8fdfff}}</style><h1>Real flame: scaling and compression sensitivity</h1><p>{html.escape(data["definition"])}</p><p>Source: survival1 frame 3030, sheet 1, row 14. Original sampling: {case["pitch"]:.2f} video pixels per sprite column. Each enlarged panel shows the same real recorded flame; enlargement adds no detail.</p><p><b>No 8-video-pixel cutoff. No labels changed.</b> Eight distinguishable sprite columns remains a proposal requiring visual review. Edge pairs below are diagnostics, not a count of readable columns.</p><a href="controlled-comparison.png">Open comparison at full size</a><p><img src="controlled-comparison.png"></p><table><tr><th>Video px/sprite column</th><th>Extra CRF</th><th>Retained strong edges</th></tr>{body}</table><a href="readability.html">All 32 unmodified real-frame examples and limitations</a>'
    (out/'controlled.html').write_text(page,encoding='utf8')


def main():
    ap=argparse.ArgumentParser();ap.add_argument('out',type=Path);ap.add_argument('--per-target',type=int,default=4);ap.add_argument('--controlled-only',action='store_true');args=ap.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    if args.controlled_only:
        controlled(args.out);return
    sprites=[np.asarray(Image.open(ROOT/f'fire-detection/data/assets/fire_{s}.png').convert('RGBA')) for s in (0,1)]
    cases=candidates(args.per_target)
    for i,c in enumerate(cases):
        rgb=decode(c['source'],c['frame']);sprite=sprites[c['sheet']][c['row']*16:(c['row']+1)*16]
        c['measurement']=audit(rgb,sprite,np.asarray(c['matrix']));c['image']=f'readability-{i+1:02d}.png'
        draw(c,rgb,sprite,args.out/c['image'])
        print(json.dumps({'done':i+1,'total':len(cases),'pitch':c['pitch'],'retained':c['measurement']['retained_fraction']}),flush=True)
    report={'policy':'8 distinguishable sprite columns proposed; 16 reference. No tested cutoff yet; native width is not the criterion.',
        'method':'High-contrast (RGB L2>=70) opaque horizontal neighbouring texels; native sampled contrast>=12, expected direction cosine>=0.5, contrast>=2x within-texel variation. No interpolation in measurements.',
        'limitations':'Selected known block quads, two local recordings, no artificial re-encoding. Multiple overlapping quads, phase mismatch and visibility errors can mimic blur. Edge pass counts do not establish 8 or 16 uniquely distinguishable columns; insufficient evidence must remain unknown, never confident no-fire.',
        'cases':cases}
    (args.out/'readability.json').write_text(json.dumps(report,indent=2))
    cards=''.join(f'<article><h2>{c["source"]} frame {c["frame"]} · {c["pitch"]:.2f} video px/texel</h2><img src="{c["image"]}" width="1000" height="350"><p>{c["measurement"]["retained_pairs"]}/{c["measurement"]["eligible_pairs"]} eligible horizontal edge pairs retain contrast. <a href="{c["image"]}">Open image</a></p></article>' for c in sorted(cases,key=lambda c:c['pitch']))
    page=f'''<!doctype html><meta charset="utf-8"><title>Real sprite-column readability</title><style>body{{background:#0d121a;color:#e4eaf3;font:16px system-ui;margin:24px}}article{{border:1px solid #435065;padding:16px;margin:18px 0;width:1020px}}img{{max-width:none}}p{{max-width:1100px}}</style><h1>Can the sprite columns actually be distinguished?</h1><p>{html.escape(report['policy'])}</p><p>{html.escape(report['method'])}</p><p>{html.escape(report['limitations'])}</p><p>Left: real native pixels. Middle: enlarged native pixels. Right: sampled geometry aligned to the known sprite. Enlarging does not recover missing detail. Measurements cannot attribute all damage specifically to compression.</p>{cards}'''
    (args.out/'readability.html').write_text(page,encoding='utf8')


if __name__=='__main__': main()
