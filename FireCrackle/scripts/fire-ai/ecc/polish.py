"""Fixed selected sprite, ECC final adjustment from existing fitted corners."""
import hashlib,json,time,sys
from pathlib import Path
import cv2,numpy as np
from align import ROOT,OUT,N,fit,templates,canvas_h,validate_result
DEST=ROOT/'.board/ecc-polish'

def patch(image,mask,q):
    h=canvas_h(np.asarray(q)*[image.shape[1],image.shape[0]]-.5)
    rgb=cv2.warpPerspective(image,np.linalg.inv(h),(N,N),flags=cv2.INTER_LINEAR)
    valid=cv2.warpPerspective(mask,np.linalg.inv(h),(N,N),flags=cv2.INTER_NEAREST)>0
    return cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY).astype(np.float64)/255,valid

def correlation(a,b,mask):
    x=a[mask];y=b[mask];x=x-x.mean();y=y-y.mean();den=np.linalg.norm(x)*np.linalg.norm(y)
    return float(x@y/den) if den>1e-9 else None

def main():
    exact='--exact' in sys.argv
    cases=json.loads((OUT/'cases.json').read_text());selected=json.loads((OUT/'selected.json').read_text())['rows'];bank={m:templates(m) for m in ['normal','soul']};rows=[]
    for i,r in enumerate(cases):
        image=np.fromfile(ROOT/r['pixels'],np.uint8).reshape(r['height'],r['width'],3);mask=np.fromfile(OUT/f'{i}.exact.mask' if exact else DEST/f'{i}.mask',np.uint8).reshape(r['height'],r['width'])*255
        original=np.asarray(r['quad'] if exact else selected[i]['selected']['rough']['quad']);model=selected[i]['selected']['rough']['model'];assert model==r['selected_model']
        truth=np.asarray(r['quad']);scale=np.array([r['width'],r['height']]);error=lambda q:float(np.linalg.norm((q-truth)*scale,axis=1).mean())
        # Frozen final-polish cap: half the smallest projected sprite texel.
        cap=float(np.linalg.norm((original-np.roll(original,1,axis=0))*scale,axis=1).min()/32)
        initial,valid=patch(image,mask,original);reference,alpha,_=bank[r['material']][model]
        result=dict(id=r['id'],material=r['material'],model=model,before_error=error(original),movement_cap_px=cap,methods={})
        for name,bounded in [('ecc',False),('bounded_ecc',True)]:
            started=time.perf_counter();f=fit(image,mask,bank[r['material']],original,bounded=bounded,only_model=model)['candidates'][0]
            candidate=np.asarray(f['quad']);proposal_error=error(candidate);reason=f['reason'];gain=None;accepted=False;after=original
            if reason is None:
                delta=(candidate-original)*scale;largest=float(np.linalg.norm(delta,axis=1).max())
                if largest>0: candidate=original+delta*min(1,cap/largest)/scale
                try:
                    validate_result(candidate,original)
                    edges=np.roll(candidate,-1,axis=0)-candidate
                    turns=edges[:,0]*np.roll(edges,-1,axis=0)[:,1]-edges[:,1]*np.roll(edges,-1,axis=0)[:,0]
                    if not (np.all(turns>1e-10) or np.all(turns< -1e-10)):raise ValueError('folded final adjustment')
                    aligned,new_valid=patch(image,mask,candidate)
                    common=(alpha>0)&valid&new_valid
                    if np.count_nonzero(common)<1024:reason='insufficient common support'
                    else:
                        before=correlation(reference,initial,common);score=correlation(reference,aligned,common)
                        gain=None if before is None or score is None else score-before
                        if gain is not None and gain>.005:after=candidate;accepted=True
                        else:reason='no correlation improvement'
                except ValueError as exc:reason=str(exc)
            result['methods'][name]=dict(accepted=accepted,reason=reason,correlation_gain=gain,raw_proposal_error=proposal_error,after_error=error(after),max_corner_move_px=float(np.linalg.norm((after-original)*scale,axis=1).max()),ms=(time.perf_counter()-started)*1000,quad=after.tolist())
        rows.append(result)
    summary={}
    for material in ['normal','soul']:
        rr=[r for r in rows if r['material']==material];report=dict(n=len(rr),before_mean_px=float(np.mean([r['before_error'] for r in rr])),before_median_px=float(np.median([r['before_error'] for r in rr])))
        for name in ['ecc','bounded_ecc']:
            report[name]=dict(accepted=sum(r['methods'][name]['accepted'] for r in rr),improved=sum(r['methods'][name]['after_error']<r['before_error']-.25 for r in rr),worsened=sum(r['methods'][name]['after_error']>r['before_error']+.25 for r in rr),mean_error_px=float(np.mean([r['methods'][name]['after_error'] for r in rr])),median_ms=float(np.median([r['methods'][name]['ms'] for r in rr])))
        summary[material]=report
    plan=dict(task='ECC final polish only; fixed known sprite',starting_quad='Exact renderer reference control' if exact else 'Current selected-sprite fitted corners',cases=128,inputs='Same64V06normal+64V14soul; same real shared-unveil caches; no training',case_sha256=hashlib.sha256((OUT/'cases.json').read_bytes()).hexdigest(),selected_sha256=hashlib.sha256((OUT/'selected.json').read_bytes()).hexdigest(),cap='Half smallest projected texel; globally shorten proposed corner step',acceptance='Fixed common opaque/production-fire pixel support>=1024canvaspixels; grayscale correlation gain>.005; same identity/finite bounded geometry; no colour-score gate',variants='Previous standard and bounded homography; no phase search or CNN; no tuned thresholds')
    suffix='-exact' if exact else ''
    (DEST/f'rows{suffix}.json').write_text(json.dumps(rows));(DEST/f'results{suffix}.json').write_text(json.dumps(dict(plan=plan,summary=summary),indent=2));print(json.dumps(summary,indent=2))
    assert all(r['methods'][name]['max_corner_move_px']<=r['movement_cap_px']+1e-5 for r in rows for name in ['ecc','bounded_ecc'])
if __name__=='__main__':main()
