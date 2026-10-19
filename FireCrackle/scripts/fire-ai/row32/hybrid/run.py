"""Frozen CNN/deterministic hard selector. Calibration choices precede test access."""
import hashlib
import json
from pathlib import Path
import time
import numpy as np

ROOT=Path(__file__).resolve().parents[5]
OUT=ROOT/'.board/row32-hybrid';DATA=ROOT/'.board/row32-128'
# Small, declared global bank. No source-specific routing, per-phase fit or test tuning.
CNN_THRESHOLDS=[0.,.25,.5,.75,1.01]
MARGIN_THRESHOLDS=[0.,.01,.03,.1]
def digest(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def softmax(x):
    x=x-x.max(1,keepdims=True);p=np.exp(x);return p/p.sum(1,keepdims=True)
def choose(p,manual,margin,rule):
    cnn=p.argmax(1);disagree=cnn!=manual
    override=disagree&(manual>=0)&(p.max(1)<rule['cnn_below'])&(margin>=rule['matcher_margin_at_least'])
    return np.where(override,manual,cnn),override
def select(p,manual,margin,y):
    scores=[]
    for ct in CNN_THRESHOLDS:
        for mt in MARGIN_THRESHOLDS:
            rule=dict(cnn_below=ct,matcher_margin_at_least=mt);pred,over=choose(p,manual,margin,rule)
            scores.append(dict(rule=rule,correct=int((pred==y).sum()),overrides=int(over.sum())))
    selected=min(scores,key=lambda r:(-r['correct'],r['overrides'],r['rule']['cnn_below'],-r['rule']['matcher_margin_at_least']))
    return selected,scores
def paired(c,m,y):
    return dict(n=len(y),both_correct=int(((c==y)&(m==y)).sum()),cnn_only_correct=int(((c==y)&(m!=y)).sum()),matcher_only_correct=int(((c!=y)&(m==y)).sum()),both_wrong_agree=int(((c!=y)&(m!=y)&(c==m)).sum()),both_wrong_disagree=int(((c!=y)&(m!=y)&(c!=m)).sum()))
def accepted(pred,y,mask):
    n=int(mask.sum());correct=int(((pred==y)&mask).sum())
    return dict(accepted=n,correct=correct,wrong=n-correct,abstained=len(y)-n,coverage=n/len(y),accuracy=correct/n if n else None)
def confusion(y,pred):
    matrix=np.zeros((32,33),dtype=int)
    for a,b in zip(y,pred):matrix[a,b if b>=0 else 32]+=1
    return matrix.tolist()
def gate(p,manual,y,frames):
    # Agreement is a fixed acceptance rule, not selected using test outcomes.
    agree=p.argmax(1)==manual
    for threshold in np.arange(0,1.001,.01):
        mask=agree&(p.max(1)>=threshold)
        if mask.sum()>=5 and not ((p.argmax(1)!=y)&mask).any() and len(set(frames[mask]))>=2:return float(threshold)
    return 1.01
def summary(p,m,margin,y,rows,rule,threshold):
    c=p.argmax(1);pred,override=choose(p,m,margin,rule);agree=c==m
    result=dict(n=len(y),cnn_correct=int((c==y).sum()),matcher_correct=int((m==y).sum()),ensemble_correct=int((pred==y).sum()),ensemble_accuracy=float((pred==y).mean()),overrides=int(override.sum()),override_helped=int((override&(m==y)&(c!=y)).sum()),override_hurt=int((override&(c==y)&(m!=y)).sum()),paired=paired(c,m,y),agreement_only=accepted(c,y,agree),calibrated_agreement=accepted(c,y,agree&(p.max(1)>=threshold)))
    result['groups']={}
    for source in sorted({r['source'] for r in rows}):
        mask=np.array([r['source']==source for r in rows]);result['groups'][source]=dict(n=int(mask.sum()),cnn_correct=int(((c==y)&mask).sum()),matcher_correct=int(((m==y)&mask).sum()),ensemble_correct=int(((pred==y)&mask).sum()),paired=paired(c[mask],m[mask],y[mask]))
    result['confusion']=dict(rows='true animation phase 0..31',columns='predicted animation phase 0..31, then abstain',cnn=confusion(y,c),matcher=confusion(y,m),ensemble=confusion(y,pred))
    return result,pred

def main():
    start=time.perf_counter();meta=json.loads((DATA/'manifest.json').read_text());rows=meta['samples']
    assert meta['preprocessing']=={f:digest(ROOT/'fire-detection/core/src'/f) for f in meta['preprocessing']}
    matcher=json.loads((OUT/'matcher.json').read_text());byid={r['id']:r for r in matcher['rows']}
    cache=np.load(DATA/'resnet101/predictions.npz');ci=cache['calibration_indices'];assert len(ci)==157
    assert all(rows[i]['split']=='calibration' for i in ci)
    cy=np.array([rows[i]['phase'] for i in ci]);cp=softmax(cache['calibration_logits'])
    def controls(indices):
        rr=[byid[rows[i]['id']] for i in indices]
        assert all(r['split']==rows[i]['split'] for r,i in zip(rr,indices))
        return np.array([r['phase'] if r['phase'] is not None else -1 for r in rr]),np.array([r['margin'] for r in rr])
    cm,cg=controls(ci);selected,bank=select(cp,cm,cg,cy);rule=selected['rule']
    threshold=gate(cp,cm,cy,np.array([rows[i]['frame'] for i in ci]))
    selection=dict(rule=rule,agreement_cnn_threshold=threshold,bank=bank,selection='maximum calibration exact-phase correct; ties: fewer overrides, lower CNN threshold, higher matcher margin',calibration=157,test=617,training=False,synthetic=False)
    (OUT/'selection.json').write_text(json.dumps(selection,indent=2))
    print(json.dumps(dict(stage='selection_frozen',rule=rule,correct=selected['correct'],agreement_threshold=threshold)),flush=True)
    # No test predictions/truth are loaded above this boundary.
    ti=cache['indices'];assert len(ti)==617 and all(rows[i]['split']=='test' for i in ti)
    assert not set(rows[i]['video'] for i in ci)&set(rows[i]['video'] for i in ti)
    y=cache['truth'];assert np.array_equal(y,[rows[i]['phase'] for i in ti]);p=softmax(cache['logits']);m,mg=controls(ti)
    cal,_=summary(cp,cm,cg,cy,[rows[i] for i in ci],rule,threshold)
    test,pred=summary(p,m,mg,y,[rows[i] for i in ti],rule,threshold)
    np.savez_compressed(OUT/'predictions.npz',indices=ti,truth=y,cnn_probabilities=p,matcher=m,margin=mg,ensemble=pred,calibration_indices=ci,calibration_probabilities=cp,calibration_matcher=cm,calibration_margin=cg,calibration_truth=cy)
    coverage=json.loads((DATA/'coverage.json').read_text());coverage.update(experiment='Approved frozen128px CNN + deterministic agreement/confidence selector; same real cohorts, no retraining',inventory_sha256=digest(ROOT/'docs/TRAINING_DATA_INVENTORY.json'),new_training_examples=0)
    for source in coverage['sources']:source['use_in_current_run']='frozen CNN checkpoint provenance only' if source['role']=='train' else source['role']
    (OUT/'coverage.json').write_text(json.dumps(coverage,indent=2))
    report=dict(selection=selection,calibration=cal,test=test,preparation=json.loads((OUT/'preparation.json').read_text()),matcher_seconds=matcher['seconds'],baseline_parity=matcher['baseline_parity'],seconds=time.perf_counter()-start,dataset_sha256=meta['dataset_sha256'],cnn_cache_sha256=digest(DATA/'resnet101/predictions.npz'),matcher_source_hashes=matcher['source_hashes'],shared_preprocessing=meta['preprocessing'],source_hashes={p.name:digest(p) for p in Path(__file__).parent.glob('*.py')},limitation='Familiar single-recording test; correlated quads, 157 calibration cases. No app integration or jointly measured CNN/matcher latency.')
    (OUT/'results.json').write_text(json.dumps(report,indent=2));(Path(__file__).parent/'results.json').write_text(json.dumps(report,indent=2))
    print(json.dumps({k:v for k,v in test.items() if k not in ['confusion','groups']}),flush=True)
if __name__=='__main__':main()
