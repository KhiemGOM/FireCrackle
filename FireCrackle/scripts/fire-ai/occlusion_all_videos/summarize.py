"""Summarize every scored recording and list the coverage gaps explicitly."""
import json
from pathlib import Path
import numpy as np

ROOT=Path(__file__).resolve().parents[4]
OUT=ROOT/'.board/occlusion-all-videos'
METHODS=['colour','pairs4','facing1','facing4','jitter_max_pairs1','jitter_max_pairs4']
PRIOR_LEADERS={'exact':'facing4','rough':'jitter_max_pairs4'}
FILENAMES={'quad1':'2026-10-16 00-40-22.mkv','survival1':'2026-10-16 18-23-42.mkv','new_recording':'2026-10-17 18-28-42.mkv'}


def main():
    summary={};table=['| Video | Quad | Cases | Prior strong baseline | With new mask | Change |',
                      '|---|---|---:|---:|---:|---:|']
    all_methods=['| Video | Quad | Method | Before | After | Net correct |',
                 '|---|---|---|---:|---:|---:|']
    parity=[]
    for video in FILENAMES:
        for mode in ['exact','rough']:
            result=json.loads((OUT/video/(mode+'-score')/'results.json').read_text());n=result['n'];changes={}
            for method in METHODS:
                a=result['summary'][method]['top1'];b=result['summary'][method+'_mask']['top1'];groups={};gains=[];losses=[]
                for row in result['rows']:
                    before=row['methods'][method]['correct'];after=row['methods'][method+'_mask']['correct']
                    groups.setdefault(row['frame'],[]).append(int(after)-int(before))
                    if after and not before:gains.append(row['id'])
                    if before and not after:losses.append(row['id'])
                sums=np.array([sum(v) for v in groups.values()]);sizes=np.array([len(v) for v in groups.values()]);rng=np.random.default_rng(19017)
                draws=rng.integers(len(sums),size=(5000,len(sums)));interval=np.percentile(100*sums[draws].sum(1)/sizes[draws].sum(1),[2.5,97.5]).round(2).tolist()
                changes[method]=dict(before=a,after=b,before_percent=100*a/n,after_percent=100*b/n,gains=gains,losses=losses,frame_bootstrap95_delta_pp=interval)
                all_methods.append(f'| {video} | {mode} | {method} | {a}/{n} ({100*a/n:.1f}%) | {b}/{n} ({100*b/n:.1f}%) | {b-a:+} |')
            summary[f'{video}/{mode}']=dict(n=n,frames=len(groups),methods=changes,scorer_hashes=result['hashes'],adapter_sha256=result['adapter_sha256'])
            m=PRIOR_LEADERS[mode];a=changes[m]['before'];b=changes[m]['after']
            table.append(f'| {video} | {mode} | {n} | {a}/{n} ({100*a/n:.1f}%) | {b}/{n} ({100*b/n:.1f}%) | {100*(b-a)/n:+.1f} pp |')
            if video=='quad1':
                historical=json.loads((ROOT/'.board/boundary-robust'/video/mode/f'validation-{mode}.json').read_text())
                for method in METHODS:
                    assert historical['summary'][method]['top1']==result['summary'][method]['top1'],method
                parity.append(f'{video}/{mode}: all six unmasked counts match frozen historical run')
            if video=='new_recording':
                assert n==48
    coverage=[]
    for path in sorted((ROOT/'fire-detection/data/video').iterdir()):
        if path.suffix.lower() not in ['.mkv','.mp4','.mov']:continue
        if path.name in FILENAMES.values():
            status='Scored frozen held-out quad pool; partial renderer sidecars for new recording'
        elif path.name in ['2026-10-15 14-48-36.mkv','2026-10-15 18-18-16.mkv']:
            status='N/A: joined labels contain zero quad corners; boxes cannot substitute for planes'
        elif path.name=='2026-10-17 17-04-31.mkv':
            status='N/A: failed ownership prototype; all-unknown mask exports'
        else:status='N/A: no compatible frozen, aligned quad-labelled benchmark available'
        coverage.append(dict(video=path.name,status=status))
    output=dict(primary_frozen_baseline='facing1 (selected previously on tuning data)',
                prior_mode_leaders=PRIOR_LEADERS,prior_mode_leaders_note='Strongest earlier quad1 exact/rough research methods, fixed across videos; prior test-selected reference, not a new held-out selection',
                results=summary,coverage=coverage,parity_checks=parity)
    (OUT/'summary.json').write_text(json.dumps(output,indent=2))
    (OUT/'table.md').write_text('\n'.join(table)+'\n');(OUT/'all-methods.md').write_text('\n'.join(all_methods)+'\n')
    print('\n'.join(table));print('\n'.join(parity))


if __name__=='__main__':main()
