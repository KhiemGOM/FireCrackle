"""Visual audit of all rough-quad boundary regressions and rescues."""
import json
import sys
import hashlib
import subprocess
from datetime import datetime, timezone
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from render import ROOT, rectify, load_sprites

OUT=ROOT/'.board/boundary-robust'
DATA=ROOT/'FireCrackle/src-tauri/target/actual-quad1'


def rough(quad):
    # Use the same projective definition as the JS experiment, not an affine approximation.
    from gpu_render import homography,projected
    import torch
    q=torch.tensor(np.asarray(quad)*[1920,1080],dtype=torch.float64)[None]
    uv=torch.tensor([[(u-.5)*1.12+.5+.03+(i==1)*.02,
                      (v-.5)*.92+.5-.02+(i==2)*.02]
                     for i,(u,v) in enumerate([(0,0),(1,0),(1,1),(0,1)])],dtype=torch.float64)
    return projected(homography(q),uv)[0].numpy()


def main():
    OUT.mkdir(parents=True,exist_ok=True)
    rows=json.loads((ROOT/'.board/plane-groups/ported/joint-rough-validation.json').read_text())['rows']
    manifest={r['id']:r for r in json.loads((DATA/'manifest.json').read_text())['samples']}
    selected=[('LOSS' if r['baseline']['correct'] else 'GAIN',r) for r in rows
              if r['baseline']['correct'] != r['joint'][2]['correct']]
    sprites=load_sprites();cards=[]
    for kind,r in selected:
        case=manifest[r['id']];native=np.fromfile(DATA/f'{r["frame"]}.rgb',np.uint8).reshape(1080,1920,3)
        exact=np.asarray(case['quad'])*[1920,1080];perturbed=rough(case['quad'])
        points=np.concatenate([exact,perturbed]);lo=np.floor(points.min(0)-12).clip([0,0],[1919,1079]).astype(int)
        hi=np.ceil(points.max(0)+12).clip([1,1],[1920,1080]).astype(int)
        scene=Image.fromarray(native).crop((*lo,*hi));sx,sy=320/scene.width,180/scene.height
        scene=scene.resize((320,180));draw=ImageDraw.Draw(scene)
        for q,col in [(exact,'cyan'),(perturbed,'orange')]:
            p=[((x-lo[0])*sx,(y-lo[1])*sy) for x,y in q];draw.line(p+[p[0]],fill=col,width=2)
        card=Image.new('RGB',(1120,220),(18,22,29));draw=ImageDraw.Draw(card)
        card.paste(scene,(0,28));draw.text((4,5),f'{kind} {r["id"]} cyan=recorded orange=rough',fill='white')
        for x,name,q in [(330,'Recorded crop',exact),(470,'Rough crop',perturbed)]:
            card.paste(Image.fromarray(rectify(native,q)).resize((128,128),Image.Resampling.NEAREST),(x,30));draw.text((x,164),name,fill='white')
        truth=case['expected'][0]*64+case['expected'][1]*2+int(case['expected'][2])
        for x,name,index in [(620,'TRUTH',truth),(780,'Colour',r['baseline']['top']),(940,'Boundaries',r['joint'][2]['top'])]:
            sprite=sprites[index].copy();sprite[sprite[:,:,3]==0]=[26,28,34,255]
            card.paste(Image.fromarray(sprite[:,:,:3]).resize((128,128),Image.Resampling.NEAREST),(x,30))
            draw.text((x,164),f'{name}: S{index//64} R{index%64//2} M{index%2}',fill='white')
        draw.text((330,192),f'Colour margin {r["baseline"]["margin"]:.6f}; boundary margin {r["joint"][2]["margin"]:.6f}',fill='white')
        cards.append(card)
    for start in range(0,len(cards),5):
        page=Image.new('RGB',(1120,220*len(cards[start:start+5])))
        for i,card in enumerate(cards[start:start+5]):page.paste(card,(0,i*220))
        page.save(OUT/f'audit-{start//5}.png')
    (OUT/'audit-cases.json').write_text(json.dumps(selected,indent=2))
    print(f'{len(cards)} paired change cases saved')


def select():
    exact=json.loads((OUT/'tune/exact/tune-exact.json').read_text())
    rough_data=json.loads((OUT/'tune/rough/tune-rough.json').read_text())
    assert exact['scriptSHA256']==rough_data['scriptSHA256']
    candidates=[]
    for index,name in enumerate(exact['summary']):
        a=exact['summary'][name]['top1'];b=rough_data['summary'][name]['top1']
        da=a-exact['summary']['colour']['top1'];db=b-rough_data['summary']['colour']['top1']
        candidates.append(dict(name=name,exact=a,rough=b,min_gain=min(da,db),sum_gain=da+db,index=index))
    ranked=sorted(candidates,key=lambda c:(-c['min_gain'],-c['sum_gain'],c['index']))
    frozen=dict(selected=ranked[0]['name'],rule='Maximize minimum net top-one gain over colour across exact/rough818 tuning cases; then summed net gain; then declared method order.',
                created_utc=datetime.now(timezone.utc).isoformat(),scriptSHA256=exact['scriptSHA256'],hashes=exact['hashes'],candidates=ranked,
                visibility_limit='Tuning has814block/4overlay and no entities; all validation recordings were used for past research and are development diagnostics.')
    (OUT/'frozen.json').write_text(json.dumps(frozen,indent=2))
    print(json.dumps(frozen,indent=2))


def prepare_holdout():
    from prepare_real import geometry
    from prepare_survival_train import balanced_select
    folder=OUT/'additional';folder.mkdir(parents=True,exist_ok=True)
    forbidden=set()
    for path in [ROOT/'.board/fire-ai/survival/manifest.json',ROOT/'.board/fire-ai/survival-train-dense/manifest.json',ROOT/'.board/fire-ai/baseline-reviewed/manifest.json']:
        forbidden.update(r['frame'] for r in json.loads(path.read_text())['samples'])
    cases=[];frames=[];digest=hashlib.sha256()
    joined=ROOT/'fire-detection/data/joined/survival1.jsonl'
    with joined.open('rb') as stream:
        for line in stream:
            digest.update(line);r=json.loads(line);n=r['n']
            if len(frames)>=40 or not 42000<=n<81000 or n%60!=47 or not r['tick_ok'] or any(abs(n-f)<=60 for f in forbidden):continue
            label=r['label'];w,h=label['w'],label['h'];items=[]
            for fi,fire in enumerate(label.get('fires',[])):
                if fire['src'] not in ['block','entity']:continue
                for qi,q in enumerate(fire.get('quads',[])):
                    corners,error=geometry.canonical_quad(q,w,h)
                    if error:continue
                    quad=np.asarray(corners)/[w,h];edges=np.linalg.norm((quad-np.roll(quad,1,axis=0))*[1920,1080],axis=1)
                    if q['vis']<.95 or q['veil']>.05 or quad.min()<.01 or quad.max()>.99 or edges.min()<40 or edges.max()/edges.min()>5:continue
                    items.append(dict(id=f'{n}-{fi}-{qi}',frame=n,quad=quad.tolist(),expected=[q['s'],q['row'],bool(q['m'])],source=fire['src'],visibility=q['vis'],veil=q['veil'],split='validation',min_edge=float(edges.min())))
            kept=[]
            for source in ['block','entity']:
                group=sorted([x for x in items if x['source']==source],key=lambda x:(-x['min_edge'],x['id']))
                kept.extend(group[:2])
            if kept:frames.append(n);cases.extend(kept)
    if not cases:raise RuntimeError('No additional cases met preset geometry rules')
    protocol=dict(selected='jitter_max_pairs1',created_utc=datetime.now(timezone.utc).isoformat(),
                  rule='Additional survival frames42000..80999 with n%60=47; at least61frames from every previous survival/dense/reviewed case; first40eligibleframes; up to2largest-min-edge block and2entity quads/frame; no RGB or class-score screening.',
                  availability_revision='Initial45000/n%240/121-frame separation produced only1frame2quads. Revised using geometry counts only, before inspecting the new HUD or running any new predictions; revised pool19frames38quads.',
                  caveat='Previously unused frames within the same recording, not a new independent video. Fresh method chosen after reused diagnostic results.',
                  excluded_frames=sorted(forbidden),frames=frames,case_ids=[c['id'] for c in cases],scriptSHA256=json.loads((OUT/'frozen.json').read_text())['scriptSHA256'])
    (folder/'protocol.json').write_text(json.dumps(protocol,indent=2))
    (folder/'manifest.json').write_text(json.dumps(dict(width=1920,height=1080,joined_sha256=digest.hexdigest(),samples=cases),indent=2))
    print(json.dumps(dict(frames=len(frames),cases=len(cases),first=frames[0],last=frames[-1],selected=protocol['selected'])),flush=True)
    missing=[n for n in frames if not (folder/f'{n}.rgb').exists()]
    if missing:
        controls={n:hashlib.sha256((folder/f'{n}.rgb').read_bytes()).hexdigest() for n in frames if (folder/f'{n}.rgb').exists()}
        # Fast CFR seek is accepted only after matching a sequentially decoded
        # native frame byte-for-byte. Otherwise repeat the full sequential decode.
        seek_frame=42000 if controls else 0
        def decode(offset):
            command=[str(ROOT/'FireCrackle/src-tauri/runtime/ffmpeg.exe'),'-v','error']
            if offset:command+=['-ss',str(offset/60)]
            command+=['-i',str(ROOT/'fire-detection/data/video/2026-10-16 18-23-42.mkv'),'-vf',f"select='{balanced_select([n-offset for n in frames])}'",'-frames:v',str(len(frames)),'-fps_mode','passthrough','-pix_fmt','rgb24','-f','rawvideo','pipe:1']
            proc=subprocess.Popen(command,stdout=subprocess.PIPE)
            try:
                for n in frames:
                    data=bytearray()
                    while len(data)<1920*1080*3:
                        part=proc.stdout.read(1920*1080*3-len(data))
                        if not part:raise RuntimeError(f'Truncated additional frame{n}')
                        data.extend(part)
                    (folder/f'{n}.rgb').write_bytes(data)
            finally:proc.stdout.close()
            if proc.wait():raise RuntimeError('Additional frame decode failed')
        decode(seek_frame)
        verified=all(hashlib.sha256((folder/f'{n}.rgb').read_bytes()).hexdigest()==h for n,h in controls.items())
        if seek_frame and not verified:decode(0)
        protocol['decode_alignment']=dict(seek_frame=seek_frame,reference_frame_hashes=controls,fast_seek_verified=bool(seek_frame and verified),sequential_fallback=bool(seek_frame and not verified))
        (folder/'protocol.json').write_text(json.dumps(protocol,indent=2))
    hud=Image.new('RGB',(4*360,((len(frames)+3)//4)*100),(18,22,29));draw=ImageDraw.Draw(hud)
    for i,n in enumerate(frames):
        image=np.fromfile(folder/f'{n}.rgb',np.uint8).reshape(1080,1920,3)
        crop=Image.fromarray(image).crop((600,930,1320,1080)).resize((360,75))
        x,y=i%4*360,i//4*100;hud.paste(crop,(x,y+18));draw.text((x+3,y+2),str(n),fill='white')
    hud.save(folder/'hud-audit.png')
    print('Additional native frames ready; inspect HUD before scoring.',flush=True)


def prepare_codec():
    for name in ['uncompressed','h264-crf24','h264-crf32']:
        source=ROOT/'.board/fire-ai/large-bg/codec'/f'{name}.npz'
        directory=OUT/'codec-data'/name;directory.mkdir(parents=True,exist_ok=True)
        with np.load(source) as data:
            assert data['x'].shape==(1024,64,64,3)
            cases=[]
            for i,(image,truth) in enumerate(zip(data['x'],data['y'])):
                truth=int(truth);assert 0<=truth<128
                (directory/f'{i}.rgb').write_bytes(image.tobytes())
                cases.append(dict(id=f'{name}-{i}',frame=i,quad=[[0,0],[1,0],[1,1],[0,1]],expected=[truth//64,truth%64//2,bool(truth%2)],source='synthetic',split='validation'))
        manifest=dict(width=64,height=64,source_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),samples=cases,
                      caveat='Exact saved rectified64x64 codec crops, not native160x160 scene geometry. Same preprocessing for every method; no new encode.')
        (directory/'manifest.json').write_text(json.dumps(manifest))
        print(name,len(cases),flush=True)


def summarize():
    """Verify saved predictions and emit tables without rerunning model selection."""
    reports={}
    for group in ['tune','quad1','survival','reviewed','additional-scores']:
        split='tune' if group=='tune' else 'validation'
        for mode in ['exact','rough']:
            reports[f'{group}/{mode}']=json.loads((OUT/group/mode/f'{split}-{mode}.json').read_text())
    for name in ['uncompressed','h264-crf24','h264-crf32']:
        reports[f'codec/{name}']=json.loads((OUT/'codec-scores'/name/'validation-exact.json').read_text())
    frozen=json.loads((OUT/'frozen.json').read_text())
    methods=list(next(iter(reports.values()))['summary'])
    assert len(methods)==25
    for key,report in reports.items():
        assert report['scriptSHA256']==frozen['scriptSHA256'],key
        assert report['n']==len(report['rows']),key
        assert list(report['summary'])==methods,key
        for method in methods:
            assert report['summary'][method]['top1']==sum(r['methods'][method]['correct'] for r in report['rows']),(key,method)
            for r in report['rows']:
                truth=r['expected'][0]*64+r['expected'][1]*2+int(r['expected'][2])
                assert r['methods'][method]['correct']==(r['methods'][method]['top']==truth),(key,r['id'],method)
    protocol=json.loads((OUT/'additional/protocol.json').read_text())
    assert protocol['selected']=='jitter_max_pairs1'
    assert all(abs(n-f)>60 for n in protocol['frames'] for f in protocol['excluded_frames'])
    assert protocol['decode_alignment']['fast_seek_verified']
    assert hashlib.sha256((ROOT/'FireCrackle/scripts/boundary-robust-eval.mjs').read_bytes()).hexdigest()==frozen['scriptSHA256']
    for name,digest in next(iter(reports.values()))['hashes'].items():
        assert hashlib.sha256((ROOT/f'FireCrackle/src/lib/{name}.ts').read_bytes()).hexdigest()==digest,name
        assert all(r['hashes'][name]==digest for r in reports.values())
    result=dict(cases=sum(r['n'] for r in reports.values()),methods=len(methods),
                scriptSHA256=frozen['scriptSHA256'],reports={k:dict(n=v['n'],summary=v['summary']) for k,v in reports.items()})
    result['predictions']=result['cases']*result['methods']
    assert result['cases']==5538
    masks=json.loads((OUT/'mask-controls.json').read_text())
    assert masks['cases']==1536
    assert masks['scriptSHA256']==hashlib.sha256((ROOT/'FireCrackle/scripts/boundary-mask-controls.mjs').read_bytes()).hexdigest()
    assert sum(v['classification']['current']['cases'] for v in masks['results'].values())==384
    # Paired resampling keeps quads from the same video frame together. These
    # intervals still cannot account for all temporal or same-recording dependence.
    intervals={}
    for key,report in reports.items():
        if key.startswith(('tune/','codec/')):continue
        frames=sorted({r['frame'] for r in report['rows']})
        groups=[[r for r in report['rows'] if r['frame']==frame] for frame in frames]
        rng=np.random.default_rng(20261017)
        draws=rng.integers(0,len(groups),size=(10000,len(groups)))
        sizes=np.array([len(g) for g in groups]);denom=sizes[draws].sum(axis=1)
        intervals[key]={}
        for method in ['pairs4','facing1','pairs1','gradient1','jitter_max_pairs1']:
            delta=np.array([sum(int(r['methods'][method]['correct'])-int(r['methods']['colour']['correct']) for r in g) for g in groups])
            low,high=np.quantile(100*delta[draws].sum(axis=1)/denom,[.025,.975])
            intervals[key][method]=dict(frames=len(frames),net_correct=int(delta.sum()),percentage_point_interval=[float(low),float(high)])
    result['paired_frame_bootstrap']=intervals
    (OUT/'summary.json').write_text(json.dumps(result,indent=2))
    def table(keys):
        lines=['| Method | '+' | '.join(keys)+' |','|---|'+'---:|'*len(keys)]
        for method in methods:
            lines.append('| '+method+' | '+' | '.join(str(reports[k]['summary'][method]['top1']) for k in keys)+' |')
        return '\n'.join(lines)
    sections={
        'real': ['quad1/exact','quad1/rough','survival/exact','survival/rough','additional-scores/exact','additional-scores/rough'],
        'codec':['codec/h264-crf24','codec/h264-crf32'],
        'tune':['tune/exact','tune/rough'],
    }
    for name,keys in sections.items():(OUT/f'table-{name}.md').write_text(table(keys))
    print(json.dumps(dict(cases=result['cases'],methods=len(methods),predictions=result['predictions'],verified=True)))


if __name__=='__main__':
    if '--select' in sys.argv:select()
    elif '--prepare-holdout' in sys.argv:prepare_holdout()
    elif '--prepare-codec' in sys.argv:prepare_codec()
    elif '--summarize' in sys.argv:summarize()
    else:main()
