"""Summarize paired real-case ECC benchmark without selecting parameters on outcomes."""
import json
from pathlib import Path
import numpy as np

ROOT=Path(__file__).resolve().parents[4];OUT=ROOT/'.board/ecc-align'

def main():
    cases=json.loads((OUT/'cases.json').read_text())
    baseline=json.loads((OUT/'baseline.json').read_text())['rows']
    selected=json.loads((OUT/'selected.json').read_text())['rows']
    variants={n:json.loads((OUT/f'{f}.json').read_text())['rows'] for n,f in [('ecc','score-ecc'),('bounded_ecc','score-ecc-bounded')] if (OUT/f'{f}.json').exists()}
    report={}
    def error(q,r):return float(np.linalg.norm((np.asarray(q)-r['quad'])*[r['width'],r['height']],axis=1).mean())
    for material in ['normal','soul']:
        indices=[i for i,r in enumerate(cases) if r['material']==material]
        b=dict(n=len(indices),rough_top3=sum(cases[i]['phase'] in baseline[i]['fixed'] for i in indices),current_top3=sum(cases[i]['phase'] in baseline[i]['fitted'] for i in indices),current_search_median_ms=float(np.median([baseline[i]['ms'] for i in indices])))
        for name,rs in variants.items():
            b[name]=dict(top3=sum(cases[i]['phase'] in rs[i]['fitted'] for i in indices),rescued=sum(cases[i]['phase'] not in baseline[i]['fitted'] and cases[i]['phase'] in rs[i]['fitted'] for i in indices),lost=sum(cases[i]['phase'] in baseline[i]['fitted'] and cases[i]['phase'] not in rs[i]['fitted'] for i in indices),median_ms=float(np.median([rs[i]['ms'] for i in indices])),rejected_fits=sum(rs[i]['failures'] for i in indices),attempted_fits=len(indices)*128)
        b['selected_sprite_geometry']={}
        for shape in ['rough','exact']:
            start=[error(cases[i][shape] if shape=='rough' else cases[i]['quad'],cases[i]) for i in indices]
            stats={'input_mean_px':float(np.mean(start)),'input_median_px':float(np.median(start))}
            for name,rs in [('current',selected),*variants.items()]:
                errors=[error(rs[i]['selected'][shape]['quad'],cases[i]) for i in indices]
                stats[name]=dict(mean_px=float(np.mean(errors)),median_px=float(np.median(errors)),improved_quarter_px=sum(e<s-.25 for e,s in zip(errors,start)),worsened_quarter_px=sum(e>s+.25 for e,s in zip(errors,start)),unchanged_quarter_px=sum(abs(e-s)<=.25 for e,s in zip(errors,start)))
            b['selected_sprite_geometry'][shape]=stats
        report[material]=b
    (OUT/'results.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))

if __name__=='__main__':main()
