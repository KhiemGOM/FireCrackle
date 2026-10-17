import sys, json, hashlib, argparse
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'fire-detection/bench/no_fire'))
from temporal_presence import metrics
from blob_calibration import meaningful, scores as blob_scores, clear

ap=argparse.ArgumentParser()
ap.add_argument('orange',type=Path);ap.add_argument('baseline',type=Path);ap.add_argument('config',type=Path)
args=ap.parse_args()
here=args.orange
baseline=args.baseline
config=json.loads(args.config.read_text())
thresholds=json.loads((here/'frozen-thresholds.json').read_text())
all_rows=[]; hashes={}
for name in ['clip2','clip1','quad1','survival1']:
    op=here/f'{name}.json';bp=baseline/f'{name}.json'
    orange=json.loads(op.read_text()); blobs=json.loads(bp.read_text())
    hashes[name]={'orange':hashlib.sha256(op.read_bytes()).hexdigest(),'baseline':hashlib.sha256(bp.read_bytes()).hexdigest()}
    bm={r['frame']:r for r in blobs}
    assert len(bm)==len(orange)
    for r in orange:
        b=bm[r['frame']]
        assert r['truth']['substantial']==meaningful(b['truth']['boxes'],24)
        r['scores']['guarded_baseline']=0 if clear(blob_scores(b['evidence']),config) else 1
        # Exploratory unions of previously tested frozen rules, no new thresholds.
        r['scores']['orange_union']=0 if any(r['scores'][k]<thresholds[k] for k in ['all:local24','nohud:texture96']) else 1
        r['scores']['full_frame_orange_union']=0 if any(r['scores'][k]<thresholds[k] for k in ['all:local24','all:texture24','all:texture48','all:texture96']) else 1
        r['scores']['combined_union']=min(r['scores']['orange_union'],r['scores']['guarded_baseline'])
        if name!='clip2':all_rows.append(r)
evaluation={k:metrics(all_rows,k,t) for k,t in {**thresholds,'guarded_baseline':1,'orange_union':1,'full_frame_orange_union':1,'combined_union':1}.items()}
errors=[{'source':r['source'],'frame':r['frame'],'boxes':r['truth']['boxes'],'scores':r['scores']} for r in all_rows if r['truth']['substantial'] and r['scores']['all:single']<thresholds['all:single']]
report={'samples':len(all_rows),'fire':sum(r['truth']['substantial'] for r in all_rows),'clear_eligible':sum(not r['truth']['substantial'] for r in all_rows),'evaluation':evaluation,'primary_errors':errors,'hashes':hashes,'baseline_config':config,'shared_veil_sha256':hashlib.sha256((ROOT/'fire-detection/core/src/veil.rs').read_bytes()).hexdigest(),'limits':'Frozen historical thresholds; full fresh stride90 decode; familiar recordings, exploratory rule selection and unions, no independent holdout. HUD-excluded results diagnostic only. Width24 is a training proxy, not human readability measurement.'}
(here/'comparison.json').write_text(json.dumps(report,indent=2))
print(json.dumps({k:v for k,v in report.items() if k not in ['hashes','primary_errors']},indent=2))

