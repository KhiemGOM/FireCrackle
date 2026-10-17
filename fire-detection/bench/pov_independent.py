"""Frozen first-person evaluation on separate, exactly synchronized recordings."""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import subprocess
import time

from pov_dual_veil import combine, decision
from pov_gui_ablation import ROOT, truth_for

OUT = ROOT / '.board/pov-independent-20261018'
SOURCES = {
    'early': '2026-10-15 14-15-51.mkv',
    'later': '2026-10-17 17-04-31.mkv',
}
LABELS = {'early': 'labels-20261015-140934.jsonl', 'later': 'labels-20261017-170335.jsonl'}
STRIDE = 5


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def read_truth(path):
    truth = {}
    excluded = Counter()
    count = 0
    for line in path.read_text(encoding='utf8').splitlines():
        r = json.loads(line)
        if r['n'] != count:
            raise ValueError('Joined frames must be contiguous from zero')
        count += 1
        if not r.get('tick_ok'):
            excluded['invalid_tick'] += 1
            continue
        lab = r.get('label')
        if not isinstance(lab, dict) or not isinstance(lab.get('fire'), bool):
            excluded['missing_label'] += 1
            continue
        overlays = [f for f in lab.get('fires', []) if f.get('src') == 'overlay']
        if len(overlays) > 1:
            raise ValueError('Multiple overlay truth sources')
        row = None
        if overlays:
            parts = overlays[0].get('parts', [])
            row = parts[0].get('row') if parts else None
            if type(row) is not int or not 0 <= row < 32:
                excluded['missing_overlay_row'] += 1
                continue
        truth[r['n']] = {'row': row, 'render_frame': r['f']}
    return truth, count, dict(excluded)


def predict(r, method):
    if method == 'shipped':
        m = r['modes'][int(r['auto'])]
        f = m['fovs'][m['fov']]
        return f['row'], math.isfinite(f['raw']) and f['raw'] >= .5
    if method != 'expanded':
        raise ValueError('Unknown method')
    return combine([decision(m) for m in r['screen_modes']], r['auto'],
                   abs(r['share'] - r['threshold']) <= .03 + 1e-12,
                   'max_evidence')


def summarize(cases):
    positive = sum(c['truth'] is not None for c in cases)
    negative = len(cases) - positive
    accepted = [c for c in cases if c['accepted']]
    good = sum(c['truth'] is not None and c['row'] == c['truth'] for c in accepted)
    fp = [c['frame'] for c in accepted if c['truth'] is None]
    wrong = [c['frame'] for c in accepted if c['truth'] is not None and c['row'] != c['truth']]
    return {
        'frames': len(cases), 'positive': positive, 'negative': negative,
        'accepted': len(accepted), 'correct': good,
        'false_positives': len(fp), 'wrong_rows': len(wrong),
        'positive_abstentions': sum(c['truth'] is not None and not c['accepted'] for c in cases),
        'correct_row_coverage': good / positive if positive else None,
        'accepted_label_precision': good / len(accepted) if accepted else None,
        'false_positive_rate': len(fp) / negative if negative else None,
        'false_positive_frames': fp, 'wrong_row_frames': wrong,
    }


def evaluate(records, truth, method):
    seen = set()
    cases = []
    for r in sorted(records, key=lambda r: r['n']):
        n = r['n']
        if n in seen:
            raise ValueError('Duplicate prediction frame')
        seen.add(n)
        if n not in truth:
            continue
        row, accepted = predict(r, method)
        cases.append({'frame': n, 'render_frame': truth[n]['render_frame'],
                      'truth': truth[n]['row'], 'row': row, 'accepted': accepted})
    unique = {}
    for c in cases:
        unique.setdefault(c['render_frame'], c)
    return {'sampled': summarize(cases), 'unique_render_frames': summarize(list(unique.values()))}


def pool_metrics(items):
    counts = ('frames', 'positive', 'negative', 'accepted', 'correct',
              'false_positives', 'wrong_rows', 'positive_abstentions')
    result = {key: sum(item[key] for item in items) for key in counts}
    result.update({
        'correct_row_coverage': result['correct'] / result['positive'] if result['positive'] else None,
        'accepted_label_precision': result['correct'] / result['accepted'] if result['accepted'] else None,
        'false_positive_rate': result['false_positives'] / result['negative'] if result['negative'] else None,
    })
    return result


def development():
    """Score the same frozen methods on their earlier development recordings."""
    results = {}
    for name in ('clip1', 'clip2', 'quad1', 'survival1'):
        path = ROOT / '.board/pov-dual-veil-v2' / f'{name}.jsonl'
        original, _, _ = truth_for(name)
        truth = {n: {'row': t['truth'], 'render_frame': n} for n, t in original.items()}
        records = [json.loads(line) for line in path.read_text().splitlines()]
        results[name] = {'predictions_sha256': sha(path),
                         **{m: evaluate(records, truth, m)['sampled'] for m in ('shipped', 'expanded')}}
    return results


def capture(name):
    video = ROOT / 'fire-detection/data/video' / SOURCES[name]
    joined = OUT / f'{name}.joined.jsonl'
    _, count, _ = read_truth(joined)
    samples = (count + STRIDE - 1) // STRIDE
    binary = ROOT / 'fire-detection/core/target/release/examples/pov_dual_veil.exe'
    # The earlier completed run fixes the entire inference source/asset set.
    frozen = json.loads((ROOT / '.board/pov-dual-veil-v2/clip1.meta.json').read_text())['signature']
    assert sha(binary) == frozen['native_sha256'], 'Native matcher changed after freeze'
    for file, expected in frozen['source_asset_hashes'].items():
        assert sha(ROOT / file) == expected, f'Frozen input changed: {file}'
    signature = {'native_sha256': sha(binary), 'source_asset_hashes': frozen['source_asset_hashes'],
                 'video_sha256': sha(video), 'joined_sha256': sha(joined),
                 'capture_labels': LABELS[name],
                 'capture_labels_sha256': sha(ROOT / 'fire-detection/mod/run/firelabel' / LABELS[name]),
                 'stride': STRIDE, 'samples': samples, 'total_frames': count}
    path = OUT / f'{name}.predictions.jsonl'
    meta = OUT / f'{name}.meta.json'
    if path.exists() and meta.exists():
        assert json.loads(meta.read_text())['signature'] == signature, 'Stale independent cache'
        return path
    start = time.perf_counter()
    subprocess.run([str(binary), str(video), str(path), '1920', '1080', str(STRIDE),
                    str(samples), str(ROOT / 'FireCrackle/src-tauri/runtime/ffmpeg.exe')], check=True)
    records = [json.loads(line) for line in path.open()]
    assert sorted(r['n'] for r in records) == list(range(0, count, STRIDE))
    meta.write_text(json.dumps({'signature': signature, 'seconds': time.perf_counter() - start}, indent=2))
    return path


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--sources', nargs='+', choices=list(SOURCES), default=list(SOURCES))
    ap.add_argument('--reuse', action='store_true')
    args = ap.parse_args()
    report = {'analysis_sha256': sha(Path(__file__)), 'sources': {}}
    for name in args.sources:
        path = OUT / f'{name}.predictions.jsonl' if args.reuse else capture(name)
        truth, count, excluded = read_truth(OUT / f'{name}.joined.jsonl')
        records = [json.loads(line) for line in path.open()]
        assert sorted(r['n'] for r in records) == list(range(0, count, STRIDE))
        metadata = json.loads((OUT / f'{name}.meta.json').read_text())
        assert metadata['signature']['joined_sha256'] == sha(OUT / f'{name}.joined.jsonl')
        source = {'video': SOURCES[name], 'total_frames': count, 'excluded_truth': excluded,
                  'metadata': metadata, 'predictions_sha256': sha(path),
                  **{m: evaluate(records, truth, m) for m in ('shipped', 'expanded')}}
        report['sources'][name] = source
        print(json.dumps({'source': name, **{m: source[m] for m in ('shipped', 'expanded')}}), flush=True)
    suffix = '' if len(args.sources) == len(SOURCES) else '-' + '-'.join(args.sources)
    if not suffix:
        dev = development()
        report['development_sources'] = dev
        report['separate_recordings'] = {
            m: {group: pool_metrics([s[m][group] for s in report['sources'].values()])
                for group in ('sampled', 'unique_render_frames')}
            for m in ('shipped', 'expanded')}
        report['development'] = {m: pool_metrics([s[m] for s in dev.values()])
                                 for m in ('shipped', 'expanded')}
        report['combined'] = {m: pool_metrics([report['development'][m],
                                             report['separate_recordings'][m]['sampled']])
                              for m in ('shipped', 'expanded')}
    (OUT / f'report{suffix}.json').write_text(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
