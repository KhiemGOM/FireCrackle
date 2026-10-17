"""Fixed score/vote policies over canonical veil On/Off branches; no temporal input."""
import argparse
import json
import subprocess
import time
from pathlib import Path

import numpy as np

from pov_gui_ablation import ROOT, SOURCES, sha, truth_for
from pov_gui_remaining import stream_sha
from pov_gui_spatial import RULES
from pov_gui_support import OUT as SUPPORT

OUT = ROOT / '.board/pov-dual-veil'
POLICIES = ['max_evidence', 'no_conflict', 'agreement', 'auto_priority']
# Distance from canonical detector's 90% range-compatibility threshold, not
# a calibrated confidence/probability. None = always evaluate both branches.
WIDTHS = [0., .01, .03, .05, .10, None]


def decision(mode):
    f = mode['fovs'][mode['fov']]
    accepted = f['raw'] >= .5 or f['opaque'] >= .5 or (
        f['broad'] >= .5 and f['margin'] >= .5 and f['span'] >= 2)
    # Acceptance must precede cross-hypothesis selection; GUI pixels are absent
    # from numerator and denominator in both masked branches.
    return {'row': f['row'], 'accepted': accepted,
            'evidence': max(f['raw'], f['opaque'], f['broad'] if f['margin'] >= .5 and f['span'] >= 2 else -1.)}


def combine(branches, auto, both, policy):
    current = branches[int(auto)]
    if not both:
        return current['row'], current['accepted']
    valid = [i for i, b in enumerate(branches) if b['accepted']]
    conflict = len(valid) == 2 and branches[0]['row'] != branches[1]['row']
    if policy == 'agreement':
        return current['row'], len(valid) == 2 and not conflict
    if policy == 'no_conflict' and conflict:
        return current['row'], False
    if not valid:
        return current['row'], False
    if policy == 'auto_priority' and current['accepted']:
        return current['row'], True
    # Exact score ties retain the automatic detector's choice.
    chosen = max(valid, key=lambda i: (branches[i]['evidence'], i == int(auto)))
    return branches[chosen]['row'], True


def capture(name, limit=None):
    _, last, truth_hash = truth_for(name)
    stride = 5 if name in ('clip1', 'clip2') else 30
    count = last // stride + 1
    if limit:
        count = min(count, limit)
    suffix = f'-pilot{limit}' if limit else ''
    output = OUT / f'{name}{suffix}.jsonl'
    meta = output.with_suffix('.meta.json')
    native = ROOT / 'fire-detection/core/target/release/examples/pov_dual_veil.exe'
    video = ROOT / 'fire-detection/data/video' / SOURCES[name]
    files = [ROOT / 'fire-detection/core/examples/pov_dual_veil.rs']
    files += [ROOT / f'fire-detection/core/src/{n}.rs' for n in ['overlay', 'veil', 'gui_mask', 'gui_screens', 'video']]
    files += [ROOT / 'fire-detection/data/assets/fire_1.rgba', *sorted((ROOT / 'fire-detection/data/assets/gui').glob('*rgba'))]
    signature = {'native_sha256': sha(native), 'source_asset_hashes': {str(p.relative_to(ROOT)): sha(p) for p in files},
        'truth_sha256': truth_hash, 'video_sha256': stream_sha(video), 'stride': stride, 'count': count}
    if output.exists() and meta.exists():
        old = json.loads(meta.read_text())
        assert old['signature'] == signature, 'Stale dual-veil cache; explicitly version changed inputs'
        return output
    start = time.perf_counter()
    subprocess.run([str(native), str(video), str(output), '1920', '1080', str(stride), str(count),
        str(ROOT / 'FireCrackle/src-tauri/runtime/ffmpeg.exe')], check=True)
    records = [json.loads(line) for line in output.open()]
    assert sorted(r['n'] for r in records) == list(range(0, count * stride, stride))
    meta.write_text(json.dumps({'signature': signature, 'seconds': time.perf_counter() - start}, indent=2))
    return output


def metrics(truth, rows, accepted, baseline):
    correct = (truth >= 0) & (truth == rows) & accepted
    good = (truth >= 0) & (baseline[0] == truth) & baseline[1]
    return {'correct': int(correct.sum()), 'false_positives': int(((truth < 0) & accepted).sum()),
        'wrong_rows': int(((truth >= 0) & (rows != truth) & accepted).sum()),
        'new_correct': int((correct & ~good).sum()), 'lost_correct': int((~correct & good).sum())}


def select_without(sources, excluded=None):
    """Development transfer check: selection cannot read excluded metrics."""
    training=[s for name,s in sources.items() if name!=excluded]
    eligible=[i for i in range(len(WIDTHS)*len(POLICIES)) if all(
        s['results'][i]['false_positives']==s['results'][i]['wrong_rows']==s['results'][i]['lost_correct']==0
        for s in training)]
    if not eligible:
        return None
    return min(eligible,key=lambda i:(-sum(s['results'][i]['correct'] for s in training),
        sum(s['results'][i]['dual_frames'] for s in training),i))


def analyze(name, path, screens=False):
    truth_map, _, truth_hash = truth_for(name)
    with np.load(SUPPORT / f'{name}-spatial-predictions.npz') as p:
        k = RULES.index([('x_span', 2), ('mask_margin', .5)])
        previous = {int(n): (int(row), bool(ok)) for n, row, ok in zip(p['frames'], p['rows'], p['accepted'][:, k])}
    records = sorted([json.loads(line) for line in path.open()], key=lambda r: r['n'])
    metadata=json.loads(path.with_suffix('.meta.json').read_text())
    signature=metadata['signature']
    assert signature['truth_sha256']==truth_hash, 'Changed truth since capture'
    assert [r['n'] for r in records]==list(range(0,signature['count']*signature['stride'],signature['stride']))
    scored = [r for r in records if r['n'] in truth_map]
    tr = np.array([-1 if truth_map[r['n']]['truth'] is None else truth_map[r['n']]['truth'] for r in scored])
    original_branches = [[decision(m) for m in r['modes']] for r in scored]
    branches = [[decision(m) for m in r['screen_modes' if screens else 'modes']] for r in scored]
    base_rows = np.array([previous[r['n']][0] for r in scored])
    base_accept = np.array([previous[r['n']][1] for r in scored])
    auto_differences=[]
    for r, bs in zip(scored, original_branches):
        auto = bs[int(r['auto'])]
        if path.parent.name=='pov-dual-veil-v2':
            assert auto['row']==previous[r['n']][0],(name,r['n'],'unmasked row changed')
            if (auto['row'],auto['accepted'])!=previous[r['n']]:auto_differences.append(r['n'])
        else:
            assert (auto['row'], auto['accepted']) == previous[r['n']], (name, r['n'], 'auto branch parity')
    previous_best_hash=None
    if path.parent.name=='pov-dual-veil-v2':
        parent=ROOT/'.board/pov-dual-veil'/f'{name}.jsonl'
        parent_records={r['n']:r for r in map(json.loads,parent.open())}
        previous_best_hash=sha(parent)
        reference=[]
        for r in scored:
            old=parent_records[r['n']]
            both=abs(old['share']-old['threshold'])<=.03+1e-12
            reference.append(combine([decision(m) for m in old['screen_modes']],old['auto'],both,'max_evidence'))
        base_rows=np.array([x[0] for x in reference]);base_accept=np.array([x[1] for x in reference])
    results = []
    for width in WIDTHS:
        dual = [width is None or abs(r['share'] - r['threshold']) <= width + 1e-12 for r in scored]
        all_dual = [width is None or abs(r['share'] - r['threshold']) <= width + 1e-12 for r in records]
        for policy in POLICIES:
            output = [combine(bs, r['auto'], both, policy) for r, bs, both in zip(scored, branches, dual)]
            rows = np.array([o[0] for o in output]); accepted = np.array([o[1] for o in output])
            result = {'uncertainty_width': width, 'policy': policy,
                **metrics(tr, rows, accepted, (base_rows, base_accept)),
                'dual_frames': sum(all_dual), 'decoded_frames': len(records),
                'matching_work_ratio': 1 + sum(all_dual) / len(records)}
            key='screen_modes' if screens else 'modes'
            result['estimated_matching_ms']=float(np.mean([r[key][int(r['auto'])]['ms']+
                (r[key][1-int(r['auto'])]['ms'] if both else 0) for r,both in zip(records,all_dual)]))
            result['new_correct_frames'] = [r['n'] for r, t, row, ok, br, ba in zip(scored, tr, rows, accepted, base_rows, base_accept)
                if ok and t >= 0 and row == t and not (ba and br == t)]
            result['error_frames'] = [r['n'] for r, t, row, ok in zip(scored, tr, rows, accepted) if ok and (t < 0 or row != t)]
            results.append(result)
    conflicts = [r['n'] for r, bs in zip(scored, branches) if bs[0]['accepted'] and bs[1]['accepted'] and bs[0]['row'] != bs[1]['row']]
    timing = {k: float(np.mean([r[k] for r in records])) for k in ['veil_ms', 'gui_ms','screen_ms']}
    timing['branch_ms'] = [float(np.mean([r['screen_modes' if screens else 'modes'][i]['ms'] for r in records])) for i in range(2)]
    screen_auto_rows=np.array([bs[int(r['auto'])]['row'] for r,bs in zip(scored,branches)])
    screen_auto_accept=np.array([bs[int(r['auto'])]['accepted'] for r,bs in zip(scored,branches)])
    return {'frames': len(scored), 'positive': int((tr >= 0).sum()), 'auto_parity': len(scored),
        'previous_best_cache_sha256':previous_best_hash,
        'auto_acceptance_changes_from_historical_gui':auto_differences,
        'baseline': metrics(tr, base_rows, base_accept, (base_rows, base_accept)),
        'same_mask_auto':metrics(tr,screen_auto_rows,screen_auto_accept,(base_rows,base_accept)),
        'screen_detected_frames':sum(r['screen_pixels']>0 for r in records),
        'accepted_branch_conflicts': conflicts, 'timing': timing, 'results': results}


def main():
    global OUT
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sources', nargs='+', default=list(SOURCES))
    parser.add_argument('--limit', type=int)
    parser.add_argument('--reuse', action='store_true')
    parser.add_argument('--cache-version',default='v1',choices=['v1','v2'])
    args = parser.parse_args()
    if args.cache_version=='v2':OUT=ROOT/'.board/pov-dual-veil-v2'
    OUT.mkdir(parents=True, exist_ok=True)
    sources = {}; screen_sources={}
    for name in args.sources:
        suffix = f'-pilot{args.limit}' if args.limit else ''
        path = OUT / f'{name}{suffix}.jsonl' if args.reuse else capture(name, args.limit)
        sources[name] = analyze(name, path)
        screen_sources[name] = analyze(name,path,screens=True)
        print(json.dumps({'source': name, 'baseline': sources[name]['baseline'],
            'always_both': sources[name]['results'][-4:]}), flush=True)
    def pool(group):
        output=[]
        for i in range(len(WIDTHS) * len(POLICIES)):
            rows = [s['results'][i] for s in group.values()]
            output.append({'uncertainty_width': rows[0]['uncertainty_width'], 'policy': rows[0]['policy'],
                **{k: sum(r[k] for r in rows) for k in ['correct', 'false_positives', 'wrong_rows', 'new_correct', 'lost_correct', 'dual_frames', 'decoded_frames']}})
        return output
    pooled=pool(sources);screen_pooled=pool(screen_sources)
    folds={name:{'selected':(choice:=select_without(sources,name)),
        'test':sources[name]['results'][choice] if choice is not None else None} for name in sources} if len(sources)>1 else {}
    screen_folds={name:{'selected':(choice:=select_without(screen_sources,name)),
        'test':screen_sources[name]['results'][choice] if choice is not None else None} for name in screen_sources} if len(sources)>1 else {}
    report = {'analysis_sha256': sha(Path(__file__)), 'sources': sources, 'pooled': pooled,
        'screen_sources':screen_sources,
        'screen_pooled':screen_pooled,
        'selected':select_without(sources),'folds':folds,
        'screen_selected':select_without(screen_sources),'screen_folds':screen_folds,
        'cache_hashes': {name: sha(OUT / f'{name}{suffix}.jsonl') for name in sources},
        'cache_metadata':{name:json.loads((OUT/f'{name}{suffix}.meta.json').read_text()) for name in sources}}
    suffix_report = '-'.join(args.sources) if len(args.sources)!=len(SOURCES) else ''
    report_name = ('pilot-report' if args.limit else 'report') + ('-'+suffix_report if suffix_report else '') + '.json'
    (OUT / report_name).write_text(json.dumps(report, indent=2))
    print(json.dumps({'pooled': pooled}), flush=True)


if __name__ == '__main__':
    main()
