"""Calibrate one three-phase probability ranking from frozen CNN/matcher scores."""
import hashlib
import json
from pathlib import Path
import time
import numpy as np

ROOT=Path(__file__).resolve().parents[5];OUT=ROOT/'.board/row32-fusion';DATA=ROOT/'.board/row32-128'
TEMPERATURES=[.01,.03,.1,.3]
CNN_WEIGHTS=[0.,.25,.5,.75,1.]
def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def softmax(x):
    x=x-x.max(1,keepdims=True);p=np.exp(x);return p/p.sum(1,keepdims=True)
def fuse(cnn,scores,usable,temperature,weight):
    manual=softmax(scores/temperature)
    manual=np.where(usable[:,None],manual,1/32)
    return weight*cnn+(1-weight)*manual
def metrics(p,y):
    rank=np.argsort(-p,axis=1,kind='stable');hit=(rank[:,:3]==y[:,None]).any(1)
    return dict(n=len(y),top1=int((rank[:,0]==y).sum()),top3=int(hit.sum()),top3_accuracy=float(hit.mean()),cross_entropy=float(-np.log(np.maximum(p[np.arange(len(y)),y],1e-12)).mean()))
def select(cnn,scores,usable,y):
    bank=[]
    for t in TEMPERATURES:
        for w in CNN_WEIGHTS:bank.append(dict(temperature=t,cnn_weight=w,calibration=metrics(fuse(cnn,scores,usable,t,w),y)))
    chosen=min(bank,key=lambda r:(-r['calibration']['top3'],r['calibration']['cross_entropy'],-r['cnn_weight'],r['temperature']))
    return chosen,bank
def report(p,y,rows):
    result=metrics(p,y);result['groups']={}
    for source in ['block','entity']:
        mask=np.array([r['source']==source for r in rows]);result['groups'][source]=metrics(p[mask],y[mask])
    return result
def main():
    OUT.mkdir(exist_ok=True);started=time.perf_counter()
    plan=dict(task='normal_fire32_animation_phase; one ranked top3, not concatenated candidate lists',temperatures=TEMPERATURES,cnn_weights=CNN_WEIGHTS,matcher_phase_reduction='maximum similarity across appearances of each phase',fusion='weight*CNNsoftmax + (1-weight)*softmax(phase_score/temperature); unusable matcher is uniform',selection='maximum calibration top3; tie minimum calibration crossentropy, higher CNNweight, lower temperature',calibration=dict(recording='2026-10-17 17-04-31.mkv',crops=157,frames=53),test=dict(recording='2026-10-16 00-40-22.mkv',crops=617,frames=179),training=False,synthetic=False,budget='about5minutes',tie_ranking='descending fused probability, then ascending animation phase')
    (OUT/'plan.json').write_text(json.dumps(plan,indent=2))
    meta=json.loads((DATA/'manifest.json').read_text());rows=meta['samples']
    assert meta['preprocessing']=={f:digest(ROOT/'fire-detection/core/src'/f) for f in meta['preprocessing']}
    scores=json.loads((OUT/'matcher.json').read_text());byid={r['id']:r for r in scores['rows']}
    cache=np.load(DATA/'resnet101/predictions.npz');ci=cache['calibration_indices'];assert len(ci)==157
    assert all(rows[i]['split']=='calibration' for i in ci)
    def aligned(indices):
        rr=[byid[rows[i]['id']] for i in indices];assert all(r['split']==rows[i]['split'] for r,i in zip(rr,indices))
        return np.array([r['phase_scores'] for r in rr]),np.array([r['usable'] for r in rr]),rr
    cy=np.array([rows[i]['phase'] for i in ci]);cp=softmax(cache['calibration_logits']);cs,cu,_=aligned(ci)
    chosen,bank=select(cp,cs,cu,cy);selection=dict(chosen=chosen,bank=bank)
    (OUT/'selection.json').write_text(json.dumps(selection,indent=2))
    print(json.dumps(dict(stage='selection_frozen',chosen=chosen)),flush=True)
    # Test arrays first accessed only after freezing the calibration choice.
    ti=cache['indices'];assert len(ti)==617 and all(rows[i]['split']=='test' for i in ti)
    assert not {rows[i]['video'] for i in ci}&{rows[i]['video'] for i in ti}
    y=cache['truth'];np.testing.assert_array_equal(y,[rows[i]['phase'] for i in ti]);p=softmax(cache['logits']);s,u,rr=aligned(ti)
    t,w=chosen['temperature'],chosen['cnn_weight'];fused=fuse(p,s,u,t,w)
    test_rows=[rows[i] for i in ti];test=dict(cnn128=report(p,y,test_rows),fusion=report(fused,y,test_rows))
    manual=np.array([r['phase_order'][:3] for r in rr]);hit=(manual==y[:,None]).any(1)&u
    test['deterministic']=dict(n=len(y),top1=int(sum(r['phase']==int(yy) for r,yy in zip(rr,y))),top3=int(hit.sum()),top3_accuracy=float(hit.mean()))
    assert test['cnn128']['top3']==495 and test['deterministic']['top3']==420
    oldgood=(np.argsort(-p,axis=1,kind='stable')[:,:3]==y[:,None]).any(1);newgood=(np.argsort(-fused,axis=1,kind='stable')[:,:3]==y[:,None]).any(1)
    paired=dict(both_hit=int((oldgood&newgood).sum()),fusion_only_hit=int((newgood&~oldgood).sum()),cnn_only_hit=int((oldgood&~newgood).sum()),both_miss=int((~newgood&~oldgood).sum()))
    np.savez_compressed(OUT/'predictions.npz',indices=ti,truth=y,cnn=p,scores=s,usable=u,fused=fused,calibration_indices=ci,calibration_truth=cy,calibration_cnn=cp,calibration_scores=cs,calibration_usable=cu)
    coverage=json.loads((DATA/'coverage.json').read_text());coverage.update(experiment=plan['task'],inventory_sha256=digest(ROOT/'docs/TRAINING_DATA_INVENTORY.json'),new_training_examples=0)
    for source in coverage['sources']:source['use_in_current_run']='frozen CNN provenance only' if source['role']=='train' else source['role']
    (OUT/'coverage.json').write_text(json.dumps(coverage,indent=2))
    result=dict(plan=plan,selection=selection,test=test,paired_vs_cnn=paired,matcher_seconds=scores['seconds'],analysis_seconds=time.perf_counter()-started,baseline_parity=scores['baseline_parity'],dataset_sha256=meta['dataset_sha256'],cnn_cache_sha256=digest(DATA/'resnet101/predictions.npz'),matcher_source_hashes=scores['source_hashes'],shared_preprocessing=meta['preprocessing'],source_hashes={p.name:digest(p) for p in Path(__file__).parent.iterdir() if p.suffix in ['.py','.mjs']},limitation='One familiar test recording with correlated quads; frozen deterministic baseline lacks app geometry refinement. No app changes or newCNNinference.')
    (OUT/'results.json').write_text(json.dumps(result,indent=2));(Path(__file__).parent/'results.json').write_text(json.dumps(result,indent=2))
    print(json.dumps(dict(test=test,paired=paired)),flush=True)
if __name__=='__main__':main()
