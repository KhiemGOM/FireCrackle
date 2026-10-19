"""Audit independent-colour phase models; export phase-only predictions."""
import csv,hashlib,json
from pathlib import Path
from collections import defaultdict
import numpy as np

def main(base):
    rows=json.loads((base/'selected.json').read_text());data=np.load(base/'real.npz');out=base/'separate';results=json.loads((out/'results.json').read_text());records=[];summary={}
    for kind in ['orange','soul']:
        result=results['results'][kind];split=json.loads((out/kind/'split.json').read_text());train=split['train_ids'];cal=split['calibration_ids'];test=split['test_ids'];p=np.load(out/kind/'predictions.npz')
        assert p['indices'].tolist()==test
        assert all(rows[i]['kind']==kind for i in train+cal+test)
        assert not set(train)&set(cal) and not set(train)&set(test) and not set(cal)&set(test)
        assert max(rows[i]['frame'] for i in train)+240<min(rows[i]['frame'] for i in cal)
        assert max(rows[i]['frame'] for i in cal)+240<=min(rows[i]['frame'] for i in test)
        train_hashes={hashlib.sha256(data['x'][i].tobytes()).hexdigest() for i in train};duplicates=sum(hashlib.sha256(data['x'][i].tobytes()).hexdigest() in train_hashes for i in test)
        logits=p['logits'];order=np.argsort(-logits,axis=1);prob=np.exp(logits-logits.max(1,keepdims=True));prob/=prob.sum(1,keepdims=True);conf=prob.max(1);good=order[:,0]==p['truth'];threshold=result['test']['threshold'];accepted=conf>=threshold
        assert int(good.sum())==result['test']['correct'];assert int((accepted&~good).sum())==result['test']['accepted_wrong'];assert sum(rows[i]['baselinePhase']==rows[i]['phase'] for i in test)==result['deterministic_correct']
        by_frame=defaultdict(list)
        for j,i in enumerate(test):
            row=rows[i];assert int(p['truth'][j])==row['phase'];by_frame[row['frame']].append(bool(good[j]))
            records.append(dict(colour=kind,id=row['id'],frame=row['frame'],source=row['source'],phase=row['phase'],prediction=int(order[j,0]),top3=' '.join(map(str,order[j,:3])),correct=int(good[j]),confidence=float(conf[j]),accepted=int(accepted[j]),deterministic_phase=row['baselinePhase'],deterministic_correct=int(row['baselinePhase']==row['phase'])))
        summary[kind]=dict(n=len(test),frames=len(by_frame),classes=len(set(p['truth'].tolist())),exact_crop_train_test_duplicates=duplicates,mean_frame_accuracy=float(np.mean([np.mean(v) for v in by_frame.values()])),checkpoint_sha256=hashlib.sha256((out/kind/'best.pt').read_bytes()).hexdigest())
    with (Path(__file__).parent/'separate-predictions.csv').open('w',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=records[0]);writer.writeheader();writer.writerows(records)
    summary['records']=len(records);summary['source_hashes']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in Path(__file__).parent.iterdir() if p.suffix in ['.py','.mjs']};(out/'audit.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary,indent=2))

if __name__=='__main__':
    import sys
    main(Path(sys.argv[1]))
