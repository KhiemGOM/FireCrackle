"""Review cached temporal calibration with the predeclared conservative crop policy.

The first decode used a raw-only crop guard. Any auto-unveiled shifted burst
becomes unknown here, matching the conservative policy in the current runner.
No evaluation labels or pixel scores influence this policy or thresholds.
"""
import argparse
import hashlib
import json
from pathlib import Path
from temporal_presence import calibrate, metrics


def main():
    ap=argparse.ArgumentParser();ap.add_argument('cache',type=Path);args=ap.parse_args()
    path=args.cache/'clip2.json';rows=json.loads(path.read_text());suppressed=0
    for row in rows:
        info=row['info']
        if any(info['unveiled']) and any(s['dy'] or s['dx'] for s in info['registration']):
            suppressed+=1
            for k in row['scores']:
                if k.endswith((':change',':reversal',':guarded_change')):row['scores'][k]=None
    fields=[k for k in rows[0]['scores'] if k.endswith((':change',':reversal',':guarded_change'))]
    thresholds={k:calibrate(rows,k,0) for k in fields}
    assert all(t==0 for t in thresholds.values()),'Motion might be useful: complete evaluation before deciding.'
    result={'calibration_frames':len(rows),'meaningful_fire':sum(r['truth']['substantial'] for r in rows),'suppressed_auto_shift_bursts':suppressed,'thresholds':thresholds,'calibration':{k:metrics(rows,k,t) for k,t in thresholds.items()},'zero_score_fire':{k:[r['frame'] for r in rows if r['truth']['substantial'] and r['scores'][k]==0] for k in fields},'conclusion':'Always review: scores are nonnegative or unknown and every strict clear threshold is zero. Thus0TP0FP by decision algebra for any evaluation frame; not an empirical full evaluation pixel run.','early_stop':True,'evaluation_pixel_decode':'Stopped during partialclip1; no complete evaluation pixel metrics claimed.','guarded_rule':'Spatialguard restricts clears to existinglocal24; no finite calibrationfire remains, hence threshold0/abstain.','original_cache_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'runner_source_sha256':hashlib.sha256(Path(__file__).with_name('burst_pilot.py').read_bytes()).hexdigest(),'review_source_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    (args.cache/'reviewed-report.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))


if __name__=='__main__':main()
