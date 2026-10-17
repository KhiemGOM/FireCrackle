"""Independent frozen-data/checkpoint/decision audit for the ViT experiment."""
import argparse,hashlib,json
from pathlib import Path

def read(p):return json.loads(p.read_text())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()

def main():
    ap=argparse.ArgumentParser();ap.add_argument('run',type=Path);ap.add_argument('--baseline',type=Path,required=True);ap.add_argument('--comparison',type=Path,required=True);args=ap.parse_args()
    run=args.run;dest=run/'vit_b_16';original=read(args.baseline/'dataset.json')['rows']
    protocol=read(run/'protocol.json');assert protocol['dataset_sha256']==sha(args.baseline/'dataset.json')
    freeze=read(dest/'freeze.json');cal=read(dest/'calibration.json');history=read(dest/'history.json')
    assert freeze['weights_sha256']==cal['weights_sha256']==sha(dest/'best.pt')
    assert freeze['epoch']==min(history,key=lambda r:r['development_loss'])['epoch']
    for role in ['development','calibration','test']:
        actual=read(dest/f'{role}-predictions.json');expected=[r for r in original if r['role']==role]
        assert len(actual)==len(expected)
        for a,e in zip(actual,expected):
            assert all(a[k]==v for k,v in e.items())
    calibration=read(dest/'calibration-predictions.json')
    assert cal['threshold']==min(r['score'] for r in calibration if r['fire'])
    predictions=read(dest/'test-predictions.json');matched=read(run/'matched-predictions.json');reference=read(args.comparison/'predictions.json')
    assert len(predictions)==len(matched)==len(reference)==919
    evidence={r['frame']:r for r in read(run/'shared-evidence.json')}
    for r,m,old in zip(predictions,matched,reference):
        assert r['frame']==m['frame']==old['frame']
        e=evidence.get(r['frame'])
        decision=bool(r['score']<cal['threshold'] and e and not e['common_blocked'])
        assert m['vit_b_16']==decision
        assert m['old_ensemble']==old['union']
        assert m['all_ensemble']==(decision or old['union'])
    fp=[r['frame'] for r in matched if r['vit_b_16'] and r['fire']]
    audit={'all_roles_ids_truth_unchanged':True,'development_only_epoch_selection':True,'checkpoint_hash_matches':True,'strict_calibration':True,
        'matched_decisions_recomputed':True,'frames':len(predictions),'FP_frames':fp,
        'negligible_fire_clears':sum(r['vit_b_16'] and r['raw_fire'] and not r['fire'] for r in matched)}
    (run/'audit.json').write_text(json.dumps(audit,indent=2));print(json.dumps(audit))

if __name__=='__main__':main()
