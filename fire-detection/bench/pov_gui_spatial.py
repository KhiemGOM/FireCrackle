"""Label-blind sparse spatial follow-up: extract only broad-mask additions."""
import itertools
import json
import subprocess
from pathlib import Path

import numpy as np

from pov_gui_stages import ROOT, OUT as CACHE, SOURCES, sha
from pov_gui_support import OUT, features, metrics

# Freeze these before examining spatial features. Screen tiles are correlated,
# not independent statistical trials or texture-cell ownership ground truth.
SPATIAL_RULES = [('bins', n) for n in range(1, 9)]
SPATIAL_RULES += [('x_span', n) for n in range(1, 5)]
SPATIAL_RULES += [('y_span', n) for n in range(1, 5)]
SPATIAL_RULES += [('both_sides', 1)]
RULES = [[], [('never', 1)]] + [[r] for r in SPATIAL_RULES]
RULES += [[r, ('mask_margin', margin)]
          for r, margin in itertools.product(SPATIAL_RULES, [0., .5, 1.])]


def spatial_features(used, hits):
    used, hits = np.asarray(used), np.asarray(hits)
    # Five matching probes and >=75% agreement in a tile: score >=0.5.
    supported = (hits >= 5) & (2 * hits - used >= .5 * used)
    grid = supported.reshape(4, 4)
    xs, ys = np.flatnonzero(grid.any(axis=0)), np.flatnonzero(grid.any(axis=1))
    return {'bins': int(supported.sum()),
            'x_span': int(xs[-1] - xs[0] + 1) if len(xs) else 0,
            'y_span': int(ys[-1] - ys[0] + 1) if len(ys) else 0,
            'both_sides': int(grid[:, :2].any() and grid[:, 2:].any()), 'never': 0}


def choose(by_source, held_out):
    train = [v for n, v in by_source.items() if n != held_out]
    eligible = [i for i in range(len(RULES)) if all(
        v['false_positives'][i] == v['wrong_rows'][i] == v['lost_correct'][i] == 0
        for v in train)]
    return min(eligible, key=lambda i: (-sum(v['correct'][i] for v in train), len(RULES[i]), i))


def extraction_signature(name, manifest):
    native = ROOT / 'fire-detection/core/target/release/examples/pov_gui_spatial.exe'
    source = ROOT / 'fire-detection/core/src/overlay.rs'
    assets = [ROOT / 'fire-detection/data/assets/fire_1.rgba',
              *sorted((ROOT / 'fire-detection/data/assets/gui').glob('*rgba'))]
    return {'native_sha256': sha(native), 'source_sha256': sha(source),
            'frames_sha256': sha(manifest),
            'parent_meta_sha256': sha(CACHE / f'{name}.meta.json'),
            'assets': {str(p.relative_to(ROOT)): sha(p) for p in assets}}


def run_source(name):
    previous = np.load(OUT / f'{name}.npz')
    frames, truth, rows = (previous[k] for k in ['frames', 'truth', 'rows'])
    opaque = previous['opaque']
    extra = (previous['visible_evidence'] >= .5) & ~opaque
    ids = np.sort(frames[extra])
    manifest = OUT / f'{name}-frames.txt'
    manifest.write_text('\n'.join(map(str, ids)))
    meta = json.loads((CACHE / f'{name}.meta.json').read_text())
    native = ROOT / 'fire-detection/core/target/release/examples/pov_gui_spatial.exe'
    cache = OUT / f'{name}-spatial.jsonl'
    cache_meta = cache.with_suffix('.meta.json')
    signature = extraction_signature(name, manifest)
    if len(ids):
        if not (cache.exists() and cache_meta.exists()
                and json.loads(cache_meta.read_text()) == signature):
            subprocess.run([str(native), meta['video'], str(cache), '1920', '1080',
                            str(manifest), str(len(ids)),
                            str(ROOT / 'FireCrackle/src-tauri/runtime/ffmpeg.exe')], check=True)
            cache_meta.write_text(json.dumps(signature, indent=2))
        observations = [json.loads(line) for line in cache.open()]
    else:
        observations = []
    # Workers finish asynchronously. Join by unique frame ID, never output order.
    assert sorted(r['n'] for r in observations) == ids.tolist()
    id_set = set(ids.tolist())
    old = {r['n']: r for r in map(json.loads, (CACHE / f'{name}.jsonl').open()) if r['n'] in id_set}
    data = {}
    for r in observations:
        # Added diagnostics may change source hashes, but must reproduce all old
        # canonical components and mask decisions for every sparse candidate.
        assert r['reliable'] == old[r['n']]['reliable'] and r['veiled'] == old[r['n']]['veiled']
        for new, ref in zip(r['stats'], old[r['n']]['stats']):
            for k in ['sz', 'cz', 'sum', 'used', 'total', 'weight']:
                assert np.allclose(new[k], ref[k], atol=1e-10, rtol=0), (name, r['n'], k)
        f = features(r)
        base_fovs = [np.argmax(np.array(s['sz']) + s['weight'] * np.array(s['cz'])) for s in r['stats'][:2]]
        evs = [s['sum'][row] / s['used'][row] if s['used'][row] >= 5 else 0
               for s, row in zip(r['stats'][:2], base_fovs)]
        broad = r['stats'][6 + int(evs[1] > evs[0])]
        f.update(spatial_features(broad['used_grid'][f['row']], broad['hit_grid'][f['row']]))
        data[r['n']] = f
    accepted = np.repeat(opaque[:, None], len(RULES), axis=1)
    for j, n in enumerate(frames):
        if n not in data:
            continue
        f = data[n]
        assert f['row'] == rows[j]
        for i, rule in enumerate(RULES):
            accepted[j, i] |= all(f[k] >= threshold for k, threshold in rule)
    np.savez_compressed(OUT / f'{name}-spatial-predictions.npz', frames=frames,
                        rows=rows, truth=truth, accepted=accepted)
    (OUT / f'{name}-spatial-features.json').write_text(json.dumps(data))
    print(f'{name}: {len(ids)} label-blind extra candidates; canonical parity passed', flush=True)
    return metrics(truth, rows, accepted, previous['base'])


def main():
    sources = {name: run_source(name) for name in SOURCES}
    pooled = {k: np.sum([m[k] for m in sources.values()], axis=0).tolist()
              for k in next(iter(sources.values()))}
    selected = choose({'pooled': pooled}, None)
    folds = [{'held_out': n, 'rule_id': (i := choose(sources, n)), 'rule': RULES[i],
              'test': {k: v[i] for k, v in m.items()}} for n, m in sources.items()]
    files = [Path(__file__), ROOT / 'fire-detection/core/src/overlay.rs',
             ROOT / 'fire-detection/core/examples/pov_gui_spatial.rs']
    result = {'rules': RULES, 'sources': sources, 'pooled': pooled,
              'pooled_selected': selected, 'folds': folds,
              'hashes': {str(p.relative_to(ROOT)): sha(p) for p in files},
              'parent_report_sha256': sha(OUT / 'report.json')}
    (OUT / 'spatial-report.json').write_text(json.dumps(result, indent=2))
    print(json.dumps({'rules': len(RULES), 'selected': RULES[selected],
                      'pooled': {k: v[selected] for k, v in pooled.items()}, 'folds': folds}), flush=True)


if __name__ == '__main__':
    main()
