"""Frozen normalized ranking/FOV/support combinations; no production changes."""
import hashlib
import itertools
import json
import subprocess
from pathlib import Path

import numpy as np

from pov_gui_stages import ROOT, OUT as CACHE, SOURCES, sha, truth_for
from pov_gui_support import OUT as SUPPORT
from pov_gui_spatial import spatial_features

OUT = ROOT / '.board/pov-gui-integrated'
MODELS = list(itertools.product(range(3), range(2), range(4), range(3)))
COLOURS = ['raw_sum', 'raw_mean', 'mask_sum', 'mask_mean']
COVERAGES = ['opaque', 'opaque_items', 'all_gui']
FOVS = ['original', 'visible', 'selection_margin']
GATES = ['none', 'selection_margin_0.5', 'selection_margin_1', 'selection_margin_2',
         'masked_margin_0.5', 'masked_margin_1', 'original_row_agreement',
         'fov_row_agreement', 'mask_row_agreement', 'margin_0.5_original_agreement',
         'margin_0.5_fov_agreement', 'masked_margin_0.5_mask_agreement',
         'masked_margin_0.5_horizontal_spread', 'masked_margin_0.5_equal_region']
CONFIGS = [{'coverage': COVERAGES[p], 'masked_silhouette': s, 'colour': COLOURS[c],
            'fov': FOVS[f], 'gate': g} for p, s, c, f in MODELS for g in GATES]


def normalized_z(values, valid):
    count = valid.sum(axis=1, keepdims=True)
    mean = np.divide(np.where(valid, values, 0).sum(axis=1, keepdims=True), count,
                     out=np.zeros((len(values), 1)), where=count > 0)
    var = np.divide(np.where(valid, (values - mean) ** 2, 0).sum(axis=1, keepdims=True),
                    count, out=np.zeros_like(mean), where=count > 0)
    sd = np.sqrt(var)
    return np.where(valid, (values - mean) / np.where(sd > 1e-12, sd, 1), -9.)


def proposals(record):
    stats = record['stats']
    sz, cz = (np.array([r[k] for r in stats]) for k in ('sz', 'cz'))
    sums = np.array([r['sum'] for r in stats], dtype=float)
    used = np.array([r['used'] for r in stats])
    visible = np.divide(sums, used, out=np.zeros_like(sums), where=used >= 5)
    mean_z = normalized_z(visible, used >= 5)
    weight = stats[0]['weight']
    canonical = sz + weight * cz
    raw_rows = canonical[:2].argmax(axis=1)
    original_fov = int(visible[1, raw_rows[1]] > visible[0, raw_rows[0]])
    original_row = int(raw_rows[original_fov])
    scores = np.zeros((3, 2, 4, 2, 32))
    for p, s, c in itertools.product(range(3), range(2), range(4)):
        for f in range(2):
            mask = 2 * (p + 1) + f
            ci = mask if c >= 2 else f
            scores[p, s, c, f] = sz[mask if s else f] + weight * (mean_z[ci] if c % 2 else cz[ci])
    rows = scores.argmax(axis=-1)
    margins = np.sort(scores, axis=-1)[..., -1] - np.sort(scores, axis=-1)[..., -2]
    result = {k: [] for k in ('row', 'fov', 'visible', 'selection_margin', 'masked_margin',
                              'original_agreement', 'fov_agreement', 'mask_agreement')}
    for p, s, c, f in MODELS:
        if f == 0:
            chosen = original_fov
        elif f == 1:
            chosen = int(visible[2 * (p + 1) + 1, rows[p, s, c, 1]] >
                         visible[2 * (p + 1), rows[p, s, c, 0]])
        else:
            chosen = int(margins[p, s, c, 1] > margins[p, s, c, 0])
        row = int(rows[p, s, c, chosen])
        mask = 2 * (p + 1) + chosen
        other = np.arange(32) != row
        result['row'].append(row)
        result['fov'].append(chosen)
        result['visible'].append(visible[mask, row])
        result['selection_margin'].append(margins[p, s, c, chosen])
        result['masked_margin'].append(canonical[mask, row] - canonical[mask, other].max())
        result['original_agreement'].append(row == original_row)
        result['fov_agreement'].append(rows[p, s, c, 0] == rows[p, s, c, 1])
        result['mask_agreement'].append(np.all(rows[:, s, c, chosen] == row))
    return {k: np.array(v) for k, v in result.items()}


def equal_region(used, hits):
    used, hits = np.asarray(used), np.asarray(hits)
    usable = used >= 5
    return (float(((2 * hits[usable] - used[usable]) / used[usable]).mean())
            if usable.any() else -1., int(usable.sum()))


def gates(prop, spatial=None):
    a, b = prop['selection_margin'], prop['masked_margin']
    original, fov, masks = (prop[k] for k in ('original_agreement', 'fov_agreement', 'mask_agreement'))
    tests = [np.ones(len(MODELS), dtype=bool), a >= .5, a >= 1, a >= 2,
             b >= .5, b >= 1, original, fov, masks,
             (a >= .5) & original, (a >= .5) & fov, (b >= .5) & masks,
             np.zeros(len(MODELS), dtype=bool), np.zeros(len(MODELS), dtype=bool)]
    if spatial is not None:
        for j, (p, _, _, _) in enumerate(MODELS):
            stat = spatial['stats'][2 * (p + 1) + prop['fov'][j]]
            row = prop['row'][j]
            used, hits = stat['used_grid'][row], stat['hit_grid'][row]
            spread = spatial_features(used, hits)
            region, count = equal_region(used, hits)
            tests[12][j] = b[j] >= .5 and spread['x_span'] >= 2
            tests[13][j] = b[j] >= .5 and count >= 2 and region >= .5
    return np.stack(tests, axis=1) & (prop['visible'] >= .5)[:, None]


def measure(truth, rows, accepted, original_rows, original_accept):
    correct = (truth[:, None] >= 0) & (rows == truth[:, None])
    good = accepted & correct
    basegood = original_accept & (original_rows == truth) & (truth >= 0)
    return {'correct': good.sum(axis=0).tolist(),
            'false_positives': (accepted & (truth[:, None] < 0)).sum(axis=0).tolist(),
            'wrong_rows': (accepted & (truth[:, None] >= 0) & ~correct).sum(axis=0).tolist(),
            'new_correct': (good & ~basegood[:, None]).sum(axis=0).tolist(),
            'lost_correct': (~good & basegood[:, None]).sum(axis=0).tolist()}


def choose(sources, held_out):
    train = [m for n, m in sources.items() if n != held_out]
    eligible = [i for i in range(len(CONFIGS)) if all(
        m['false_positives'][i] == m['wrong_rows'][i] == m['lost_correct'][i] == 0 for m in train)]
    return min(eligible, key=lambda i: (-sum(m['correct'][i] for m in train),
                                      2 if i % len(GATES) >= 9 else int(i % len(GATES) != 0), i))


def spatial_records(name, ids, old):
    """Reuse exact native diagnostics; decode only newly proposed frame IDs."""
    native = ROOT / 'fire-detection/core/target/release/examples/pov_gui_spatial.exe'
    parent_meta = json.loads((CACHE / f'{name}.meta.json').read_text())
    previous = SUPPORT / f'{name}-spatial.jsonl'
    previous_meta = previous.with_suffix('.meta.json')
    records = {}
    if previous.exists():
        meta = json.loads(previous_meta.read_text())
        assert meta['native_sha256'] == sha(native), 'Spatial binary changed; rebuild caches explicitly'
        for path, expected in meta['assets'].items():
            assert sha(ROOT / path) == expected, 'Spatial assets changed'
        records = {r['n']: r for r in map(json.loads, previous.open()) if r['n'] in ids}
    missing = sorted(set(ids) - records.keys())
    manifest = OUT / f'{name}-missing.txt'
    manifest.write_text('\n'.join(map(str, missing)))
    cache = OUT / f'{name}-spatial.jsonl'
    signature = {'native': sha(native), 'manifest': sha(manifest),
                 'parent': sha(CACHE / f'{name}.meta.json'),
                 'assets': {str(p.relative_to(ROOT)): sha(p) for p in
                            [ROOT / 'fire-detection/data/assets/fire_1.rgba',
                             *sorted((ROOT / 'fire-detection/data/assets/gui').glob('*rgba'))]}}
    if missing:
        meta_path = cache.with_suffix('.meta.json')
        if not (cache.exists() and meta_path.exists() and json.loads(meta_path.read_text()) == signature):
            subprocess.run([str(native), parent_meta['video'], str(cache), '1920', '1080',
                            str(manifest), str(len(missing)),
                            str(ROOT / 'FireCrackle/src-tauri/runtime/ffmpeg.exe')], check=True)
            meta_path.write_text(json.dumps(signature, indent=2))
        new = [json.loads(line) for line in cache.open()]
        assert sorted(r['n'] for r in new) == missing
        records.update({r['n']: r for r in new})
    assert set(records) == set(ids)
    for n, record in records.items():
        assert record['reliable'] == old[n]['reliable'] and record['veiled'] == old[n]['veiled']
        for new, ref in zip(record['stats'], old[n]['stats']):
            for k in ('sz', 'cz', 'sum', 'used', 'total', 'weight'):
                assert np.allclose(new[k], ref[k], atol=1e-10, rtol=0), (name, n, k)
    print(f'{name}: {len(ids)} potential additions; {len(missing)} new spatial frames; parity passed', flush=True)
    return records


def run_source(name):
    parent = np.load(SUPPORT / f'{name}.npz')
    frames, truth = parent['frames'], parent['truth']
    current_truth, _, truth_hash = truth_for(name)
    meta = json.loads((CACHE / f'{name}.meta.json').read_text())
    assert meta['truth_sha256'] == truth_hash, 'Joined truth changed; regenerate parent caches'
    assert np.array_equal(truth, np.array([
        -1 if current_truth[int(n)]['truth'] is None else current_truth[int(n)]['truth'] for n in frames]))
    assert Path(meta['video']).stat().st_size == meta['video_bytes']
    assert len(set(frames.tolist())) == len(frames)
    indices = {int(n): j for j, n in enumerate(frames)}
    protected = parent['opaque']
    rows = np.empty((len(frames), len(MODELS), len(GATES)), dtype=np.uint8)
    accepted = np.zeros(rows.shape, dtype=bool)
    extras = {}
    count = 0
    for line in (CACHE / f'{name}.jsonl').open():
        record = json.loads(line)
        n = record['n']
        if n not in indices:
            continue
        count += 1
        j = indices[n]
        prop = proposals(record)
        rows[j] = prop['row'][:, None]
        if protected[j]:
            accepted[j] = True
            rows[j] = parent['rows'][j]
        else:
            accepted[j] = gates(prop)
            if np.any(prop['visible'] >= .5):
                extras[n] = record
    assert count == len(frames)
    spatial = spatial_records(name, set(extras), extras)
    for n, record in extras.items():
        accepted[indices[n]] = gates(proposals(record), spatial[n])
    flat_rows, flat_accept = rows.reshape(len(frames), -1), accepted.reshape(len(frames), -1)
    # Frozen previous spatial rule: original row/FOV, broad mask, same gate.
    anchor = MODELS.index((2, 0, 0, 0)) * len(GATES) + 12
    prior = np.load(SUPPORT / f'{name}-spatial-predictions.npz')
    from pov_gui_spatial import RULES
    k = RULES.index([('x_span', 2), ('mask_margin', .5)])
    assert np.array_equal(prior['frames'], frames)
    assert np.array_equal(flat_accept[:, anchor], prior['accepted'][:, k])
    assert np.array_equal(flat_rows[:, anchor], prior['rows'])
    np.savez_compressed(OUT / f'{name}.npz', frames=frames, truth=truth,
                        rows=flat_rows, accepted=flat_accept)
    return measure(truth, flat_rows, flat_accept, parent['rows'], parent['base'])


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    sources = {name: run_source(name) for name in SOURCES}
    pooled = {k: np.sum([m[k] for m in sources.values()], axis=0).tolist()
              for k in next(iter(sources.values()))}
    selected = choose({'pooled': pooled}, None)
    folds = [{'held_out': n, 'selected': (i := choose(sources, n)), 'config': CONFIGS[i],
              'test': {k: v[i] for k, v in m.items()}} for n, m in sources.items()]
    distinct = [hashlib.sha256() for _ in CONFIGS]
    for name in sources:
        predictions = np.load(OUT / f'{name}.npz')
        rows, accepted = predictions['rows'], predictions['accepted']
        for i, digest in enumerate(distinct):
            digest.update(np.where(accepted[:, i], rows[:, i] + 1, 0).astype('uint8').tobytes())
    report = {'configs': CONFIGS, 'sources': sources, 'pooled': pooled,
              'selected': selected, 'folds': folds, 'analysis_sha256': sha(Path(__file__)),
              'distinct_accepted_label_outputs': len({h.digest() for h in distinct}),
              'parent_cache_hashes': {n: sha(CACHE / f'{n}.meta.json') for n in SOURCES}}
    (OUT / 'report.json').write_text(json.dumps(report, indent=2))
    print(json.dumps({'selected': CONFIGS[selected],
                      'pooled': {k: v[selected] for k, v in pooled.items()}, 'folds': folds}), flush=True)


if __name__ == '__main__':
    main()
