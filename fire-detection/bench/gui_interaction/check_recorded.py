"""Functional development check of the fixed source-template detector.

No AI training/fitting/calibration. One real frame at the midpoint of each
contiguous labelled screen visit (including closed/unsupported screens).
The clips share one session: this is not independent validation or a 99% claim.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import statistics
import subprocess
import threading

ROOT=Path(__file__).resolve().parents[3]
SOURCES=[
    ('2026-10-20 14-09-57.mkv', '.board/gui-recording-audit/aligned-frames.jsonl'),
    ('2026-10-20 14-22-45.mkv', '.board/gui-supplement-audit/aligned-frames.jsonl'),
]


def samples(path):
    rows=[json.loads(line) for line in path.read_text(encoding='utf-8').splitlines()]
    groups=[]
    for row in rows:
        if not row['stable_render_state']:continue
        if not groups or row['screen_type']!=groups[-1][-1]['screen_type'] or row['video_frame']!=groups[-1][-1]['video_frame']+1:
            groups.append([])
        groups[-1].append(row)
    return [g[len(g)//2] for g in groups]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    binary=ROOT/'fire-detection/core/target/release/examples/gui_interaction_frame.exe'
    ffmpeg=ROOT/'FireCrackle/src-tauri/runtime/ffmpeg.exe'
    manifest=json.loads((args.assets/'manifest.json').read_text(encoding='utf-8'))
    supported={t['screen_type'] for t in manifest['templates']}
    report=[]
    all_predictions=[]
    for filename,joined in SOURCES:
        chosen=samples(ROOT/joined)
        def balanced(parts):
            if len(parts)==1:return parts[0]
            middle=len(parts)//2
            return '('+balanced(parts[:middle])+'+'+balanced(parts[middle:])+')'
        select=balanced([f'eq(n\\,{r["video_frame"]})' for r in chosen])
        decoder=subprocess.Popen([str(ffmpeg),'-v','error','-i',str(ROOT/'fire-detection/data/video'/filename),'-an',
            '-vf',f'select={select}','-fps_mode','passthrough','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],stdout=subprocess.PIPE)
        detector=subprocess.Popen([str(binary),str(args.assets.resolve()),'1920','1080'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=False)
        errors=[]
        def transfer():
            try:
                while block:=decoder.stdout.read(1920*1080*3):detector.stdin.write(block)
                detector.stdin.close()
            except Exception as error:errors.append(str(error))
        writer=threading.Thread(target=transfer);writer.start()
        predictions=[json.loads(line) for line in detector.stdout]
        writer.join()
        if detector.wait() or decoder.wait() or errors:raise RuntimeError(errors)
        if len(predictions)!=len(chosen):raise RuntimeError('sample count mismatch')
        counts=Counter();per_type={}
        for expected,prediction in zip(chosen,predictions):
            truth=expected['screen_type'];actual=prediction['type']
            outcome='abstain'
            if actual is not None:outcome='correct' if actual==truth else 'wrong_type' if truth.startswith('inventory.') else 'false_accept'
            elif truth not in supported:outcome='unsupported_abstain'
            counts[outcome]+=1
            if truth not in per_type:per_type[truth]=Counter()
            per_type[truth][outcome]+=1
            prediction.update({'video':filename,'video_frame':expected['video_frame'],'renderer_frame':expected['renderer_frame'],'truth':truth,'outcome':outcome})
            all_predictions.append(prediction)
        timings=[r['ms'] for r in predictions]
        video_hash=hashlib.sha256()
        with (ROOT/'fire-detection/data/video'/filename).open('rb') as source:
            for chunk in iter(lambda:source.read(8*1024*1024),b''):video_hash.update(chunk)
        row={'video':filename,'video_sha256':video_hash.hexdigest(),'samples':len(chosen),'selection':'one midpoint per contiguous labelled screen visit, including closed/unsupported',
             'counts':dict(counts),'per_type':{k:dict(v) for k,v in sorted(per_type.items())},'median_ms':statistics.median(timings),
             'max_ms':max(timings),'joined_sha256':hashlib.sha256((ROOT/joined).read_bytes()).hexdigest()}
        report.append(row);print(json.dumps(row,indent=2),flush=True)
    (args.output/'predictions.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in all_predictions),encoding='utf-8')
    preprocessing={'image':'1920x1080 raw decoded RGB24; no unveil or image enhancement',
        'rust_source_sha256':hashlib.sha256((ROOT/'fire-detection/core/src/gui_interaction.rs').read_bytes()).hexdigest(),
        'binary_sha256':hashlib.sha256(binary.read_bytes()).hexdigest(),
        'asset_manifest_sha256':hashlib.sha256((args.assets/'manifest.json').read_bytes()).hexdigest()}
    (args.output/'report.json').write_text(json.dumps({'protocol':__doc__,'preprocessing':preprocessing,'source_templates':manifest,'recordings':report},indent=2),encoding='utf-8')
    inventory=json.loads((ROOT/'docs/TRAINING_DATA_INVENTORY.json').read_text(encoding='utf-8'))
    sources=[]
    for record in inventory['videos']:
        if record.get('role')!='original':continue
        name=Path(record['path']).name
        relevant=name in {p[0] for p in SOURCES}
        sources.append({'path':record['path'],'role':'development_check' if relevant else 'excluded',
            'reason':'renderer-aligned GUI screen-state source' if relevant else 'no verified per-video GUI screen-state alignment for this task; fire labels are not GUI truth',
            'samples':next((r['samples'] for r in report if r['video']==name),0),
            'video_sha256':next((r['video_sha256'] for r in report if r['video']==name),None)})
    (args.output/'coverage.json').write_text(json.dumps({'task':'deterministic GUI source-template functional development check','not_ai_training':True,'sources':sources,'preprocessing':preprocessing,
        'holdout':'No independent-session GUI test is available; do not claim final accuracy','synthetic_fire_used':False},indent=2),encoding='utf-8')

if __name__=='__main__':main()
