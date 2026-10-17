"""Frozen, deterministic multiscale ablation on canonical-unveil pixel caches.

Calibrate and evaluate are deliberately separate invocations. No pixel decoding
or GUI oracle is claimed here; `nohud` is the existing rectangular proxy only.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCALES = (24, 48, 96)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def aggregate(values, mode):
    if not values or any(v is None or not math.isfinite(v) or v < 0 for v in values):
        return None
    return {'min': min, 'max': max, 'mean': lambda x: sum(x) / len(x)}[mode](values)


def score(row, spec, normalization):
    values = []
    for field in spec['fields']:
        value = row['scores'].get(field)
        divisor = normalization[field]
        if value is None or not math.isfinite(value) or divisor <= 0:
            return None
        values.append(value / divisor)
    return aggregate(values, spec['aggregate'])


def specifications():
    result = {}
    for scope in ('all', 'nohud'):
        for family in ('local', 'texture', 'both'):
            fields = [f'{scope}:{kind}{size}' for kind in
                      (('local', 'texture') if family == 'both' else (family,))
                      for size in SCALES]
            for mode in ('min', 'mean', 'max'):
                result[f'{scope}:{family}:{mode}'] = {'fields': fields, 'aggregate': mode}
    return result


def calibrate(rows):
    fire = [r for r in rows if r['truth']['substantial']]
    if not fire:
        raise ValueError('Calibration requires meaningful-fire examples')
    fields = {field for spec in specifications().values() for field in spec['fields']}
    normalization = {field: min(r['scores'][field] for r in fire) for field in sorted(fields)}
    if any(v <= 0 for v in normalization.values()):
        raise ValueError('Zero fire minimum: cannot normalize this evidence safely')
    rules = {}
    for name, spec in specifications().items():
        floor = min(score(r, spec, normalization) for r in fire)
        rules[name] = {**spec, 'threshold': .8 * floor}
    return {'calibration_source': 'clip2', 'normalization': normalization,
            'rules': rules, 'primary': 'all:both:max',
            'safety_fraction': .8, 'clear_comparison': 'strictly less than threshold',
            'policy': 'Width24 horizontal visible-box proxy; no height cutoff',
            'selection': 'All 18 min/mean/max ablations specified before evaluation; primary max across all six full-frame scores. No evaluation-selected winner.'}


def counts(rows, predicate):
    tp = fp = 0
    for row in rows:
        if predicate(row):
            if row['truth']['substantial']:
                fp += 1
            else:
                tp += 1
    eligible = sum(not r['truth']['substantial'] for r in rows)
    fire = len(rows) - eligible
    return {'TP': tp, 'FP': fp, 'clear_eligible': eligible, 'fire': fire,
            'clear_recall': tp / eligible if eligible else None,
            'fire_false_clear_rate': fp / fire if fire else None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=('calibrate', 'evaluate'))
    parser.add_argument('--cache', type=Path, default=ROOT / '.board/no-fire-orange/shared-auto')
    parser.add_argument('--out', type=Path, default=ROOT / '.board/no-fire-parallel/multiscale')
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    protocol = json.loads((args.cache / 'protocol.json').read_text())
    if protocol['shared_veil_sha256'] != sha(ROOT / 'fire-detection/core/src/veil.rs'):
        raise ValueError('Stale shared unveil pixel cache; rerun preprocessing')
    config_path = args.out / 'frozen-config.json'
    if args.phase == 'calibrate':
        path = args.cache / 'clip2.json'
        rows = json.loads(path.read_text())
        config = calibrate(rows)
        config['calibration_sha256'] = sha(path)
        config['script_sha256'] = sha(Path(__file__))
        config['shared_veil_sha256'] = protocol['shared_veil_sha256']
        config['calibration_frames'] = len(rows)
        config_path.write_text(json.dumps(config, indent=2))
        print(json.dumps(config, indent=2))
        return
    config = json.loads(config_path.read_text())
    if config['script_sha256'] != sha(Path(__file__)):
        raise ValueError('Code changed after freezing calibration')
    rows = []
    hashes = {'clip2': config['calibration_sha256']}
    for name in ('clip1', 'quad1', 'survival1'):
        path = args.cache / f'{name}.json'
        hashes[name] = sha(path)
        rows.extend(json.loads(path.read_text()))
    def clears(row, spec):
        value = score(row, spec, config['normalization'])
        return value is not None and value < spec['threshold']
    results = {name: counts(rows, lambda r: clears(r, spec)) for name, spec in config['rules'].items()}
    frozen = json.loads((args.cache / 'frozen-thresholds.json').read_text())
    local = lambda r: r['scores']['all:local24'] < frozen['all:local24']
    texture = lambda r: r['scores']['nohud:texture96'] < frozen['nohud:texture96']
    # Reproduce the previous exploratory 46-clear union without changing it.
    baseline_cache = ROOT / '.board/no-fire-orange/shared-baseline'
    baseline_config_path = ROOT / '.board/no-fire-width24/frozen-config.json'
    baseline_config = json.loads(baseline_config_path.read_text())
    from blob_calibration import clear, scores
    baseline = {}
    for name in ('clip1', 'quad1', 'survival1'):
        path = baseline_cache / f'{name}.json'
        hashes[f'baseline:{name}'] = sha(path)
        for row in json.loads(path.read_text()):
            baseline[name, row['frame']] = clear(scores(row['evidence']), baseline_config)
    old = lambda r: local(r) or texture(r) or baseline[r['source'], r['frame']]
    comparisons = {'local24_frozen': counts(rows, local), 'previous_exploratory_union': counts(rows, old)}
    errors = {name: [{'source': r['source'], 'frame': r['frame']} for r in rows
                    if r['truth']['substantial'] and clears(r, spec)] for name, spec in config['rules'].items()}
    report = {'config': config, 'cache_sha256': hashes, 'frozen_config_sha256': sha(config_path),
              'baseline_config_sha256': sha(baseline_config_path), 'evaluation': results,
              'comparisons': comparisons, 'false_clears': errors,
              'new_clears_beyond_old_union': {name: counts(rows, lambda r: clears(r, spec) and not old(r)) for name, spec in config['rules'].items()},
              'decode': 'Reuse hashed canonical-unveil stride90 pixel evidence; no new video decoding.',
              'gui': 'nohud is rectangular exclusion proxy, NOT oracle GUI masking. All real fire retained as truth.',
              'limits': 'Familiar correlated recordings; 18 ablations, primary predeclared. Zero observed FP is not a guarantee. No deployment or app labels changed.'}
    (args.out / 'report.json').write_text(json.dumps(report, indent=2))
    print(json.dumps({'evaluation': results, 'comparisons': comparisons}, indent=2))


if __name__ == '__main__':
    main()
