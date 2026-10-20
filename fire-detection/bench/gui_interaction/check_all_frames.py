"""Frozen deterministic GUI detector, every decoded frame of aligned recordings.

No training/tuning, temporal smoothing, frame skipping, deduplication or supplied
masks. Primary metric is stable inventory.* presence versus closed negatives;
menus/modded screens and unstable transitions are reported separately.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import statistics
import subprocess
import threading
import time

from check_recorded import ROOT, SOURCES


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def runs(rows, predicate):
    groups = []
    for row in rows:
        if not predicate(row):
            continue
        n = row['index']
        if (groups and groups[-1]['last_frame'] + 1 == n
                and groups[-1]['truth'] == row['truth']):
            groups[-1]['last_frame'] = n
            groups[-1]['frames'] += 1
        else:
            groups.append({'first_frame': n, 'last_frame': n, 'frames': 1,
                           'truth': row['truth']})
    for group in groups:
        group['duration_seconds_at_60fps'] = group['frames'] / 60
    return groups


def summarize(rows):
    counts = Counter()
    per_type = {}
    unique = set()
    for r in rows:
        truth = r['truth']
        unique.add(r['renderer_frame'])
        if not r['stable_render_state']:
            category = 'transition_detected' if r['gui_detected'] else 'transition_abstained'
        elif truth.startswith('inventory.'):
            category = 'interaction_detected' if r['gui_detected'] else 'interaction_missed'
        elif truth == 'closed':
            category = 'closed_false_detection' if r['gui_detected'] else 'closed_correct_abstention'
        else:
            category = 'other_detected' if r['gui_detected'] else 'other_abstained'
        counts[category] += 1
        per_type.setdefault(truth, Counter())[category] += 1
    positive = counts['interaction_detected'] + counts['interaction_missed']
    negative = counts['closed_correct_abstention'] + counts['closed_false_detection']
    times = sorted(r['ms'] for r in rows)
    return {
        'decoded_frames': len(rows), 'counts': dict(counts),
        'interaction_recall': counts['interaction_detected'] / positive if positive else None,
        'closed_false_detection_rate': counts['closed_false_detection'] / negative if negative else None,
        'per_type': {k: dict(v) for k, v in sorted(per_type.items())},
        'unique_renderer_ids': len(unique),
        'repeated_renderer_frames_included': len(rows) - len(unique),
        'median_ms': statistics.median(times),
        'p95_ms': times[min(len(times) - 1, int(len(times) * .95))],
        'miss_runs': runs(rows, lambda r: r['stable_render_state']
                          and r['truth'].startswith('inventory.') and not r['gui_detected']),
        'false_detection_runs': runs(rows, lambda r: r['stable_render_state']
                                     and r['truth'] == 'closed' and r['gui_detected']),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    binary = ROOT / 'fire-detection/core/target/release/examples/gui_interaction_frame.exe'
    ffmpeg = ROOT / 'FireCrackle/src-tauri/runtime/ffmpeg.exe'
    frozen = {
        'source': ROOT / 'fire-detection/core/src/gui_interaction.rs',
        'binary': binary, 'asset_manifest': args.assets / 'manifest.json',
        'runner': Path(__file__).resolve(),
    }
    fingerprints = {key: sha(path) for key, path in frozen.items()}
    reports = []
    combined = []
    size = 1920 * 1080 * 3
    for source_index, (filename, joined) in enumerate(SOURCES):
        video = ROOT / 'fire-detection/data/video' / filename
        truth_rows = [json.loads(s) for s in (ROOT / joined).read_text(encoding='utf-8').splitlines()]
        assert [r['video_frame'] for r in truth_rows] == list(range(len(truth_rows)))
        decoder = subprocess.Popen([str(ffmpeg), '-v', 'error', '-i', str(video),
            '-an', '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
            stdout=subprocess.PIPE)
        detector = subprocess.Popen([str(binary), str(args.assets.resolve()), '1920', '1080'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        errors = []

        def transfer():
            try:
                while True:
                    block = decoder.stdout.read(size)
                    if not block:
                        break
                    if len(block) != size:
                        raise RuntimeError('partial decoded RGB frame')
                    detector.stdin.write(block)
            except Exception as error:
                errors.append(repr(error))
            finally:
                detector.stdin.close()

        worker = threading.Thread(target=transfer, daemon=True)
        started = time.monotonic()
        worker.start()
        rows = []
        try:
            with (args.output / f'predictions-{source_index}.jsonl').open('w', encoding='utf-8') as log:
                for line in detector.stdout:
                    r = json.loads(line)
                    index = r['index']
                    if index != len(rows) or index >= len(truth_rows):
                        raise RuntimeError('decoded/aligned frame index mismatch')
                    t = truth_rows[index]
                    r.update({'video': filename, 'truth': t['screen_type'],
                              'renderer_frame': t['renderer_frame'],
                              'stable_render_state': t['stable_render_state']})
                    rows.append(r)
                    log.write(json.dumps(r) + '\n')
                    if (index + 1) % 1000 == 0:
                        log.flush()
                        print(json.dumps({'video': filename, 'processed': index + 1,
                              'total': len(truth_rows), 'elapsed_seconds': round(time.monotonic() - started, 1)}), flush=True)
            worker.join()
            if detector.wait() or decoder.wait() or errors or len(rows) != len(truth_rows):
                raise RuntimeError({'errors': errors, 'decoded': len(rows), 'aligned': len(truth_rows)})
        finally:
            if detector.poll() is None:
                detector.kill()
            if decoder.poll() is None:
                decoder.kill()
        report = summarize(rows)
        report.update({'video': filename, 'video_sha256': sha(video),
                       'aligned_labels_sha256': sha(ROOT / joined),
                       'wall_seconds': time.monotonic() - started})
        reports.append(report)
        # Renderer IDs are session-local; attach recording identity for pooled accounting.
        combined.extend(dict(r, renderer_frame=f'{source_index}:{r["renderer_frame"]}') for r in rows)
        (args.output / f'report-{source_index}.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        print(json.dumps({'completed': filename, 'counts': report['counts'],
                          'recall': report['interaction_recall']}), flush=True)
    assert fingerprints == {key: sha(path) for key, path in frozen.items()}, 'detector/runner/assets changed during run'
    pooled = summarize(combined)
    # Runs must not join two recordings or interpret their local frame indices as global.
    for key in ['miss_runs', 'false_detection_runs']:
        pooled[key] = [dict(run, video=r['video']) for r in reports for run in r[key]]
    final = {'protocol': __doc__, 'preprocessing': 'Native1920x1080 decoded RGB24, every frame, no supplied masks, no temporal smoothing.',
             'frozen_sha256': fingerprints, 'recordings': reports, 'pooled': pooled,
             'limits': 'Two development recordings from one session; correlated frames and repeated renderer frames are included. No independent validation or zero-error guarantee.'}
    (args.output / 'report.json').write_text(json.dumps(final, indent=2), encoding='utf-8')
    inventory = json.loads((ROOT / 'docs/TRAINING_DATA_INVENTORY.json').read_text(encoding='utf-8'))
    coverage = []
    for item in inventory['videos']:
        if item.get('role') != 'original':
            continue
        name = Path(item['path']).name
        checked = next((r for r in reports if r['video'] == name), None)
        coverage.append({'path': item['path'], 'role': 'all_frames_development_check' if checked else 'excluded',
                         'reason': 'Renderer-aligned GUI states' if checked else 'No verified GUI frame-state alignment for this task; fire labels are not GUI truth.',
                         'frames': checked['decoded_frames'] if checked else 0,
                         'video_sha256': checked['video_sha256'] if checked else None})
    (args.output / 'coverage.json').write_text(json.dumps({'not_ai_training': True, 'sources': coverage,
        'frozen_sha256': fingerprints}, indent=2), encoding='utf-8')
    print(json.dumps({'finished': True, 'frames': pooled['decoded_frames'], 'counts': pooled['counts']}), flush=True)


if __name__ == '__main__':
    main()
