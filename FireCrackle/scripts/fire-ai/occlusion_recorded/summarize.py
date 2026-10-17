"""Aggregate frozen native-pixel matcher runs, with frame-cluster intervals."""
import json
from pathlib import Path
import numpy as np

ROOT=Path(__file__).resolve().parents[4]
OUT=ROOT/'.board/occlusion-recorded'
SETS=['new-test','new-test-rough','quad1','quad1-rough','survival','survival-rough','reviewed','synthetic']


def main():
    summary={};table=['| Dataset | Targets | Colour matcher | Previous mask | Fine-tuned mask | Scratch mask |',
                     '|---|---:|---:|---:|---:|---:|']
    for name in SETS:
        models={run:json.loads((OUT/run/(name+'-native-score')/'results.json').read_text()) for run in ['previous','finetune','scratch']}
        d=models['finetune'];groups={}
        for row in d['rows']:
            if row['has_target']:
                groups.setdefault(row['frame'],[]).append(int(row['methods']['learned_soft']['correct'])-int(row['methods']['colour']['correct']))
        sums=np.array([sum(v) for v in groups.values()]);sizes=np.array([len(v) for v in groups.values()]);rng=np.random.default_rng(19017)
        indices=rng.integers(len(sums),size=(5000,len(sums)))
        boot=100*sums[indices].sum(1)/sizes[indices].sum(1)
        gains=[r['id'] for r in d['rows'] if r['methods']['learned_soft']['correct'] and not r['methods']['colour']['correct']]
        losses=[r['id'] for r in d['rows'] if r['methods']['colour']['correct'] and not r['methods']['learned_soft']['correct']]
        summary[name]=dict(n=d['n'],targets=d['targetCases'],groups=len(groups),gains=gains,losses=losses,
            frame_bootstrap95_delta_pp=np.percentile(boot,[2.5,97.5]).round(2).tolist(),
            methods={'colour':d['summary']['colour'],**{run:{k:m['summary'][k] for k in ['learned_soft','learned_half','learned_hard']} for run,m in models.items()}},
            scorer_hashes=d['hashes'],adapter_sha256=d['scriptSHA256'])
        if name=='synthetic':
            summary[name]['by_condition']={kind:{k:sum(r['methods'][k]['correct'] for r in d['rows'] if r['source']==kind) for k in ['colour','learned_soft']} for kind in sorted(set(r['source'] for r in d['rows']))}
            summary[name]['no_target_false_clear']={run:{k:sum(r['methods'][k]['clear'] for r in m['rows'] if not r['has_target']) for k in ['colour','learned_soft']} for run,m in models.items()}
        table.append('| '+' | '.join(map(str,[name,d['targetCases'],d['summary']['colour']['top1'],models['previous']['summary']['learned_soft']['top1'],d['summary']['learned_soft']['top1'],models['scratch']['summary']['learned_soft']['top1']]))+' |')
    (OUT/'downstream-summary.json').write_text(json.dumps(summary,indent=2))
    (OUT/'table.md').write_text('\n'.join(table)+'\n')
    print('\n'.join(table))


if __name__=='__main__':main()
