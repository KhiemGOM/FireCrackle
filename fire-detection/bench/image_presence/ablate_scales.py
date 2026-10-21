"""Post-hoc diagnostic: same v2 weights with cached640px views, no global view.

Not an independent evaluation: defined after seeing v2's denser-scan result.
Checkpoint remains frozen; threshold calibrated using clip2 only, before survival.
"""
import argparse
import json
from pathlib import Path
import numpy as np
import torch
from crop_v2 import load_base,chunk_logits


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('run',type=Path);ap.add_argument('--baseline-run',type=Path,required=True)
    ap.add_argument('--data-root',type=Path,required=True);ap.add_argument('--baseline-source',type=Path,required=True)
    args=ap.parse_args();base=load_base(args.baseline_source,args.data_root);torch.set_num_threads(4)
    device=torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    checkpoint=torch.load(args.run/'best.pt',map_location=device,weights_only=False)
    baseline_protocol=json.loads((args.baseline_run/'protocol.json').read_text())
    if baseline_protocol['preprocessing_sha256']!=checkpoint['protocol']['preprocessing_sha256']:
        raise ValueError('Cached preprocessing differs')
    model=base.make_model(pretrained=False).to(device).eval();model.load_state_dict(checkpoint['state'])
    out=args.run/'coarse-ablation';out.mkdir(exist_ok=True)
    protocol={'status':'post_hoc_diagnostic_not_independent','weights_sha256':base.sha(args.run/'best.pt'),
              'views':'8cached640px native tiles per branch; remove v1 global views; same v2 weights',
              'selection':'No retraining or checkpoint reselection; same minimum calibration-fire threshold rule',
              'defined_after':'V2 dense scan result10/542eligible clears and0/377fire misses observed'}
    (out/'protocol.json').write_text(json.dumps(protocol,indent=2));report={'protocol':protocol,'recordings':{}}
    for source in ('clip2','survival1'):
        rows=json.loads((args.baseline_run/'cache'/f'{source}.json').read_text())['rows'];scores=[]
        for row in rows:
            arr=np.load(args.baseline_run/row['file'])
            if len(arr) not in (9,18):raise ValueError('Unexpected baseline views')
            arr=np.concatenate([arr[1:9],arr[10:18]]) if len(arr)==18 else arr[1:9]
            row['score']=float(chunk_logits(model,arr,base,device).max());scores.append(row['score'])
        if source=='clip2':
            threshold=base.clear_threshold(scores,[r['fire'] for r in rows])
            (out/'calibration.json').write_text(json.dumps({'threshold':threshold,'weights_sha256':protocol['weights_sha256']}))
        metrics=base.metrics(rows,np.array(scores),threshold)
        report['recordings'][source]=metrics;report['threshold_logit']=threshold
        (out/f'{source}-predictions.json').write_text(json.dumps(rows,indent=2))
        (out/'report.json').write_text(json.dumps(report,indent=2))
        print(json.dumps({'source':source,**metrics}),flush=True)


if __name__=='__main__':main()
