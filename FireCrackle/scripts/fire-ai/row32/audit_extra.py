"""Recount additional normal-fire run and freeze its training provenance."""
import csv,hashlib,json
from pathlib import Path
import numpy as np

def main(base,source):
    out=base/'separate/orange-extra';result=json.loads((out/'results.json').read_text());p=np.load(out/'predictions.npz');rows=json.loads((base/'selected.json').read_text());meta=json.loads((source/'manifest.json').read_text());eligible={x['id'] for x in json.loads((base/'extra-eligible.json').read_text())};records=[]
    prob=np.exp(p['logits']-p['logits'].max(1,keepdims=True));prob/=prob.sum(1,keepdims=True);order=np.argsort(-prob,axis=1);good=order[:,0]==p['truth'];confidence=prob.max(1);accept=confidence>=result['test']['threshold']
    assert int(good.sum())==result['test']['correct'];assert int((accept&~good).sum())==result['test']['accepted_wrong']
    source_video=meta['command'][meta['command'].index('-i')+1];test_video=json.loads((Path(rows[int(p['indices'][0])]['dir'])/'manifest.json').read_text())['video'];assert Path(source_video).name!=Path(test_video).name
    selected=[r for r in meta['samples'] if r['id'] in eligible];train=[r for r in selected if r['split']=='train'];cal=[r for r in selected if r['split']=='val'];assert len(train)==175 and len(cal)==15;assert max(r['frame'] for r in train)+240<min(r['frame'] for r in cal)
    for j,index in enumerate(p['indices']):
        r=rows[int(index)];assert r['kind']=='orange' and r['split']=='validation' and r['phase']==int(p['truth'][j]);records.append(dict(colour='orange',id=r['id'],frame=r['frame'],source=r['source'],phase=r['phase'],prediction=int(order[j,0]),top3=' '.join(map(str,order[j,:3])),correct=int(good[j]),confidence=float(confidence[j]),accepted=int(accept[j]),deterministic_phase=r['baselinePhase'],deterministic_correct=int(r['baselinePhase']==r['phase'])))
    with (Path(__file__).parent/'extra-predictions.csv').open('w',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=records[0]);writer.writeheader();writer.writerows(records)
    report=dict(records=len(records),training_video=source_video,test_video=test_video,checkpoint_sha256=hashlib.sha256((out/'best.pt').read_bytes()).hexdigest(),source_sha256={name:hashlib.sha256((source/name).read_bytes()).hexdigest() for name in ['manifest.json','train.npz','val.npz']},script_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
    (out/'audit.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))

if __name__=='__main__':
    import sys
    main(Path(sys.argv[1]),Path(sys.argv[2]))
