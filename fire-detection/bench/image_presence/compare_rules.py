"""Fixed-score comparison on identical frames; shared GUI/material/veil uncertainty gates.

No thresholds fitted, no training, no changed CNN pixels, no label writing.
Only the union of either method's raw candidates needs fresh full-resolution checks.
"""
import argparse
from concurrent.futures import ProcessPoolExecutor
import hashlib,json,subprocess,sys,time
from pathlib import Path
import numpy as np
from PIL import Image
from crop_v2 import load_base

CONTEXT=None

def counts(rows,key):
    fire=np.array([r['fire'] for r in rows],bool);clear=np.array([r[key] for r in rows],bool)
    return {'TP':int((clear&~fire).sum()),'FP':int((clear&fire).sum()),
            'eligible':int((~fire).sum()),'fire':int(fire.sum()),'coverage':float((clear&~fire).sum()/max(1,(~fire).sum()))}


def shared_blocked(gui_reliable,unveiled,share,material,purple):
    return (not gui_reliable) or (not unveiled and share>=.80) or material or purple


def compile_helper(root,out):
    # Include existing orange rules unchanged. The generated wrapper is a local artifact.
    fragment=(root/'fire-detection/bench/no_fire/fragment_rules.rs').as_posix()
    retention=(root/'fire-detection/bench/no_fire/retention_rules.rs').as_posix()
    src=f'''#[path="{fragment}"] #[allow(dead_code)] mod fragments;
#[path="{retention}"] #[allow(dead_code)] mod retention;
use std::io::{{self,Read,Write}};
fn main(){{let(w,h)=(1920,1080);let mut rgb=vec![0;w*h*3];let mut world=vec![0;w*h];let mut input=io::stdin().lock();let mut output=io::stdout().lock();
loop{{if input.read(&mut rgb[..1]).unwrap()==0{{break;}}input.read_exact(&mut rgb[1..]).unwrap();input.read_exact(&mut world).unwrap();
let area=fragments::largest(&fragments::mask(&rgb,w,h),w,h,4);
let retain=retention::components(&rgb,&world,w,h).iter().any(|c|c.0>=128&&c.3-c.1>=24&&c.4-c.2>=8);
writeln!(output,"{{{{\\"area\\":{{}},\\"retain\\":{{}}}}}}",area,retain).unwrap();output.flush().unwrap();}}}}
'''
    source=out/'frozen-rules.rs';source.write_text(src)
    binary=out/('frozen-rules.exe' if sys.platform=='win32' else 'frozen-rules')
    subprocess.run(['rustc','--edition','2021','-C','opt-level=3',str(source),'-o',str(binary)],check=True)
    return binary


def init_worker(root,baseline,binary):
    global CONTEXT
    root=Path(root);base=load_base(Path(__file__).with_name('pipeline.py'),root)
    from gui_mask_native import mask
    from translucency import detect
    helper=subprocess.Popen([str(binary)],stdin=subprocess.PIPE,stdout=subprocess.PIPE)
    CONTEXT=(root,Path(baseline),base,mask,detect,helper)


def check(item):
    root,baseline,base,mask,detect,helper=CONTEXT
    frame=item['frame'];video=root/'fire-detection/data/video'/base.SOURCES['survival1']
    # Original recordings are CFR60; verify cached CNN image views byte-for-byte below.
    raw=subprocess.check_output([str(root/'FireCrackle/src-tauri/runtime/ffmpeg.exe'),'-v','error','-threads','1',
        '-ss',str(frame/60),'-i',str(video),'-frames:v','1','-vf','scale=1920:1080','-pix_fmt','rgb24','-f','rawvideo','pipe:1'])
    rgb=np.frombuffer(raw,np.uint8).reshape(1080,1920,3)
    fixed,used,share=base.unveil(rgb,y0=12)
    arr=np.concatenate([base.views(rgb),base.views(fixed)]) if used else base.views(rgb)
    saved=np.load(baseline/item['file'])
    if not np.array_equal(arr,saved):raise ValueError(f'Frame/preprocessing mismatch at survival#{frame}')
    world,packed,gui=mask(rgb,vanilla_confirmed=True)
    material=detect(rgb,world)
    answers=[]
    for a in [rgb,fixed] if used else [rgb]:
        helper.stdin.write(a.tobytes());helper.stdin.write(world.tobytes());helper.stdin.flush()
        answers.append(json.loads(helper.stdout.readline()))
    area=max(a['area'] for a in answers)
    if area!=item['cached_area']:raise ValueError(f'Orange score drift at #{frame}: {area} != {item["cached_area"]}')
    purple=base.translucency_guard(rgb)['abstain']
    if purple!=item['abstain']:raise ValueError('Original guard changed')
    weak=not used and share>=.80;retain=bool(used and answers[-1]['retain'])
    common=shared_blocked(gui['reliable'],used,share,material['abstain'],purple)
    return {'frame':frame,'views_byte_identical':True,'gui':gui,'unveiled':used,'share':share,
            'material':material,'purple':purple,'weak_menu':weak,'retention':retain,'orange_area':area,
            'common_blocked':bool(common)}


def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('out',type=Path)
    ap.add_argument('--data-root',type=Path,required=True);ap.add_argument('--baseline-run',type=Path,required=True)
    ap.add_argument('--cnn-run',type=Path,required=True);ap.add_argument('--workers',type=int,default=6);args=ap.parse_args()
    out=args.out.resolve();out.mkdir(parents=True,exist_ok=True)
    if (out/'protocol.json').exists():raise ValueError('Fresh output folder required')
    root=args.data_root.resolve();baseline=args.baseline_run.resolve();cnn=args.cnn_run.resolve()
    base=load_base(Path(__file__).with_name('pipeline.py'),root)
    rows=json.loads((cnn/'test-predictions.json').read_text());cal=json.loads((cnn/'calibration.json').read_text())
    original={r['frame']:r for r in json.loads((root/'.board/no-fire-parallel/fragments/survival1.json').read_text())}
    if cal['weights_sha256']!=base.sha(cnn/'best.pt'):raise ValueError('Model weight mismatch')
    protocol=json.loads((cnn/'best.pt').with_name('report.json').read_text())['protocol']
    for name,digest in protocol['preprocessing_sha256'].items():
        if base.sha(root/'fire-detection/core/src'/name)!=digest:raise ValueError('Preprocessing changed')
    if {r['frame'] for r in rows}!=set(original):raise ValueError('Frame ID mismatch')
    pending=[]
    for r in rows:
        old=original[r['frame']]
        if old['truth']['substantial']!=r['fire']:raise ValueError('Width24 truth mismatch')
        r['cached_area']=old['scores']['all:r4'];r['cnn_score_clear']=r['score']<cal['threshold']
        r['orange_candidate']=r['cached_area']<2198
        if r['cnn_score_clear'] or r['orange_candidate']:pending.append(r)
    frozen={'scope':'919familiar survival frames; width24 meaningful fire; no fitting/tuning',
            'cnn_weights_sha256':cal['weights_sha256'],'cnn_threshold':cal['threshold'],'orange_threshold':2198,
            'cnn_input':'Original raw/auto global+8tiles; no GUI erasure or recalibration',
            'shared_gates':'Reliable canonical GUI, weak-menu abstention, GUI-conditionedmaterialv3 and original purple guard',
            'deterministic_evidence':'Original all-pixel orange max(raw,auto)area plus restored-only128/24/8 retention; GUI only material/retention, same as desktop',
            'candidate_union':len(pending),'frame_ids_sha256':hashlib.sha256(json.dumps([r['frame'] for r in rows]).encode()).hexdigest(),
            'preprocessing_sha256':protocol['preprocessing_sha256'],
            'source_sha256':{n:base.sha(root/'fire-detection/bench/no_fire'/n) for n in ['fragment_rules.rs','retention_rules.rs','translucency.py','gui_mask_native.py','gui_mask_bridge.rs']},
            'status':'Research only, no release changes, no proof of fire absence; familiar correlated evaluation'}
    (out/'protocol.json').write_text(json.dumps(frozen,indent=2));binary=compile_helper(root,out)
    evidence={};start=time.time()
    with ProcessPoolExecutor(max_workers=args.workers,initializer=init_worker,initargs=(root,baseline,binary)) as pool:
        for item in pool.map(check,pending):
            evidence[item['frame']]=item
            (out/'evidence.json').write_text(json.dumps(list(evidence.values()),indent=2))
            if len(evidence)%20==0:print(json.dumps({'checked':len(evidence),'total':len(pending),'seconds':round(time.time()-start)}),flush=True)
    for row in rows:
        e=evidence.get(row['frame']);row['evidence']=e
        blocked=e['common_blocked'] if e else True
        row['cnn_original']=bool(row['cnn_score_clear'] and not row['abstain'])
        row['cnn_matched']=bool(row['cnn_score_clear'] and not blocked)
        row['rules_matched']=bool(row['orange_candidate'] and not blocked and not e['retention']) if e else False
        # Desktop-style gates omit the older additional purple guard. Material
        # checks here use the research NumPy implementation, not the app binary.
        row['rules_desktop']=bool(row['orange_candidate'] and e and e['gui']['reliable'] and not e['weak_menu'] and not e['material']['abstain'] and not e['retention'])
        row['rules_research']=bool(row['orange_candidate'] and e and not e['material']['abstain'] and not e['retention'])
        row['union']=row['cnn_matched'] or row['rules_matched']
        row['cnn_only']=row['cnn_matched'] and not row['rules_matched']
        row['rules_only']=row['rules_matched'] and not row['cnn_matched']
    report={'protocol':frozen,'methods':{k:counts(rows,k) for k in ['cnn_original','rules_research','rules_desktop','cnn_matched','rules_matched','union','cnn_only','rules_only']},
            'both_clear':sum(r['cnn_matched'] and r['rules_matched'] for r in rows),
            'caveat':'Shared gates do not alter CNN pixels or weights. Material/GUI are heuristics, not oracle. rules_desktop is desktop-style research emulation, not app-binary parity. Combination is descriptive only, not adopted.'}
    (out/'predictions.json').write_text(json.dumps(rows,indent=2));(out/'report.json').write_text(json.dumps(report,indent=2))
    for key in ['cnn_only','rules_only','cnn_matched','rules_matched']:
        for label,selected in [('TP',[r for r in rows if r[key] and not r['fire']]),('FP',[r for r in rows if r[key] and r['fire']])]:
            for i in range(0,len(selected),24):base.sheet(selected[i:i+24],baseline,out/f'{key}-{label}-{i//24}.png',f'{key} {label}')
    print(json.dumps(report['methods']),flush=True)


if __name__=='__main__':main()
