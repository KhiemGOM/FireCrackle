"""Paired64/128 accuracy and latency after calibration-only checkpoint selection."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import time
import numpy as np
import torch

ROOT=Path(__file__).resolve().parents[5];OLD=ROOT/'.board/row32-real';OUT=ROOT/'.board/row32-128'
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'real'))
from train import model_for,normalize,metrics,validate_splits
sys.path.insert(0,str(ROOT/'FireCrackle/scripts/fire-ai'))
from render import rectify

def timing(directory,size,row):
    rgb=np.fromfile(OLD/'quad1'/f"{row['frame']}.rgb",np.uint8).reshape(row['height'],row['width'],3);quad=np.array(row['quad'])*[row['width'],row['height']]
    model=model_for('resnet101',False);model.load_state_dict(torch.load(directory/'resnet101/best.pt',map_location='cpu',weights_only=True)['state_dict']);model.eval();results={}
    for device in ['cpu']+(['cuda'] if torch.cuda.is_available() else []):
        model.to(device);duration=[]
        with torch.inference_mode():
            for i in range(40):
                if device=='cuda':torch.cuda.synchronize()
                start=time.perf_counter();crop=rectify(rgb,quad,size=size);x=torch.from_numpy(crop.transpose(2,0,1).copy()).unsqueeze(0).to(device).float()/255;model(normalize(x)).softmax(1).cpu()
                if device=='cuda':torch.cuda.synchronize()
                if i>=10:duration.append((time.perf_counter()-start)*1000)
        results[device]=dict(median_ms=float(np.median(duration)),p95_ms=float(np.percentile(duration,95)),warmup=10,samples=30,cpu_threads=4)
    return results

def main(args):
    torch.set_num_threads(4)
    metadata=json.loads((OUT/'manifest.json').read_text());rows=metadata['samples'];validate_splits(rows);data=np.load(OUT/'real.npz');old_metadata=json.loads((OLD/'manifest.json').read_text())
    assert metadata['reference64_dataset_sha256']==old_metadata['dataset_sha256']
    assert all((a['id'],a['phase'],a['split'])==(b['id'],b['phase'],b['split']) for a,b in zip(rows,old_metadata['samples']))
    reports={};predictions={}
    for name,directory,size in [('64',OLD,64),('128',OUT,128)]:
        result=json.loads((directory/'resnet101/results.json').read_text());p=np.load(directory/'resnet101/predictions.npz');indices=p['indices'];logits=torch.tensor(p['logits']);truth=torch.tensor(p['truth'])
        assert np.array_equal(truth.numpy(),data['y'][indices]);assert all(rows[i]['split']=='test' for i in indices);assert len(indices)==617
        assert result['test']['correct']==metrics(logits,truth)['correct'];predictions[name]=(indices,logits.argmax(1).numpy())
        cal=torch.tensor(p['calibration_logits']).softmax(1);ci=p['calibration_indices'];correct=cal.argmax(1)==torch.tensor(data['y'][ci]);gate=1.01
        for threshold in np.arange(0,1.001,.01):
            selected=cal.max(1).values>=threshold
            if selected.sum()>=5 and not bool((selected&~correct).any()) and len({rows[ci[j]]['frame'] for j in torch.where(selected)[0].tolist()})>=2:gate=float(threshold);break
        accepted=logits.softmax(1).max(1).values>=gate;good=logits.argmax(1)==truth
        result['confidence_gate']=dict(threshold=gate,correct=int((accepted&good).sum()),wrong=int((accepted&~good).sum()),abstained=int((~accepted).sum()),accepted=int(accepted.sum()))
        result['checkpoint_sha256']=hashlib.sha256((directory/'resnet101/best.pt').read_bytes()).hexdigest()
        if args.timing:result['timing']=timing(directory,size,rows[indices[0]])
        reports[name]=result
    ix64,y64=predictions['64'];ix128,y128=predictions['128'];assert np.array_equal(ix64,ix128);truth=data['y'][ix64];good64=y64==truth;good128=y128==truth
    paired=dict(both_correct=int((good64&good128).sum()),only64_correct=int((good64&~good128).sum()),only128_correct=int((~good64&good128).sum()),both_wrong=int((~good64&~good128).sum()))
    result=dict(models=reports,paired=paired,baseline=json.loads((OLD/'results.json').read_text())['baseline'],splits=metadata['splits'],preprocessing=metadata['preprocessing'],native64_pixel_parity_checked=metadata['native64_pixel_parity_checked'],dataset_sha256=metadata['dataset_sha256'],reference64_dataset_sha256=metadata['reference64_dataset_sha256'],plan=json.loads((OUT/'plan.json').read_text()))
    (OUT/'comparison.json').write_text(json.dumps(result,indent=2));(Path(__file__).parent/'results.json').write_text(json.dumps(result,indent=2))
    print(json.dumps({name:{k:v for k,v in r.items() if k in ['chosen_epoch','completed_epochs','test','groups','confidence_gate','timing','gpu_peak_allocated_mb','seconds']} for name,r in reports.items()},indent=2));print(json.dumps(dict(paired=paired)))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--timing',action='store_true');main(p.parse_args())
