"""Top-three recount only. Does not choose a new ensemble on test outcomes."""
import hashlib
import json
from pathlib import Path
import numpy as np

ROOT=Path(__file__).resolve().parents[5];OUT=ROOT/'.board/row32-top3'
def audit(rows,p,manual,margin,y,rule):
    cnn=np.argsort(-p,axis=1,kind='stable')[:,:3]
    appearance=np.array([r['appearance_top3_phases'] for r in rows]);distinct=np.array([r['distinct_top3_phases'] for r in rows])
    c=(cnn==y[:,None]).any(1);a=(appearance==y[:,None]).any(1);d=(distinct==y[:,None]).any(1)
    override=(p.argmax(1)!=manual)&(manual>=0)&(p.max(1)<rule['cnn_below'])&(margin>=rule['matcher_margin_at_least'])
    hybrid=(np.where(override[:,None],distinct,cnn)==y[:,None]).any(1)
    unions=[set(cn)|{int(v) for v in dt if v>=0} for cn,dt in zip(cnn,distinct)];intersections=[set(cn)&set(dt) for cn,dt in zip(cnn,distinct)]
    result=dict(n=len(y),cnn_top3=int(c.sum()),matcher_first3_appearances=int(a.sum()),matcher_top3_distinct_phases=int(d.sum()),previous_top1_selector_top3=int(hybrid.sum()),both_top3_hit=int((c&d).sum()),cnn_only_top3_hit=int((c&~d).sum()),matcher_only_top3_hit=int((~c&d).sum()),neither_top3_hit=int((~c&~d).sum()),union_hit=int((c|d).sum()),union_mean_slots=float(np.mean([len(u) for u in unions])),union_max_slots=max(map(len,unions)),intersection_nonempty=sum(bool(s) for s in intersections),intersection_has_truth=sum(int(yy) in s for yy,s in zip(y,intersections)),duplicate_phase_slots_in_first3=sum(len(set(r))<3 for r in appearance))
    assert result['both_top3_hit']+result['cnn_only_top3_hit']+result['matcher_only_top3_hit']+result['neither_top3_hit']==len(y)
    assert result['intersection_has_truth']==result['both_top3_hit']
    return result

def main():
    ranks=json.loads((OUT/'matcher.json').read_text());byid={r['id']:r for r in ranks['rows']}
    manifest=json.loads((ROOT/'.board/row32-128/manifest.json').read_text())['samples']
    hybrid=np.load(ROOT/'.board/row32-hybrid/predictions.npz');rule=json.loads((ROOT/'.board/row32-hybrid/selection.json').read_text())['rule']
    results={}
    for split,prefix in [('calibration','calibration_'),('test','')]:
        indices=hybrid[f'{prefix}indices'] if prefix else hybrid['indices']
        p=hybrid['calibration_probabilities' if prefix else 'cnn_probabilities'];m=hybrid[f'{prefix}matcher'];margin=hybrid[f'{prefix}margin'];y=hybrid[f'{prefix}truth']
        rows=[byid[manifest[i]['id']] for i in indices]
        assert all(r['split']==split for r in rows)
        np.testing.assert_array_equal([r['phase'] for r in rows],m)
        results[split]=audit(rows,p,m,margin,y,rule)
        results[split]['groups']={}
        for source in ['block','entity']:
            mask=np.array([manifest[i]['source']==source for i in indices]);rr=[r for r,keep in zip(rows,mask) if keep]
            results[split]['groups'][source]=audit(rr,p[mask],m[mask],margin[mask],y[mask],rule)
    # Recorded unchanged128px metric; verify our independent rank extraction.
    assert results['test']['cnn_top3']==495
    results.update(definition='Success means true animation phase is anywhere in the shortlist; not exact sheet/mirror appearance. First3 appearances can repeat phases. Union has up to6 slots, not a three-slot ensemble.',selection='None. Previous top-one selector reused unchanged only as a diagnostic, not selected for top-three.',limitation='Frozen deterministic sampleFrame/similarity control, without app geometry-refinement. Familiar recording and correlated quads; not current live-app end-to-end accuracy.',source_hashes={f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in [Path(__file__),Path(__file__).with_suffix('.mjs')]},baseline_parity=ranks['baseline_parity'])
    (OUT/'results.json').write_text(json.dumps(results,indent=2));(Path(__file__).parent/'top3-results.json').write_text(json.dumps(results,indent=2))
    print(json.dumps(results,indent=2))
if __name__=='__main__':main()
