"""Fixed-rule ensemble diagnostics; truth is used for evaluation only.

Oracle unions are ceilings, never deployable selectors. No fitted weights or gates.
"""
import collections
import hashlib
import json
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / '.board/fire-ai/ensemble'


def read(path):
    return json.loads(path.read_text())


def label(value):
    if isinstance(value, dict):
        return value['sheet'] * 64 + value['row'] * 2 + int(value['mirrored'])
    return value[0] * 64 + value[1] * 2 + int(value[2])


def plurality(row, names):
    votes = collections.Counter(row[n]['order'][0] for n in names if row[n]['order'])
    if not votes:
        return []
    highest = max(votes.values())
    # Stable ties prefer the primary colour matcher, then declared method order.
    for n in ['colour', *names]:
        order = row[n]['order']
        if order and votes[order[0]] == highest:
            return [order[0]]
    raise AssertionError('Unreachable tie')


def reciprocal_rank(row, names):
    scores = collections.defaultdict(float)
    for n in names:
        for rank, candidate in enumerate(row[n]['order'][:5], 1):
            scores[candidate] += 1 / (60 + rank)
    preferred = {c:i for i,c in enumerate(row['colour']['order'])}
    return sorted(scores, key=lambda c: (-scores[c], preferred.get(c, 999), c))


def load_dataset(name):
    directory = OUT/name
    native = read(directory/'rankings.json')
    rows = native['rows']
    by_id = {r['id']:r for r in rows}
    assert len(by_id) == len(rows)
    if name == 'quad1':
        archived = ROOT/'FireCrackle/src-tauri/target/actual-quad1'
        for method, filenames in {
            'old_size_grid':['baseline-refine-validation.json','extra-baseline-refine-validation.json'],
            'old_optimizer':['final-opt-refine-validation.json','extra-final-refine-validation.json'],
            'colour_optimizer':['coherent-gain-fit-refine-validation.json'],
        }.items():
            seen = set()
            for filename in filenames:
                for r in read(archived/filename)['rows']:
                    dest = by_id[r['id']]
                    assert r['expected'] == dest['expected'] and r['quad'] == dest['quad']
                    assert r['id'] not in seen
                    seen.add(r['id'])
                    dest[method] = dict(order=[label(c) for c in r['candidates']], status=r['status'])
            assert seen == set(by_id)
        edge = ROOT/'.board/edge-grid/validation/localized-exact-validation.json'
        group = ROOT/'.board/plane-groups/validation/strict-exact-validation.json'
        pair = read(ROOT/'.board/plane-groups/ported/joint-exact-validation.json')
        for r in pair['rows']:
            dest = by_id[r['id']]
            assert r['expected'] == dest['expected']
            assert dest['pixel_pairs']['order'][0:1] == ([] if r['joint'][2]['top'] is None else [r['joint'][2]['top']])
        expected_data = ROOT/'.board/fire-ai/quad1'
    else:
        edge = directory/'edge/localized-exact-validation.json'
        group = directory/'groups/strict-exact-validation.json'
        expected_data = ROOT/('.board/fire-ai/survival' if name=='survival' else '.board/fire-ai/baseline-reviewed')
    for file, mapping in [(edge, {'edge_fit':'edgeFit','edge_supported':'supported'}),
                          (group, {'line_groups':'groupFit'})]:
        other = read(file)
        assert other['hashes'] == native['hashes']
        assert {r['id'] for r in other['rows']} == set(by_id)
        for r in other['rows']:
            dest = by_id[r['id']]
            assert r['expected'] == dest['expected'] and r['outline'] == dest['quad']
            truth = label(dest['expected'])
            assert r['baseline']['correct'] == (dest['colour']['order'][:1] == [truth])
            for method, field in mapping.items():
                value = r[field]
                order = [] if not value.get('top') else [label(value['top'])]
                assert value['correct'] == (order == [truth])
                dest[method] = dict(order=order, status=value['status'])
    manifest = read(expected_data/'manifest.json')
    cases = [r for r in manifest['samples'] if r['split']=='validation']
    assert [r['id'] for r in cases] == [r['id'] for r in rows]
    truth = np.array([label(r['expected']) for r in rows])
    models = [('resnet18', ROOT/'.board/fire-ai/resnet18'),
              ('small_control', ROOT/'.board/fire-ai/resnet18/small-control')]
    subdir = 'curated-survival' if name=='reviewed' else name
    filename = 'predictions-val.npz' if name=='reviewed' else 'predictions-real.npz'
    for method, base in models:
        with np.load(base/subdir/filename) as predictions:
            assert np.array_equal(predictions['truth'], truth)
            for i, row in enumerate(rows):
                row[method] = dict(order=predictions['order'][i,:5].tolist(), confidence=float(predictions['confidence'][i]))
    return rows, native


def evaluate(rows):
    methods = ['colour','pixel_pairs','old_sampler','independent_colour','rarity',
               'old_size_grid','old_optimizer','colour_optimizer','edge_fit',
               'edge_supported','line_groups','small_control','resnet18']
    truth = [label(r['expected']) for r in rows]
    base = np.array([r['colour']['order'][:1] == [y] for r,y in zip(rows,truth)])
    result = dict(n=len(rows),methods={},combinations={},oracle={})
    for r in rows:
        r['cnn_vote'] = dict(order=plurality(r,['colour','small_control','resnet18']))
        r['pair_vote'] = dict(order=plurality(r,['colour','pixel_pairs','resnet18']))
        r['classical_vote'] = dict(order=plurality(r,methods[:-2]))
        r['all_vote'] = dict(order=plurality(r,methods))
        r['rank_fusion'] = dict(order=reciprocal_rank(r,['colour','pixel_pairs','small_control','resnet18']))
        agree = r['small_control']['order'][0] == r['resnet18']['order'][0]
        fallback = r['colour']['order']
        r['cnn_rescue'] = dict(order=[r['resnet18']['order'][0]] if agree and r['colour'].get('status')!='clear' else fallback)
        r['unanimous'] = dict(order=fallback[:1] if fallback and agree and fallback[0]==r['resnet18']['order'][0] else [])
    combos = ['cnn_vote','pair_vote','classical_vote','all_vote','rank_fusion','cnn_rescue','unanimous']
    for method in methods+combos:
        orders = [r[method]['order'] for r in rows]
        correct = np.array([order[:1]==[y] for order,y in zip(orders,truth)])
        info = dict(top1=int(correct.sum()), predictions=sum(bool(o) for o in orders),
                    wrong=sum(bool(o) and o[0]!=y for o,y in zip(orders,truth)),
                    rescues=int((correct & ~base).sum()), breaks=int((~correct & base).sum()),
                    with_baseline_oracle=int((correct|base).sum()),
                    block_correct=sum(c and r['source']=='block' for c,r in zip(correct.tolist(),rows)),
                    entity_correct=sum(c and r['source']=='entity' for c,r in zip(correct.tolist(),rows)))
        (result['methods'] if method in methods else result['combinations'])[method] = info
    for name, pool in [('colour_plus_resnet',['colour','resnet18']),('colour_plus_pairs',['colour','pixel_pairs']),
                       ('all_classical',methods[:-2]),('all_methods',methods)]:
        correct = [any(r[m]['order'][:1]==[y] for m in pool) for r,y in zip(rows,truth)]
        result['oracle'][name] = dict(top1=int(sum(correct)), rescues=int(sum(c and not b for c,b in zip(correct,base))))
    # Candidate-list ceilings use only methods with complete saved top-five lists.
    pool=['colour','pixel_pairs','small_control','resnet18']
    for k in [1,3,5]:
        result['oracle'][f'candidate_union_top{k}'] = sum(any(y in r[m]['order'][:k] for m in pool) for r,y in zip(rows,truth))
    result['rows'] = rows
    return result


def main():
    results={};evidence={}
    for name in ['quad1','survival','reviewed']:
        rows, native = load_dataset(name)
        results[name] = evaluate(rows)
        evidence[name] = dict(source_hashes=native['hashes'],native_frames=native['frameHashes'],manifest_sha256=native['manifest_sha256'])
        print(name,json.dumps({k:v for k,v in results[name].items() if k!='rows'}),flush=True)
    OUT.mkdir(parents=True,exist_ok=True)
    legacy={}
    for tag in ['baseline','current-baseline','rarity']:
        directory=ROOT/'FireCrackle/src-tauri/target/actual-quad-runtime'/tag
        legacy[tag]={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in directory.glob('*.js')}
    (OUT/'diagnostic.json').write_text(json.dumps(dict(results=results,evidence=evidence,legacy_runtime_hashes=legacy),indent=2))


if __name__=='__main__':
    main()
