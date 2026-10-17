"""Evaluate the frozen rules+MobileNetV3 ensemble on EVERY decoded video frame.

Research only: no fitting/calibration or application-label writes. Exact original
pixel rules are linked from source; stage two checks only possible clears.
"""
import argparse,ctypes,hashlib,json,subprocess,sys,time
from collections import deque
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from queue import Queue
from threading import Thread
import numpy as np
from PIL import Image,ImageDraw
from crop_v2 import load_base
from compare_rules import shared_blocked

CTX=None
HIDDEN={'creationflags':subprocess.CREATE_NO_WINDOW} if sys.platform=='win32' else {}

def read(path):return json.loads(path.read_text())
def digest(arr):return hashlib.sha256(arr.tobytes()).hexdigest()
def digest_source(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def decode_all(base,source):
    command=[str(base.ROOT/'FireCrackle/src-tauri/runtime/ffmpeg.exe'),'-v','error','-threads','3','-i',
        str(base.ROOT/'fire-detection/data/video'/base.SOURCES[source]),'-vf','scale=1920:1080',
        '-fps_mode','passthrough','-pix_fmt','rgb24','-f','rawvideo','pipe:1']
    proc=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE,**HIDDEN)
    try:
        n=0;size=1920*1080*3
        while True:
            raw=bytearray()
            while len(raw)<size:
                chunk=proc.stdout.read(size-len(raw))
                if not chunk:break
                raw.extend(chunk)
            if not raw:break
            if len(raw)!=size:raise ValueError('Truncated RGB frame')
            yield n,np.frombuffer(raw,np.uint8).reshape(1080,1920,3);n+=1
        error=proc.stderr.read().decode(errors='replace')
        if proc.wait():raise RuntimeError(error)
    finally:
        if proc.poll() is None:proc.terminate();proc.wait()
        proc.stdout.close();proc.stderr.close()

def build_rules(root,out):
    fragment=(root/'fire-detection/bench/no_fire/fragment_rules.rs').as_posix()
    retention=(root/'fire-detection/bench/no_fire/retention_rules.rs').as_posix()
    source=out/'rules_abi.rs'
    source.write_text(f'''#[path="{fragment}"] #[allow(dead_code)] mod fragments;
#[path="{retention}"] #[allow(dead_code)] mod retention;
#[no_mangle] pub unsafe extern "C" fn area(p:*const u8)->usize{{
let rgb=std::slice::from_raw_parts(p,1920*1080*3);
fragments::largest(&fragments::mask(rgb,1920,1080),1920,1080,4)}}
#[no_mangle] pub unsafe extern "C" fn retain(p:*const u8,m:*const u8)->bool{{
let rgb=std::slice::from_raw_parts(p,1920*1080*3);let world=std::slice::from_raw_parts(m,1920*1080);
retention::components(rgb,world,1920,1080).iter().any(|c|c.0>=128&&c.3-c.1>=24&&c.4-c.2>=8)}}
''')
    dll=out/('rules.dll' if sys.platform=='win32' else 'rules.so')
    subprocess.run(['rustc','--edition','2021','--crate-type','cdylib','-C','opt-level=3',str(source),'-o',str(dll)],check=True,**HIDDEN)
    return dll

def init(root,dll,source,out):
    global CTX
    root=Path(root);base=load_base(Path(__file__).with_name('pipeline.py'),root)
    from gui_mask_native import mask
    from translucency import detect
    lib=ctypes.CDLL(str(dll));ptr=ctypes.POINTER(ctypes.c_uint8)
    lib.area.argtypes=[ptr];lib.area.restype=ctypes.c_size_t
    lib.retain.argtypes=[ptr,ptr];lib.retain.restype=ctypes.c_bool
    CTX=(root,base,lib,ptr,mask,detect,source,Path(out))

def area(rgb):
    return CTX[2].area(rgb.ctypes.data_as(CTX[3]))

def preprocess(task):
    n,rgb=task;_,base,_,_,_,_,_,_=CTX
    fixed,used,share=base.unveil(rgb,y0=12)
    arr=np.concatenate([base.views(rgb),base.views(fixed)]) if used else base.views(rgb)
    score=max(area(rgb),area(fixed)) if used else area(rgb)
    return {'frame':n,'orange_area':int(score),'unveiled':used,'share':share,'views_sha256':digest(arr)},arr

def ordered_preprocess(base,source,pool,workers):
    pending=deque()
    for n,rgb in decode_all(base,source):
        pending.append(pool.submit(preprocess,(n,rgb)))
        if len(pending)>=workers*2:yield pending.popleft().result()
    while pending:yield pending.popleft().result()

def prefetched(iterator):
    queue=Queue(maxsize=8)
    def produce():
        try:
            for item in iterator:queue.put(item)
        except BaseException as e:queue.put(e)
        finally:queue.put(None)
    Thread(target=produce,daemon=True).start()
    while True:
        item=queue.get()
        if item is None:return
        if isinstance(item,BaseException):raise item
        yield item

def gate(item):
    root,base,lib,ptr,mask,detect,source,out=CTX
    n=item['frame'];video=root/'fire-detection/data/video'/base.SOURCES[source]
    raw=subprocess.check_output([str(root/'FireCrackle/src-tauri/runtime/ffmpeg.exe'),'-v','error','-threads','1',
        '-ss',str(n/60),'-i',str(video),'-frames:v','1','-vf','scale=1920:1080','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],**HIDDEN)
    rgb=np.frombuffer(raw,np.uint8).reshape(1080,1920,3)
    return gate_rgb(item,rgb)

def gate_rgb(item,rgb):
    root,base,lib,ptr,mask,detect,source,out=CTX
    n=item['frame']
    evidence,arr=preprocess((n,rgb))
    if evidence['views_sha256']!=item['views_sha256'] or evidence['orange_area']!=item['orange_area']:
        raise ValueError(f'Sequential/seek frame mismatch at {n}')
    fixed,used,share=base.unveil(rgb,y0=12)
    world,_,gui=mask(rgb,vanilla_confirmed=True);material=detect(rgb,world)
    purple=base.translucency_guard(rgb)['abstain']
    retention=bool(used and lib.retain(fixed.ctypes.data_as(ptr),world.ctypes.data_as(ptr)))
    blocked=bool(shared_blocked(gui['reliable'],used,share,material['abstain'],purple))
    row=dict(item,gui=gui,material=material,purple=purple,retention=retention,common_blocked=blocked)
    row['cnn']=bool(item['cnn_candidate'] and not blocked)
    row['rules']=bool(item['orange_area']<2198 and not blocked and not retention)
    row['union']=row['cnn'] or row['rules']
    if row['union']:
        thumb=out/'clears'/f'{n}.jpg';Image.fromarray(rgb).resize((384,216)).save(thumb,quality=90)
        row['thumbnail']=str(thumb)
        if item.get('fire') is True:Image.fromarray(rgb).save(out/'failures'/f'{n}.png')
    return row

def metrics(rows,key):
    valid=[r for r in rows if r['fire'] is not None]
    tp=sum(bool(r[key]) and not r['fire'] for r in valid);fp=sum(bool(r[key]) and r['fire'] for r in valid)
    eligible=sum(not r['fire'] for r in valid);fire=sum(r['fire'] for r in valid)
    return {'TP':tp,'FP':fp,'eligible':eligible,'fire':fire,'TP_rate':tp/eligible if eligible else None,
        'FP_rate':fp/fire if fire else None,'total_cleared':sum(bool(r[key]) for r in rows),
        'unscored_clears':sum(bool(r[key]) and r['fire'] is None for r in rows)}

def intervals(rows):
    groups=[]
    for r in rows:
        if not r['union']:continue
        n=r['frame']
        if groups and n==groups[-1]['end']+1:groups[-1]['end']=n
        else:groups.append({'start':n,'end':n})
    for g in groups:g['seconds']=(g['end']-g['start']+1)/60
    return groups

def sheets(rows,out,prefix):
    for start in range(0,len(rows),24):
        batch=rows[start:start+24];canvas=Image.new('RGB',(384*4,244*((len(batch)+3)//4)),(27,31,39));draw=ImageDraw.Draw(canvas)
        for i,r in enumerate(batch):
            x=(i%4)*384;y=(i//4)*244;canvas.paste(Image.open(r['thumbnail']),(x,y))
            draw.text((x+4,y+218),f"Frame {r['frame']} at {r['frame']/60:.3f}s fire={r['fire']}",fill='white')
        canvas.save(out/f'{prefix}-{start//24}.jpg',quality=90)

def main():
    import torch
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('out',type=Path)
    ap.add_argument('--data-root',type=Path,required=True);ap.add_argument('--cnn-run',type=Path,required=True)
    ap.add_argument('--comparison',type=Path,required=True);ap.add_argument('--baseline-run',type=Path,required=True)
    ap.add_argument('--source',default='clip2',choices=['clip1','clip2','quad1','survival1']);ap.add_argument('--workers',type=int,default=6)
    args=ap.parse_args();out=args.out.resolve();root=args.data_root.resolve();out.mkdir(parents=True,exist_ok=True)
    if (out/'protocol.json').exists():raise ValueError('Fresh output directory required')
    base=load_base(Path(__file__).with_name('pipeline.py'),root);torch.set_num_threads(4)
    cal=read(args.cnn_run/'calibration.json');prior=read(args.comparison/'protocol.json')
    if cal['weights_sha256']!=base.sha(args.cnn_run/'best.pt') or cal['threshold']!=prior['cnn_threshold']:raise ValueError('Checkpoint/calibration changed')
    for name,expected in prior['preprocessing_sha256'].items():
        if base.sha(root/'fire-detection/core/src'/name)!=expected:raise ValueError('Preprocessing changed')
    for name,expected in prior['source_sha256'].items():
        if base.sha(root/'fire-detection/bench/no_fire'/name)!=expected:raise ValueError('Gate source changed')
    targets,info=base.target_rows(args.source,1,24)
    protocol={'source':args.source,'stride':1,'target_info':info,'weights_sha256':cal['weights_sha256'],'threshold':cal['threshold'],
        'rules_threshold':2198,'comparison_protocol_sha256':base.sha(args.comparison/'protocol.json'),'source_sha256':base.sha(__file__),
        'status':'EVERY decoded frame; frozen ensemble and guards; no fitting/tuning/labelwrites. clip2 supplied calibration; familiar diagnostic, not independent validation.',
        'unknown_labels':'Scan all frames; excluded only from supervised rates, counted separately.',
        'shared_sources':prior,'workers':args.workers}
    (out/'protocol.json').write_text(json.dumps(protocol,indent=2));dll=build_rules(root,out)
    for folder in ['clears','failures']:(out/folder).mkdir()
    model=base.make_model(False).to('cuda').eval();cp=torch.load(args.cnn_run/'best.pt',map_location='cuda',weights_only=False);model.load_state_dict(cp['state']);del cp
    sampled={r['frame']:r for r in read(args.cnn_run/'calibration-predictions.json') if r['source']==args.source}
    parity=[];start=time.time();rows=[]
    with ProcessPoolExecutor(max_workers=args.workers,initializer=init,initargs=(root,dll,args.source,out)) as pool:
        with (out/'scores.jsonl').open('w') as stream,torch.inference_mode():
            for row,arr in prefetched(ordered_preprocess(base,args.source,pool,args.workers)):
                n=row['frame']
                if n!=len(rows):raise ValueError('Nonconsecutive decoded frame IDs')
                score=float(model(base.tensor_views(arr,'cuda')).max().cpu())
                truth=targets.get(n);row.update(score=score,cnn_candidate=score<cal['threshold'],fire=truth['fire'] if truth else None,
                    raw_fire=truth['raw_fire'] if truth else None,cnn=False,rules=False,union=False)
                if n in sampled:
                    old=sampled[n];saved=np.load(args.baseline_run/old['file'])
                    if not np.array_equal(arr,saved) or abs(score-old['score'])>1e-5:raise ValueError(f'Sampled parity failure at {n}')
                    parity.append({'frame':n,'views_byte_identical':True,'score_delta':score-old['score']})
                stream.write(json.dumps(row)+'\n');rows.append(row)
                if len(rows)%500==0:
                    stream.flush();progress={'stage':'scores','frames':len(rows),'seconds':round(time.time()-start),'raw_candidates':sum(r['cnn_candidate'] or r['orange_area']<2198 for r in rows)}
                    (out/'progress.json').write_text(json.dumps(progress));print(json.dumps(progress),flush=True)
        del model;torch.cuda.empty_cache()
        if len(rows)<info['total_frames']:raise ValueError('Decoded video shorter than labels')
        if any(n>=len(rows) for n in targets):raise ValueError('Label outside decoded video')
        if set(sampled)!={r['frame'] for r in parity}:raise ValueError('Incomplete sampled parity')
        (out/'sampled-parity.json').write_text(json.dumps(parity,indent=2))
        candidates=[r for r in rows if r['cnn_candidate'] or r['orange_area']<2198]
        with (out/'gates.jsonl').open('w') as stream:
            for i,r in enumerate(pool.map(gate,candidates),1):
                rows[r['frame']]=r;stream.write(json.dumps(r)+'\n')
                if i%50==0:
                    stream.flush();progress={'stage':'gates','checked':i,'candidates':len(candidates),'seconds':round(time.time()-start)}
                    (out/'progress.json').write_text(json.dumps(progress));print(json.dumps(progress),flush=True)
    groups=intervals(rows);failures=[r for r in rows if r['union'] and r['fire'] is True]
    report={'protocol':protocol,'decoded_frames':len(rows),'valid_labels':sum(r['fire'] is not None for r in rows),'unknown_labels':sum(r['fire'] is None for r in rows),
        'sampled_parity_count':len(parity),'gated_candidates':len(candidates),'methods':{k:metrics(rows,k) for k in ['cnn','rules','union']},
        'clear_intervals':groups,'FP_frames':[r['frame'] for r in failures],'seconds':time.time()-start,
        'caveat':'Frame results highly correlated; clip2 also supplied calibration. Width24 proxy truth, not readability oracle. Guards heuristic. No claim of generalization.'}
    (out/'predictions.json').write_text(json.dumps(rows));(out/'report.json').write_text(json.dumps(report,indent=2))
    sheets(failures,out,'false-clears')
    # One representative per contiguous correct-clear interval, rather than thousands of near-identical images.
    reps=[rows[(g['start']+g['end'])//2] for g in groups if rows[(g['start']+g['end'])//2]['fire'] is False]
    sheets(reps,out,'correct-clear-intervals')
    print(json.dumps({k:v for k,v in report.items() if k not in ['protocol','clear_intervals']}),flush=True)

if __name__=='__main__':main()
