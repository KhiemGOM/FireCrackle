"""Fixed inference-only preprocessing, then cached probability ensemble.

All choices use calibration only. No new fire examples or weight updates.
"""
import hashlib
import json
from pathlib import Path
import sys
import time
import numpy as np
from PIL import Image,ImageFilter,__version__ as pillow_version
import torch

ROOT=Path(__file__).resolve().parents[5]
OLD=ROOT/'.board/row32-real';DATA=ROOT/'.board/row32-128';OUT=ROOT/'.board/row32-preprocessing'
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'real'))
from train import model_for,normalize,metrics,validate_splits

VARIANTS=['unchanged','gamma_0.8','gamma_1.25','median_3','unsharp_1']
WEIGHTS=[0.,.25,.5,.75,1.]

def digest(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()

def transform(image,name):
    if name=='unchanged':return image
    if name.startswith('gamma_'):
        exponent=float(name.split('_')[1]);lut=np.uint8(np.rint(255*(np.arange(256)/255)**exponent))
        return lut[image]
    im=Image.fromarray(image)
    if name=='median_3':im=im.filter(ImageFilter.MedianFilter(size=3))
    elif name=='unsharp_1':im=im.filter(ImageFilter.UnsharpMask(radius=1,percent=100,threshold=3))
    else:raise ValueError(name)
    return np.array(im)

def blend(p64,p128,weight128):return (1-weight128)*p64+weight128*p128

def probability_metrics(p,y):return metrics(p.clamp_min(1e-12).log(),y)

def choose_weight(p64,p128,y):
    scores=[dict(weight128=w,calibration=probability_metrics(blend(p64,p128,w),y)) for w in WEIGHTS]
    return min(scores,key=lambda r:r['calibration']['loss'])['weight128'],scores

def gate_for(p,y,frames):
    correct=p.argmax(1)==y
    for t in np.arange(0,1.001,.01):
        selected=p.max(1).values>=t
        if selected.sum()>=5 and not bool((selected&~correct).any()) and len({frames[i] for i in torch.where(selected)[0].tolist()})>=2:return float(t)
    return 1.01

def summarize(p,y,threshold,rows):
    good=p.argmax(1)==y;accepted=p.max(1).values>=threshold
    result=probability_metrics(p,y)
    result['gate']=dict(threshold=threshold,accepted=int(accepted.sum()),correct=int((accepted&good).sum()),wrong=int((accepted&~good).sum()),abstained=int((~accepted).sum()))
    result['groups']={source:probability_metrics(p[[i for i,r in enumerate(rows) if r['source']==source]],y[[i for i,r in enumerate(rows) if r['source']==source]]) for source in sorted({r['source'] for r in rows})}
    return result

@torch.inference_mode()
def infer(model,images,name,device):
    model.eval();parts=[];start=time.perf_counter();transform_ms=0
    for begin in range(0,len(images),32):
        clock=time.perf_counter();rgb=np.stack([transform(im,name) for im in images[begin:begin+32]]);transform_ms+=(time.perf_counter()-clock)*1000
        xx=torch.from_numpy(rgb.transpose(0,3,1,2).copy()).to(device).float()/255
        parts.append(model(normalize(xx)).float().cpu())
    return torch.cat(parts),dict(crops=len(images),seconds=time.perf_counter()-start,transform_ms_per_crop=transform_ms/len(images))

def main():
    OUT.mkdir(exist_ok=True);torch.set_num_threads(4);start=time.perf_counter();device=torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    metadata=json.loads((DATA/'manifest.json').read_text());rows=metadata['samples'];validate_splits(rows)
    assert digest(DATA/'real.npz')==metadata['dataset_sha256']
    if metadata['preprocessing']!={f:digest(ROOT/'fire-detection/core/src'/f) for f in metadata['preprocessing']}:raise ValueError('Shared unveil changed; cannot reuse these pixels')
    data=np.load(DATA/'real.npz');d64=np.load(OLD/'real.npz')
    for key in ['y','split','video']:assert np.array_equal(data[key],d64[key])
    cached=np.load(DATA/'resnet101/predictions.npz');c64=np.load(OLD/'resnet101/predictions.npz')
    ci=cached['calibration_indices'];ti=cached['indices'];assert np.array_equal(ci,c64['calibration_indices']);assert np.array_equal(ti,c64['indices'])
    assert len(ci)==157 and len(ti)==617;assert all(rows[i]['split']=='calibration' for i in ci);assert all(rows[i]['split']=='test' for i in ti)
    checkpoint=DATA/'resnet101/best.pt';comparison=json.loads((DATA/'comparison.json').read_text());assert digest(checkpoint)==comparison['models']['128']['checkpoint_sha256']
    assert digest(OLD/'resnet101/best.pt')==comparison['models']['64']['checkpoint_sha256']
    coverage=json.loads((DATA/'coverage.json').read_text());coverage.update(experiment='Owner-approved fixed inference-only preprocessing then cached64/128 ensemble; all CNN weights frozen',inventory_sha256=digest(ROOT/'docs/TRAINING_DATA_INVENTORY.json'),new_training_examples=0)
    for source in coverage['sources']:source['use_in_current_run']='frozen checkpoint provenance only' if source['role']=='train' else source['role']
    (OUT/'coverage.json').write_text(json.dumps(coverage,indent=2))
    plan=dict(variants=VARIANTS,details=dict(gamma='uint8 round(255*(x/255)**exponent), same LUT per RGB channel',median='Pillow3x3 RGB median',unsharp='Pillow radius1,amount100%,threshold3'),selection='minimum calibration cross entropy; unchanged first for ties',calibration=157,test=617,weight128_bank=WEIGHTS,training=False,shared_unveil='unchanged already-applied canonical source',budget='5-10minutes',pillow=pillow_version,torch=torch.__version__,numpy=np.__version__,device=str(device))
    (OUT/'plan.json').write_text(json.dumps(plan,indent=2))
    model=model_for('resnet101',False).to(device);model.load_state_dict(torch.load(checkpoint,map_location=device,weights_only=True)['state_dict'])
    cy=torch.tensor(data['y'][ci],dtype=torch.long);p64=torch.tensor(c64['calibration_logits']).softmax(1);cal={};scores={};times={}
    for name in VARIANTS:
        if name=='unchanged':logits=torch.tensor(cached['calibration_logits']);times[name]=dict(crops=len(ci),seconds=0,transform_ms_per_crop=0,cache_reused=True)
        else:logits,times[name]=infer(model,data['x'][ci],name,device)
        cal[name]=logits.softmax(1);scores[name]=metrics(logits,cy)
        np.savez_compressed(OUT/f'calibration-{name}.npz',indices=ci,logits=logits.numpy())
        print(json.dumps(dict(stage='calibration',variant=name,metrics=scores[name],timing=times[name])),flush=True)
    chosen=min(VARIANTS,key=lambda n:scores[n]['loss']);weight,weight_scores=choose_weight(p64,cal[chosen],cy)
    frames=[rows[i]['frame'] for i in ci];plain_gate=gate_for(cal['unchanged'],cy,frames);chosen_gate=gate_for(cal[chosen],cy,frames);ensemble_gate=gate_for(blend(p64,cal[chosen],weight),cy,frames)
    selection=dict(variant=chosen,weight128=weight,gates=dict(unchanged=plain_gate,chosen=chosen_gate,ensemble=ensemble_gate),calibration_scores=scores,weight_scores=weight_scores)
    # Immutable decision evidence is written before any selected-path test inference.
    (OUT/'selection.json').write_text(json.dumps(selection,indent=2));print(json.dumps(dict(stage='selection_frozen',variant=chosen,weight128=weight,gates=selection['gates'])),flush=True)
    y=torch.tensor(data['y'][ti],dtype=torch.long);assert np.array_equal(y.numpy(),cached['truth']);assert np.array_equal(y.numpy(),c64['truth'])
    plain=torch.tensor(cached['logits']).softmax(1)
    if chosen=='unchanged':test=plain;test_time=dict(cache_reused=True)
    else:
        test_logits,test_time=infer(model,data['x'][ti],chosen,device);test=test_logits.softmax(1)
    ensemble=blend(torch.tensor(c64['logits']).softmax(1),test,weight);test_rows=[rows[i] for i in ti]
    reports=dict(unchanged128=summarize(plain,y,plain_gate,test_rows),preprocessed128=summarize(test,y,chosen_gate,test_rows),ensemble=summarize(ensemble,y,ensemble_gate,test_rows))
    np.savez_compressed(OUT/'predictions.npz',indices=ti,truth=y.numpy(),chosen_probabilities=test.numpy(),ensemble_probabilities=ensemble.numpy(),calibration_indices=ci,calibration_probabilities=cal[chosen].numpy(),calibration_ensemble_probabilities=blend(p64,cal[chosen],weight).numpy())
    result=dict(plan=plan,selection=selection,test=reports,calibration_timing=times,selected_test_timing=test_time,seconds=time.perf_counter()-start,dataset_sha256=metadata['dataset_sha256'],reference64_dataset_sha256=metadata['reference64_dataset_sha256'],checkpoint_sha256=digest(checkpoint),checkpoint64_sha256=digest(OLD/'resnet101/best.pt'),shared_preprocessing=metadata['preprocessing'],source_sha256=digest(Path(__file__)))
    (OUT/'results.json').write_text(json.dumps(result,indent=2));(Path(__file__).parent/'results.json').write_text(json.dumps(result,indent=2));print(json.dumps(dict(done=True,seconds=result['seconds'],selection=dict(variant=chosen,weight128=weight),test=reports)),flush=True)

if __name__=='__main__':main()
