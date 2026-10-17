"""Resume deterministic blob no-fire filtering with pragmatic training targets.

Scores are reused from real decoded videos, never recomputed from label boxes.
Width24 is an authorized training proxy, not a measured human-readability law.
These recordings are familiar; the guard is post-hoc error-analysis, not blind validation.
"""
import argparse
import hashlib
import json
from pathlib import Path

from prepare import ROOT, SOURCES
from temporal_presence import calibrate, metrics


def meaningful(boxes, width=24):
    return any(min(1920., b[2])-max(0., b[0]) >= width and min(1080., b[3]) > max(0., b[1]) for b in boxes)


def scores(evidence):
    result={}
    for scope,a,b in [('all','raw','auto'),('nohud','raw_nohud','auto_nohud')]:
        for field in ('pixels','single','pair','separated'):
            values=[evidence.get(k,{}).get(field) for k in (a,b)]
            result[f'{scope}:{field}']=max(values) if all(isinstance(v,(float,int)) and v>=0 for v in values) else None
    return result


def clear(scores, config):
    """Missing evidence always stays review; raw+unveil combine conservatively."""
    pair=scores.get('all:pair');world=scores.get('nohud:pair');single=scores.get('nohud:single')
    return ((pair is not None and pair < config['all_pair_threshold']) or
        (world is not None and single is not None and world < config['nohud_pair_threshold'] and single < config['large_single_guard']))


def derived_training(out, width):
    counts={}
    for name in SOURCES:
        source=ROOT/f'fire-detection/data/joined/{name}.jsonl';classes={};total=0
        with (out/f'{name}-targets.jsonl').open('w',encoding='utf8') as output:
            for line in source.open(encoding='utf8'):
                row=json.loads(line);lab=row.get('label')
                if not row.get('tick_ok') or not isinstance(lab,dict) or not isinstance(lab.get('fire'),bool):continue
                boxes=[[v*s for v,s in zip(f['box'],[1920/lab['w'],1080/lab['h'],1920/lab['w'],1080/lab['h']])] for f in lab.get('fires',[]) if f.get('box')]
                if bool(lab.get('fires')) != lab['fire'] or lab['fire'] and not boxes:category='unknown'
                else:category='fire' if meaningful(boxes,width) else 'negligible_fire' if lab['fire'] else 'no_fire'
                record={'source':name,'frame':row['n'],'raw_fire':lab['fire'],'target':category,
                    'clear_positive':category in ('no_fire','negligible_fire'),'native_boxes':boxes}
                output.write(json.dumps(record)+'\n');classes[category]=classes.get(category,0)+1;total+=1
        counts[name]={'frames':total,'classes':classes,'joined_sha256':hashlib.sha256(source.read_bytes()).hexdigest()}
    return counts


def main():
    ap=argparse.ArgumentParser();ap.add_argument('cache',type=Path);ap.add_argument('out',type=Path)
    ap.add_argument('--min-width',type=float,default=24);args=ap.parse_args()
    if args.min_width<=0:ap.error('Width must be positive')
    args.out.mkdir(parents=True,exist_ok=True);data={};hashes={}
    for name in ['clip2','clip1','quad1','survival1']:
        path=args.cache/f'{name}.json';rows=json.loads(path.read_text());hashes[name]=hashlib.sha256(path.read_bytes()).hexdigest()
        for r in rows:
            r['truth']['substantial']=meaningful(r['truth']['boxes'],args.min_width)
            r['scores']=scores(r['evidence'])
        data[name]=rows
    calibration=data['clip2']
    # Pair thresholds freeze on clip2 with zero observed false clears there.
    config={'all_pair_threshold':calibrate(calibration,'all:pair',0),
        'nohud_pair_threshold':calibrate(calibration,'nohud:pair',0),'large_single_guard':4096,
        'target_min_width':args.min_width,'native_width':1920,'native_height':1080}
    report={'policy':{'minimum_horizontal_native_width':args.min_width,'height_cutoff':None,
        'positive':'clear no-fire or negligible fire','FP':'meaningful fire wrongly cleared',
        'note':'Pragmatic training policy, not verified sprite readability. Unknown labels never become no-fire.'},
        'method':'Adjacent connected orange/pale regions on raw OR conditionally unveiled image. Full-frame clear, or HUD-excluded clear guarded against any large remaining warm blob.',
        'calibration_source':'clip2','evaluation_sources':['clip1','quad1','survival1'],
        'config':config,'cache_sha256':hashes,
        'cached_detector_protocol':json.loads((args.cache/'frozen-protocol.json').read_text()) if (args.cache/'frozen-protocol.json').exists() else None,
        'calibration_code_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'limits':'Familiar recordings, correlated stride90 samples; guard chosen after reviewing an evaluation error, so post-hoc diagnostic results. No app writes or interval clearing. Zero observed FP is not a guarantee.',
        'training_targets':derived_training(args.out,args.min_width),'sources':{}}
    for name,rows in data.items():
        for r in rows:r['scores']['guarded']=0 if clear(r['scores'],config) else 1
        report['sources'][name]={'frames':len(rows),'meaningful_fire':sum(r['truth']['substantial'] for r in rows),
            'guarded':metrics(rows,'guarded',1),
            'full_frame_pair':metrics(rows,'all:pair',config['all_pair_threshold']),
            'unguarded_nohud_pair':metrics(rows,'nohud:pair',config['nohud_pair_threshold'])}
        (args.out/f'{name}-scores.json').write_text(json.dumps(rows))
    evaluation=sum((data[n] for n in report['evaluation_sources']),[])
    report['evaluation']={'guarded':metrics(evaluation,'guarded',1),
        'full_frame_pair':metrics(evaluation,'all:pair',config['all_pair_threshold']),
        'unguarded_nohud_pair':metrics(evaluation,'nohud:pair',config['nohud_pair_threshold'])}
    report['errors']=[{'source':r['source'],'frame':r['frame'],'boxes':r['truth']['boxes']}
        for r in evaluation if r['truth']['substantial'] and clear(r['scores'],config)]
    (args.out/'frozen-config.json').write_text(json.dumps(config,indent=2))
    (args.out/'report.json').write_text(json.dumps(report,indent=2))
    print(json.dumps({'config':config,'training_targets':report['training_targets'],'evaluation':report['evaluation'],'errors':report['errors']},indent=2))


if __name__=='__main__':main()
