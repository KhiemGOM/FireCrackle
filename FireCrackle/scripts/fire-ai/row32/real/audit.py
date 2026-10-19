"""Recount frozen predictions, retain numeric evidence, and measure single-match latency."""
import argparse
import csv
import json
from pathlib import Path
import sys
import time
import numpy as np
import torch
from train import BASE,ROOT,model_for,normalize,validate_splits,metrics
sys.path.insert(0,str(ROOT/'FireCrackle/scripts/fire-ai'))
from render import rectify

def benchmark(name,rows):
    row=next(r for r in rows if r['split']=='test');image=np.fromfile(BASE/'quad1'/f"{row['frame']}.rgb",np.uint8).reshape(row['height'],row['width'],3);quad=np.array(row['quad'])*[row['width'],row['height']]
    model=model_for(name,False);model.load_state_dict(torch.load(BASE/name/'best.pt',map_location='cpu',weights_only=True)['state_dict']);model.eval();result={}
    for device in ['cpu']+(['cuda'] if torch.cuda.is_available() else []):
        model.to(device);times=[]
        with torch.inference_mode():
            for i in range(70):
                if device=='cuda':torch.cuda.synchronize()
                start=time.perf_counter();crop=rectify(image,quad);x=torch.from_numpy(crop.transpose(2,0,1).copy()).unsqueeze(0).to(device).float()/255;model(normalize(x)).softmax(1).cpu()
                if device=='cuda':torch.cuda.synchronize()
                if i>=20:times.append((time.perf_counter()-start)*1000)
        result[device]=dict(median_ms=float(np.median(times)),p95_ms=float(np.percentile(times,95)),cpu_threads=4)
    return result

def main(a):
    torch.set_num_threads(4);metadata=json.loads((BASE/'manifest.json').read_text());rows=metadata['samples'];validate_splits(rows);d=np.load(BASE/'real.npz');baseline=json.loads((BASE/'baseline.json').read_text());byid={r['id']:r for r in baseline['rows']};out=Path(__file__).parent;results={};lines=[]
    previous=json.loads((BASE/'results.json').read_text()) if (BASE/'results.json').exists() else {}
    for name in ['resnet18','resnet101','vit_b16']:
        result=json.loads((BASE/name/'results.json').read_text());pred=np.load(BASE/name/'predictions.npz');logits=torch.tensor(pred['logits']);truth=torch.tensor(pred['truth']);indices=pred['indices'];order=logits.argmax(1).tolist()
        assert np.array_equal(pred['truth'],d['y'][indices]);assert all(rows[i]['split']=='test' for i in indices);assert result['test']['correct']==metrics(logits,truth)['correct'];assert result['config']['dataset_sha256']==metadata['dataset_sha256']
        for j,i in enumerate(indices):
            r=rows[i];b=byid[r['id']];assert b['truth']==r['phase']
            lines.append(dict(model=name,id=r['id'],frame=r['frame'],source=r['source'],phase=r['phase'],predicted_phase=order[j],correct=int(order[j]==r['phase']),baseline_phase=b['phase'],baseline_correct=int(b['correct'])))
        # Confidence gate fitted on calibration only, with >=5 accepts on >=2 frames.
        cal=torch.tensor(pred['calibration_logits']).softmax(1);ci=pred['calibration_indices'];good=cal.argmax(1)==torch.tensor(d['y'][ci]);gate=1.01
        for threshold in np.arange(0,1.001,.01):
            accept=cal.max(1).values>=threshold
            if accept.sum()>=5 and not bool((accept&~good).any()) and len({rows[ci[j]]['frame'] for j in torch.where(accept)[0].tolist()})>=2:gate=float(threshold);break
        accepted=logits.softmax(1).max(1).values>=gate;correct=logits.argmax(1)==truth
        result['confidence_gate']=dict(threshold=gate,accepted=int(accepted.sum()),correct=int((accepted&correct).sum()),wrong=int((accepted&~correct).sum()),abstained=int((~accepted).sum()))
        if a.timing:result['timing']=benchmark(name,rows)
        elif previous.get('dataset_sha256')==metadata['dataset_sha256'] and 'timing' in previous.get('models',{}).get(name,{}):result['timing']=previous['models'][name]['timing']
        results[name]=result
    # Per-case truth and predictions remain private with the source data.
    with (BASE/'results.csv').open('w',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=list(lines[0]));writer.writeheader();writer.writerows(lines)
    compact=dict(dataset_sha256=metadata['dataset_sha256'],preprocessing=metadata['preprocessing'],splits=metadata['splits'],baseline={k:v for k,v in baseline.items() if k!='rows'},models={name:{k:v for k,v in r.items() if k not in ['source_hashes']} for name,r in results.items()})
    (out/'results.json').write_text(json.dumps(compact,indent=2));(BASE/'results.json').write_text(json.dumps(compact,indent=2));print(json.dumps({name:{k:v for k,v in r.items() if k in ['test','groups','historical_99','confidence_gate','timing','seconds','chosen_epoch']} for name,r in results.items()},indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--timing',action='store_true');main(p.parse_args())
