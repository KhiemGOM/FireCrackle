"""Deterministic nearby-orange-fragment no-fire experiment.

Clip2 calibrates strict low-score thresholds at zero calibration false clears.
Only then are three evaluation recordings decoded concurrently. GUI rectangles
are a diagnostic proxy, never an oracle; real fire truth is never masked out.
"""
import argparse
import hashlib
import json
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from blob_pilot import truth_rows
from blob_calibration import meaningful
from colour_support import frames
from temporal_presence import calibrate, metrics

FIELDS = ['r0', 'r1', 'r2', 'r4']
EVALUATION = ['clip1', 'quad1', 'survival1']


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def scores(evidence):
    return {f'{scope}:{field}': max(evidence[a][field], evidence[b][field])
            for scope, a, b in [('all', 'raw', 'auto'), ('nohud', 'raw_nohud', 'auto_nohud')]
            for field in FIELDS}


def decode(name, args, binary):
    truth = truth_rows(name, args.stride, 0)
    rows = []
    start = time.time()
    helper = subprocess.Popen([str(binary.resolve()), '1920', '1080'],
                              stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    try:
        for n, rgb in frames(name, args.stride, args.threads):
            if n not in truth:
                continue
            truth[n]['substantial'] = meaningful(truth[n]['boxes'], 24)
            helper.stdin.write(rgb.tobytes())
            helper.stdin.flush()
            answer = helper.stdout.readline()
            if not answer:
                raise RuntimeError('Fragment helper exited')
            evidence = json.loads(answer)
            rows.append({'source': name, 'frame': n, 'truth': truth[n],
                         'evidence': evidence, 'scores': scores(evidence)})
            if len(rows) % 100 == 0:
                print(json.dumps({'source': name, 'frames': len(rows),
                                  'seconds': round(time.time()-start)}), flush=True)
        (args.out / f'{name}.json').write_text(json.dumps(rows))
    finally:
        helper.stdin.close()
        helper.stdout.close()
        if helper.wait() != 0:
            raise RuntimeError('Fragment helper failed')
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('out', type=Path)
    ap.add_argument('--stride', type=int, default=90)
    ap.add_argument('--threads', type=int, default=2)
    ap.add_argument('--reuse-calibration', action='store_true')
    args = ap.parse_args()
    if args.stride < 1 or args.threads < 1:
        ap.error('Stride and threads must be positive')
    args.out.mkdir(parents=True, exist_ok=True)
    source = Path(__file__).with_name('fragment_rules.rs')
    binary = args.out / 'fragment_rules.exe'
    previous = json.loads((args.out / 'protocol.json').read_text()) if args.reuse_calibration else None
    shared = source.parents[2] / 'core/src/veil.rs'
    if previous and (previous['rust_sha256'] != digest(source) or
                     previous['shared_veil_sha256'] != digest(shared) or previous['stride'] != args.stride):
        raise ValueError('Calibration cache preprocessing provenance mismatch')
    protocol = {
        'objective': 'Positive=clear no-fire/negligible; FP=meaningful fire wrongly cleared.',
        'native_resolution': [1920, 1080], 'stride': args.stride,
        'meaningful_fire': 'visible horizontal box width >=24 native pixels; no height cutoff',
        'calibration': 'clip2', 'evaluation': EVALUATION,
        'threshold_policy': 'each variant strict score<threshold; maximal0FP threshold on clip2; freeze before evaluation',
        'primary': 'all:r1',
        'orange_rule': 'R>=64;0.23R<=G<=0.88R;B<=0.5R;R-B>=24; white never contributes',
        'fragment_rule': 'square dilation radii0/1/2/4 then8-connected components; area counts ONLY original orange pixels; gap<=2r merges',
        'preprocessing': 'canonical Rust veil.rs auto; evidence max(raw,auto); top12rows excluded consistently with baseline',
        'gui': 'fixed rectangles centre50%bottom12%,right15%top18% are diagnostic proxy, NOT oracle; truth unchanged',
        'evaluation_concurrency': 3, 'decoder_threads_each': args.threads,
        'rust_sha256': digest(source), 'shared_veil_sha256': digest(shared),
        'python_sha256': digest(Path(__file__)),
        'calibration_cache_sha256': digest(args.out/'clip2.json') if previous else None,
        'fresh_evaluation_decode': True,
        'limitations': 'familiar recordings; full-duration stride sampling, not blind validation or every-frame deployment',
    }
    (args.out/'protocol.json').write_text(json.dumps(protocol, indent=2))
    subprocess.run(['rustc', '--edition', '2021', '-O', str(source), '-o', str(binary)], check=True)
    data = {'clip2': json.loads((args.out/'clip2.json').read_text()) if previous else decode('clip2', args, binary)}
    thresholds = {key: calibrate(data['clip2'], key, 0) for key in data['clip2'][0]['scores']}
    (args.out/'frozen-thresholds.json').write_text(json.dumps(thresholds, indent=2))
    with ThreadPoolExecutor(max_workers=3) as pool:
        jobs = {pool.submit(decode, name, args, binary): name for name in EVALUATION}
        for job in as_completed(jobs):
            name = jobs[job]
            data[name] = job.result()
            print(json.dumps({'completed': name, 'frames': len(data[name])}), flush=True)
    evaluation = sum((data[name] for name in EVALUATION), [])
    report = {'protocol': protocol, 'thresholds': thresholds,
              'sources': {name: {'frames': len(rows), 'meaningful_fire': sum(r['truth']['substantial'] for r in rows),
                                 'variants': {key: metrics(rows, key, t) for key, t in thresholds.items()}}
                          for name, rows in data.items()},
              'evaluation': {key: metrics(evaluation, key, t) for key, t in thresholds.items()},
              'false_clears': {key: [{'source': r['source'], 'frame': r['frame'], 'boxes': r['truth']['boxes']}
                                     for r in evaluation if r['truth']['substantial'] and r['scores'][key] < t]
                               for key, t in thresholds.items()}}
    (args.out/'report.json').write_text(json.dumps(report, indent=2))
    print(json.dumps({'evaluation': report['evaluation']}), flush=True)


if __name__ == '__main__':
    main()
