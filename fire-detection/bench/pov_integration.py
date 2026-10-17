"""Check production decisions against frozen research predictions, without fitting."""
import argparse
import json
from pathlib import Path
import statistics
import subprocess
import time

from pov_gui_ablation import ROOT, SOURCES as DEV, truth_for
from pov_independent import OUT as SEPARATE, SOURCES as EXTRA, STRIDE, predict, read_truth, sha, summarize

OUT = ROOT / '.board/pov-integration'
VIDEOS = {**DEV, **EXTRA}


def ordered_records(records, expected):
    indices = [r['n'] for r in records]
    assert len(set(indices)) == len(indices), 'Duplicate production frame'
    assert sorted(indices) == sorted(expected), 'Incomplete production output'
    return sorted(records, key=lambda r: r['n'])


def inputs(name):
    if name in DEV:
        ref = ROOT / '.board/pov-dual-veil-v2' / f'{name}.jsonl'
        labels, _, _ = truth_for(name)
        truth = {n: x['truth'] for n, x in labels.items()}
        stride = 5 if name in ('clip1', 'clip2') else 30
        expected_hash = json.loads((ref.parent / 'report.json').read_text())['cache_hashes'][name]
    else:
        ref = SEPARATE / f'{name}.predictions.jsonl'
        labels, _, _ = read_truth(SEPARATE / f'{name}.joined.jsonl')
        truth = {n: x['row'] for n, x in labels.items()}
        stride = STRIDE
        expected_hash = json.loads((SEPARATE / 'report.json').read_text())['sources'][name]['predictions_sha256']
    assert sha(ref) == expected_hash, 'Frozen reference changed'
    frozen = [json.loads(line) for line in ref.read_text().splitlines()]
    expected = {r['n']: (row if accepted else None)
                for r in frozen for row, accepted in [predict(r, 'expanded')]}
    return ref, truth, stride, expected


def run(name, folder, reuse):
    ref, truth, stride, expected = inputs(name)
    binary = ROOT / 'fire-detection/core/target/release/examples/pov_scan.exe'
    video = ROOT / 'fire-detection/data/video' / VIDEOS[name]
    files = [ROOT / f'fire-detection/core/src/{x}.rs'
             for x in ('pov', 'overlay', 'gui_mask', 'gui_screens', 'veil', 'video')]
    files += [ROOT / 'fire-detection/core/examples/pov_scan.rs',
              ROOT / 'fire-detection/data/assets/fire_1.rgba',
              *sorted((ROOT / 'fire-detection/data/assets/gui').glob('*.rgba'))]
    signature = {'native_sha256': sha(binary), 'sources_assets': {str(p.relative_to(ROOT)): sha(p) for p in files},
                 'video_sha256': sha(video), 'reference_sha256': sha(ref),
                 'stride': stride, 'count': len(expected), 'workers': 4}
    path = folder / f'{name}.jsonl'
    meta = folder / f'{name}.meta.json'
    if reuse:
        metadata = json.loads(meta.read_text())
        assert metadata['signature'] == signature, 'Changed inputs; use a new capture tag'
        assert metadata['output_sha256'] == sha(path), 'Production cache changed'
    else:
        assert not path.exists() and not meta.exists(), 'Use --reuse or a new tag; preserve captures'
        started = time.perf_counter()
        with (folder / f'{name}.log').open('w') as log:
            subprocess.run([str(binary), str(video), str(path), '1920', '1080', str(stride),
                            str(len(expected)), str(ROOT / 'FireCrackle/src-tauri/runtime/ffmpeg.exe'),
                            'new', '4'], stderr=log, check=True)
        metadata = {'signature': signature, 'seconds': time.perf_counter() - started, 'output_sha256': sha(path)}
        meta.write_text(json.dumps(metadata, indent=2))
    records = ordered_records([json.loads(line) for line in path.read_text().splitlines()], expected)
    differences = [r['n'] for r in records if r['row'] != expected[r['n']]]
    cases = [{'frame': r['n'], 'truth': truth[r['n']], 'row': r['row'], 'accepted': r['row'] is not None}
             for r in records if r['n'] in truth]
    result = {'parity_frames': len(records), 'differences': differences,
              'metrics': summarize(cases), 'seconds': metadata['seconds'],
              'gui_frames': sum(r['gui'] for r in records), 'dual_frames': sum(r['dual'] for r in records),
              'mean_worker_ms': statistics.mean(r['ms'] for r in records),
              'output_sha256': sha(path), 'metadata': metadata}
    print(json.dumps({'source': name, **{k: v for k, v in result.items() if k != 'metadata'}}), flush=True)
    assert not differences, (name, 'Production decisions differ from frozen method', differences[:30])
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--sources', nargs='+', choices=list(VIDEOS), default=list(VIDEOS))
    p.add_argument('--tag', required=True)
    p.add_argument('--reuse', action='store_true')
    args = p.parse_args()
    if Path(args.tag).name != args.tag or args.tag in ('.', '..'):
        p.error('tag must be one folder name')
    folder = OUT / args.tag
    folder.mkdir(parents=True, exist_ok=True)
    report = {'analysis_sha256': sha(Path(__file__)),
              'sources': {name: run(name, folder, args.reuse) for name in args.sources}}
    suffix = '' if len(args.sources) == len(VIDEOS) else '-' + '-'.join(args.sources)
    (folder / f'report{suffix}.json').write_text(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
