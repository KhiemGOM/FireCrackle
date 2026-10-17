"""Frozen support/margin gates using existing canonical first-person GUI diagnostics."""
import argparse
import itertools
import json
from pathlib import Path

import numpy as np

from pov_gui_stages import OUT as CACHE, ROOT, SOURCES, sha, truth_for

OUT = ROOT / '.board/pov-gui-support'
GRIDS = {
    'used': [5, 10, 20, 40, 80, 160],
    'hits': [5, 10, 20, 40, 80, 160],
    'raw_margin': [0, .25, .5, 1, 2, 3],
    'mask_margin': [-2, -1, 0, .25, .5, 1, 2],
    'colour_margin': [-.2, -.1, 0, .025, .05, .1, .2],
    'raw_evidence': [-1, -.25, 0, .125, .25, .375],
    'visible_evidence': [.5, .6, .7, .8, .9],
    'silhouette': [-1, 0, .5, 1, 2],
}
RULES = [[], [('never', 1)]]  # broad-mask control and opaque-only fallback
for name, values in GRIDS.items():
    RULES.extend([[(name, value)] for value in values])
for first, second in [('used', 'raw_margin'), ('used', 'mask_margin'),
                      ('raw_evidence', 'raw_margin'), ('raw_evidence', 'mask_margin')]:
    RULES.extend([[(first, a), (second, b)]
                  for a, b in itertools.product(GRIDS[first], GRIDS[second])])


def features(record):
    stats = record['stats']
    sz = np.array([s['sz'] for s in stats])
    cz = np.array([s['cz'] for s in stats])
    sums = np.array([s['sum'] for s in stats], dtype=float)
    used = np.array([s['used'] for s in stats])
    ev = np.divide(sums, used, out=np.zeros_like(sums), where=used >= 5)
    combined = sz + stats[0]['weight'] * cz
    rows = combined[:2].argmax(axis=1)
    fov = int(ev[1, rows[1]] > ev[0, rows[0]])
    row = int(rows[fov])
    opaque, broad = 2 + fov, 6 + fov
    other = np.arange(32) != row
    raw_evidence = float(ev[fov, row])
    opaque_evidence = float(ev[opaque, row])
    return {
        'n': record['n'], 'row': row,
        'base': raw_evidence >= .5,
        'opaque': raw_evidence >= .5 or opaque_evidence >= .5,
        'used': float(used[broad, row]),
        'hits': float((used[broad, row] + sums[broad, row]) / 2),
        'raw_margin': float(combined[fov, row] - combined[fov, other].max()),
        'mask_margin': float(combined[broad, row] - combined[broad, other].max()),
        'colour_margin': float(ev[broad, row] - ev[broad, other].max()),
        'raw_evidence': raw_evidence,
        'visible_evidence': float(ev[broad, row]),
        'silhouette': float(sz[fov, row]),
        'never': 0.,
    }


def decisions(feature_rows):
    columns = {k: np.array([r[k] for r in feature_rows]) for k in feature_rows[0]}
    extra = columns['visible_evidence'] >= .5
    result = []
    for rule in RULES:
        gate = extra.copy()
        for name, threshold in rule:
            gate &= columns[name] >= threshold
        result.append(columns['opaque'] | gate)
    return np.stack(result, axis=1), columns


def metrics(truth, rows, accepted, baseline):
    truth, rows, baseline = map(np.asarray, (truth, rows, baseline))
    positive = truth >= 0
    correct = positive & (rows == truth)
    good = accepted & correct[:, None]
    basegood = baseline & correct
    return {
        'correct': good.sum(axis=0).tolist(),
        'false_positives': (accepted & ~positive[:, None]).sum(axis=0).tolist(),
        'wrong_rows': (accepted & positive[:, None] & ~correct[:, None]).sum(axis=0).tolist(),
        'new_correct': (good & ~basegood[:, None]).sum(axis=0).tolist(),
        'lost_correct': (~good & basegood[:, None]).sum(axis=0).tolist(),
    }


def choose_rule(by_source, held_out):
    """Exclude held-out metrics from both filtering and ranking."""
    train = [m for name, m in by_source.items() if name != held_out]
    eligible = [i for i in range(len(RULES)) if all(
        m['false_positives'][i] == m['wrong_rows'][i] == m['lost_correct'][i] == 0
        for m in train)]
    if not eligible:
        raise ValueError('No error-free training rule, including opaque-only fallback')
    return min(eligible, key=lambda i: (-sum(m['correct'][i] for m in train), len(RULES[i]), i))


def load_source(name, historical=False):
    truth, last, truth_hash = truth_for(name)
    meta = json.loads((CACHE / f'{name}.meta.json').read_text())
    assert meta['truth_sha256'] == truth_hash
    assert meta['stride'] == (5 if name in ('clip1', 'clip2') else 30)
    assert meta['total'] == last // meta['stride'] + 1
    for path, expected in meta['sources'].items():
        if path.endswith('.py'):
            continue  # old analysis scripts are independent of cached inference
        if historical and path.endswith('.rs'):
            continue  # explicit historical analysis; preserve hashes in report
        assert sha(ROOT / path) == expected, f'Stale inference cache: {path}'
    video = Path(meta['video'])
    assert video.stat().st_size == meta['video_bytes']
    source_features = []
    count = 0
    for line in (CACHE / f'{name}.jsonl').open():
        record = json.loads(line)
        count += 1
        if record['n'] in truth:
            source_features.append(features(record))
    assert count == meta['total']
    accepted, columns = decisions(source_features)
    frames = columns['n']
    labels = np.array([-1 if truth[n]['truth'] is None else truth[n]['truth'] for n in frames])
    previous = np.load(CACHE / f'{name}-predictions.npz')
    assert np.array_equal(previous['frames'], frames)
    assert np.array_equal(previous['base_rows'], columns['row'])
    assert np.array_equal(previous['base_scores'] >= .5, columns['base'])
    previous_report = json.loads((CACHE / f'{name}-report.json').read_text())
    control = next(r for r in previous_report['results'] if r['config'] == {
        'coverage': 'opaque', 'silhouette': 0, 'colour': 'raw_sum',
        'gate': 'visible', 'fov': 'frozen'})
    measure = metrics(labels, columns['row'], accepted, columns['base'])
    assert measure['correct'][1] == control['correct']
    assert measure['false_positives'][1] == control['false_positives']
    # Frame-level parity with prior opaque-only decisions, not just totals.
    from pov_gui_stages import CONFIGS
    k = CONFIGS.index(control['config'])
    assert np.array_equal(columns['opaque'], (previous['scores'][:, k] >= .5) | columns['base'])
    np.savez_compressed(OUT / f'{name}.npz', frames=frames, truth=labels,
                        rows=columns['row'], accepted=accepted, **{
                            k: v for k, v in columns.items() if k not in ('n', 'row')})
    return measure


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--historical-cache', action='store_true',
                        help='Analyze frozen earlier Rust diagnostics, recording their source hashes; assets/truth still checked')
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    by_source = {}
    for name in SOURCES:
        by_source[name] = load_source(name, args.historical_cache)
        print(f'{name}: cached support diagnostics validated', flush=True)
    pooled = {k: np.sum([m[k] for m in by_source.values()], axis=0).tolist()
              for k in next(iter(by_source.values()))}
    folds = []
    for held_out in SOURCES:
        i = choose_rule(by_source, held_out)
        folds.append({'held_out': held_out, 'rule_id': i, 'rule': RULES[i],
                      'test': {k: v[i] for k, v in by_source[held_out].items()}})
    best = choose_rule({'pooled': pooled}, None)
    report = {'rules': RULES, 'grids': GRIDS, 'sources': by_source,
              'pooled': pooled, 'folds': folds, 'pooled_selected': best,
              'analysis_sha256': sha(Path(__file__)),
              'historical_inference': args.historical_cache,
              'cache_source_hashes': {n: json.loads((CACHE / f'{n}.meta.json').read_text())['sources'] for n in SOURCES},
              'caveat': 'Reused clips; leave-one-recording-out transfer check, not fresh validation.'}
    (OUT / 'report.json').write_text(json.dumps(report, indent=2))
    print(json.dumps({'configs': len(RULES), 'pooled_selected': {'rule': RULES[best],
                      **{k: v[best] for k, v in pooled.items()}}, 'folds': folds}), flush=True)


if __name__ == '__main__':
    main()
