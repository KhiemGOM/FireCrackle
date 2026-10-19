"""Verify larger-model test cohorts and export all retained predictions."""
import argparse,csv,hashlib,json,sys
from pathlib import Path
import numpy as np
sys.path.append(str(Path(__file__).resolve().parent))
from compare import real_data

def main(a):
    records=[];summary={}
    for architecture in ['resnet101','vit_b16']:
        root=a.directory/architecture;report=json.loads((root/'results.json').read_text());summary[architecture]={}
        for kind in ['orange','soul']:
            parts,x,y,ids,rows=real_data(a.data,a.extra,kind);p=np.load(root/kind/'predictions.npz');assert p['indices'].tolist()==ids;assert np.array_equal(p['truth'],y.numpy());r=report['results'][kind]
            logits=p['logits'];order=np.argsort(-logits,axis=1);prob=np.exp(logits-logits.max(1,keepdims=True));prob/=prob.sum(1,keepdims=True);good=order[:,0]==p['truth'];confidence=prob.max(1);accepted=confidence>=r['test']['threshold'];assert int(good.sum())==r['test']['correct'];assert int((accepted&~good).sum())==r['test']['accepted_wrong']
            assert sum(rows[i]['phase']==rows[i]['baselinePhase'] for i in ids)==r['deterministic_correct']
            for j,i in enumerate(ids):
                row=rows[i];records.append(dict(architecture=architecture,colour=kind,id=row['id'],frame=row['frame'],source=row['source'],phase=row['phase'],prediction=int(order[j,0]),top3=' '.join(map(str,order[j,:3])),confidence=float(confidence[j]),correct=int(good[j]),accepted=int(accepted[j]),deterministic_correct=int(row['phase']==row['baselinePhase'])))
            summary[architecture][kind]=dict(n=len(ids),frames=len({rows[i]['frame'] for i in ids}),checkpoint_sha256=hashlib.sha256((root/kind/'best.pt').read_bytes()).hexdigest())
    with (a.directory/'predictions.csv').open('w',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=records[0]);writer.writeheader();writer.writerows(records)
    summary['records']=len(records);summary['source_hashes']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in Path(__file__).parent.glob('*.py')};(a.directory/'audit.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary,indent=2))

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('directory',type=Path);ap.add_argument('--data',type=Path,default=Path('.board/row32'));ap.add_argument('--extra',type=Path,default=Path('.board/fire-ai/survival-train-dense'));main(ap.parse_args())
