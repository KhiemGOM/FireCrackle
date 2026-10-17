"""Frozen four-arm GUI/ownership ablation; assert unchanged control predictions."""
import hashlib
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[4]
OUT = ROOT / '.board/gui-occlusion-eval'
BENCH = ROOT / '.board/occlusion-all-videos'
METHODS = ['colour', 'pairs4', 'facing1', 'facing4', 'jitter_max_pairs1', 'jitter_max_pairs4']
ARMS = ['', '_mask', '_gui', '_both']


def main():
    protocol = json.loads((OUT / 'protocol.json').read_text())
    for key, file in [('canonical_gui_sha256', 'fire-detection/core/src/gui_mask.rs'),
                      ('canonical_veil_sha256', 'fire-detection/core/src/veil.rs'),
                      ('batch_sha256', 'FireCrackle/scripts/fire-ai/gui_occlusion_eval/batch.rs')]:
        assert hashlib.sha256((ROOT / file).read_bytes()).hexdigest() == protocol[key], key
    results = {}
    table = ['| Video | Quad | Cases | Baseline | Learned only | GUI only | Both |',
             '|---|---|---:|---:|---:|---:|---:|']
    detail = ['| Video | Quad | Method | Baseline | Learned only | GUI only | Both |',
              '|---|---|---|---:|---:|---:|---:|']
    pooled = {'exact': [0] * 4, 'rough': [0] * 4}
    for video in ['quad1', 'survival1', 'new_recording']:
        for mode in ['exact', 'rough']:
            suffix = mode + '-score/results.json'
            result = json.loads((OUT / video / suffix).read_text())
            old = json.loads((BENCH / video / suffix).read_text())
            assert result['hashes'] == old['hashes']
            assert result['boundary_sha256'] == old['boundary_sha256']
            assert len(result['rows']) == len(old['rows'])
            for a, b in zip(result['rows'], old['rows']):
                assert (a['id'], a['frame'], a['quad'], a['expected']) == (b['id'], b['frame'], b['quad'], b['expected'])
                for method in METHODS:
                    for arm in ['', '_mask']:
                        assert a['methods'][method + arm] == b['methods'][method + arm], (video, mode, a['id'], method, arm)
            changes = {}
            for method in METHODS:
                counts = [result['summary'][method + arm]['top1'] for arm in ARMS]
                comparisons = {}
                for before, after in [('', '_gui'), ('_mask', '_both')]:
                    groups = {}
                    gains, losses = [], []
                    for row in result['rows']:
                        a, b = [row['methods'][method + arm]['correct'] for arm in [before, after]]
                        groups.setdefault(row['frame'], []).append(int(b) - int(a))
                        if b and not a:
                            gains.append(row['id'])
                        if a and not b:
                            losses.append(row['id'])
                    sums = np.array([sum(v) for v in groups.values()])
                    sizes = np.array([len(v) for v in groups.values()])
                    draws = np.random.default_rng(19017).integers(len(sums), size=(5000, len(sums)))
                    ci = np.percentile(100 * sums[draws].sum(1) / sizes[draws].sum(1), [2.5, 97.5]).round(2).tolist()
                    comparisons[before + ' to ' + after] = dict(gains=gains, losses=losses, frame_bootstrap95_delta_pp=ci)
                changes[method] = dict(counts=counts, comparisons=comparisons)
                detail.append(f'| {video} | {mode} | {method} | ' + ' | '.join(map(str, counts)) + ' |')
            method = 'facing4' if mode == 'exact' else 'jitter_max_pairs4'
            counts = changes[method]['counts']
            pooled[mode] = [a + b for a, b in zip(pooled[mode], counts)]
            n = result['n']
            table.append(f'| {video} | {mode} | {n} | ' + ' | '.join(f'{c}/{n} ({100*c/n:.1f}%)' for c in counts) + ' |')
            results[f'{video}/{mode}'] = dict(n=n, frames=len(groups),
                gui_affected_cases=sum(r['guiRemoved'] > 0 for r in result['rows']),
                fire_probes_removed=sum(r['guiRemoved'] for r in result['rows']), methods=changes)
    detections = [line.split('\t') for line in (OUT / 'detection.tsv').read_text().splitlines()]
    ms = np.array([float(row[3]) for row in detections])
    output = dict(results=results, pooled_prior_leaders=pooled,
        prior_leaders='facing4 exact / jitter_max_pairs4 rough: fixed historical research leaders, not selected on this ablation',
        controls='All 10,368 baseline and learned-only case/method results exactly reproduce the previous run, including top five rankings.',
        frames=len(detections), reliable=sum(row[1] == 'true' for row in detections),
        gui_cpu_ms=dict(median=float(np.median(ms)), p95=float(np.percentile(ms, 95))),
        source_hashes={k: protocol[k] for k in ['canonical_gui_sha256', 'canonical_veil_sha256']})
    (OUT / 'summary.json').write_text(json.dumps(output, indent=2))
    (OUT / 'table.md').write_text('\n'.join(table) + '\n')
    (OUT / 'all-methods.md').write_text('\n'.join(detail) + '\n')
    print('\n'.join(table))
    print(json.dumps({k: v for k, v in output.items() if k != 'results'}, indent=2))
    print('Affected cases:', {k: v['gui_affected_cases'] for k, v in results.items()})


if __name__ == '__main__':
    main()
