"""Approved real-recording GUI calibration. Requires Windows CPU accounting.

Requires a signed-off plan and frozen all-frame baseline predictions.
Never point this sweep at the independent-session test recording.
"""
import argparse
import os
import hashlib
import subprocess
import ctypes
import json
import threading
import time
from ctypes import wintypes
from collections import Counter
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
EXPECTED_SOURCE = '63e209c7ff711bde736a815576b111417f1aa076fa75ee6aee6ca72f15cd3063'

def file_sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for field in ['plan', 'baseline', 'assets', 'output']:
        parser.add_argument('--' + field, type=Path, required=True)
    parser.add_argument('--build-only', action='store_true')
    args = parser.parse_args()
    if os.name != 'nt':
        parser.error('Windows child-process CPU accounting required.')
    source = ROOT / 'fire-detection/core/src/gui_interaction.rs'
    if hashlib.sha256(source.read_bytes()).hexdigest() != EXPECTED_SOURCE:
        parser.error('Source changed: re-verify the research profiler before use.')
    args.output.mkdir(parents=True, exist_ok=True)
    snapshot = args.output.resolve() / 'production.rs'
    snapshot.write_text('\n'.join((line for line in source.read_text().splitlines() if not line.lstrip().startswith('//!'))), encoding='utf-8')
    core = (ROOT / 'fire-detection/core').as_posix()
    entry = Path(__file__).resolve().with_suffix('.rs').as_posix()
    manifest = args.output.resolve() / 'Cargo.toml'
    manifest.write_text('[package]\nname="gui-calibration"\nversion="0.0.0"\nedition="2021"\n' + '[dependencies]\nfire_core={path="' + core + '"}\n' + '[[bin]]\nname="gui-calibration"\npath="' + entry + '"\n', encoding='utf-8')
    subprocess.run(['cargo', 'build', '--release', '--manifest-path', str(manifest)], env=dict(os.environ, GUI_CALIBRATION_SOURCE=str(snapshot)), check=True)
    if args.build_only:
        return
    root = ROOT
    base = args.output.resolve()
    out = base / 'results'
    out.mkdir(parents=True)
    plan = json.loads(args.plan.resolve().read_text())
    assert plan['status'] == 'approved'
    sources = json.loads((args.baseline.resolve() / 'report.json').read_text())['recordings']
    assert [s['video'] for s in sources] == [s['video'] for s in plan['sources']]
    input_hashes = {}
    for i, (source, approved) in enumerate(zip(sources, plan['sources'])):
        video = root / 'fire-detection/data/video' / source['video']
        assert file_sha(video) == approved['video_sha256']
        predictions = args.baseline.resolve() / f'predictions-{i}.jsonl'
        input_hashes[str(predictions)] = file_sha(predictions)
        with predictions.open(encoding='utf-8') as stream:
            assert sum((1 for _ in stream)) == approved['frames']
    assert file_sha(args.assets / 'manifest.json') == plan['baseline_frozen_sha256']['asset_manifest']
    configs = [{'border': b / 100, 'interior': s / 100, 'regional_margin': m} for b in range(60, 91, 5) for s in range(55, 86, 5) for m in [0.15, 0.3, None]]
    assert configs[144] == {'border': 0.9, 'interior': 0.85, 'regional_margin': 0.15}
    sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
    tracked = [base / 'production.rs', Path(__file__).resolve().with_suffix('.rs'), base / 'target/release/gui-calibration.exe']
    fingerprints = {str(p): sha(p) for p in tracked}
    (out / 'manifest.json').write_text(json.dumps({'approved_plan': plan, 'configs': configs, 'source_hashes': fingerprints, 'baseline_prediction_hashes': input_hashes, 'note': 'All real approved frames, no learned model/synthetic training data. Tooltip proposals use no renderer information.'}, indent=2), encoding='utf-8')

    class FT(ctypes.Structure):
        _fields_ = [('low', wintypes.DWORD), ('high', wintypes.DWORD)]
    gettimes = ctypes.windll.kernel32.GetProcessTimes
    gettimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(FT)] * 4

    def cpu(p):
        a, b, c, d = (FT(), FT(), FT(), FT())
        if not gettimes(wintypes.HANDLE(int(p._handle)), ctypes.byref(a), ctypes.byref(b), ctypes.byref(c), ctypes.byref(d)):
            raise ctypes.WinError()
        return ((c.high << 32) + c.low + (d.high << 32) + d.low) / 10000000.0
    scores = {f: [Counter() for _ in configs] for f in ['plain', 'masked']}
    weight_positive = 0.0
    frames_positive = 0
    frames_closed = 0
    cpu_spent = 0.0
    by_video = []

    def checkpoint(extra={}):
        (out / 'checkpoint.json').write_text(json.dumps({'scores': {f: [dict(s) for s in ss] for f, ss in scores.items()}, 'unique_positive_weight': weight_positive, 'positive_frames': frames_positive, 'closed_frames': frames_closed, 'cpu_seconds': cpu_spent, 'completed_recordings': by_video, **extra}, indent=2), encoding='utf-8')
    for vi, source in enumerate(sources):
        old = [json.loads(s) for s in (args.baseline.resolve() / f'predictions-{vi}.jsonl').read_text().splitlines()]
        multiplicity = Counter((r['renderer_frame'] for r in old))
        decoder = subprocess.Popen([str(root / 'FireCrackle/src-tauri/runtime/ffmpeg.exe'), '-v', 'error', '-i', str(root / 'fire-detection/data/video' / source['video']), '-an', '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], stdout=subprocess.PIPE)
        native = subprocess.Popen([str(base / 'target/release/gui-calibration.exe'), str(args.assets.resolve()), '1920', '1080'], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        errors = []

        def transfer():
            try:
                while (rgb := decoder.stdout.read(1920 * 1080 * 3)):
                    assert len(rgb) == 1920 * 1080 * 3
                    native.stdin.write(rgb)
            except Exception as e:
                errors.append(repr(e))
            finally:
                native.stdin.close()
        worker = threading.Thread(target=transfer, daemon=True)
        worker.start()
        started = time.monotonic()
        count = 0
        tips = Counter()
        video_scores = {f: [Counter() for _ in configs] for f in scores}
        try:
            with (out / f'predictions-{vi}.jsonl').open('w', encoding='utf-8') as stream:
                for line in native.stdout:
                    r = json.loads(line)
                    n = r['index']
                    assert n == count and n < len(old)
                    assert len(r['plain']) == 147 and len(r['masked']) == 147
                    assert (r['plain'][144] == '1') == old[n]['gui_detected'], ('baseline parity', vi, n, r, old[n])
                    truth = old[n]['truth']
                    positive = truth.startswith('inventory.')
                    closed = truth == 'closed'
                    weight = 1 / multiplicity[old[n]['renderer_frame']]
                    if positive:
                        frames_positive += 1
                        weight_positive += weight
                    if closed:
                        frames_closed += 1
                    for family in scores:
                        for i, b in enumerate(r[family]):
                            hit = b == '1'
                            for s in [scores[family][i], video_scores[family][i]]:
                                if positive:
                                    s['tp'] += hit
                                    s['fn'] += not hit
                                    s['weighted_tp'] += weight * hit
                                    s['weighted_fn'] += weight * (not hit)
                                elif closed:
                                    s['fp'] += hit
                                    s['tn'] += not hit
                    if r['tooltip_rects']:
                        tips['positive' if positive else 'closed' if closed else 'other'] += 1
                    r.update({'video': source['video'], 'truth': truth, 'renderer_frame': old[n]['renderer_frame']})
                    stream.write(json.dumps(r) + '\n')
                    count += 1
                    if count % 200 == 0:
                        consumed = cpu_spent + cpu(native) + cpu(decoder)
                        if consumed > plan['budget']['cpu_seconds_max']:
                            raise RuntimeError('Approved7200CPU-second budget reached; partial checkpoint retained')
                        if sum((p.stat().st_size for p in base.rglob('*') if p.is_file())) > plan['budget']['cache_bytes_max']:
                            raise RuntimeError('Approvedcachebudget reached')
                    if count % 500 == 0:
                        stream.flush()
                        valid = [(i, s) for i, s in enumerate(scores['plain']) if s['fp'] == 0]
                        best = max(valid, key=lambda x: x[1]['weighted_tp']) if valid else None
                        progress = {'video': source['video'], 'frames': count, 'total': len(old), 'elapsed_seconds': round(time.monotonic() - started, 1), 'cpu_seconds': round(cpu_spent + cpu(native) + cpu(decoder), 1), 'best_plain_partial': None if best is None else {'config': configs[best[0]], 'tp': best[1]['tp'], 'fn': best[1]['fn'], 'fp': best[1]['fp']}, 'tooltip_frames': dict(tips)}
                        checkpoint(progress)
                        print(json.dumps(progress), flush=True)
            worker.join()
            used = cpu(native) + cpu(decoder)
            assert native.wait() == 0 and decoder.wait() == 0 and (not errors) and (count == len(old)), (errors, count, len(old))
            cpu_spent += used
            by_video.append({'video': source['video'], 'frames': count, 'cpu_seconds': used, 'wall_seconds': time.monotonic() - started, 'tooltip_frames': dict(tips), 'scores': {f: [dict(s) for s in ss] for f, ss in video_scores.items()}})
            checkpoint()
            print(json.dumps({'completed': source['video'], 'frames': count, 'cpu_seconds': used}), flush=True)
        finally:
            if native.poll() is None:
                native.kill()
            if decoder.poll() is None:
                decoder.kill()
    assert fingerprints == {str(p): sha(p) for p in tracked}, 'implementation changed during calibration'
    rank = []
    for family in scores:
        for i, s in enumerate(scores[family]):
            if s['fp'] == 0:
                c = configs[i]
                rank.append((s['weighted_tp'], c['border'] + c['interior'], -(c['regional_margin'] if c['regional_margin'] is not None else 9), family == 'plain', family, i))
    assert rank
    best = max(rank)
    family, i = best[-2:]
    winner = {'family': family, 'index': i, 'config': configs[i], 'counts': dict(scores[family][i]), 'recall': scores[family][i]['tp'] / frames_positive, 'weighted_recall': scores[family][i]['weighted_tp'] / weight_positive, 'zero_fp_negative_frames': frames_closed, 'note': 'Calibration only; freeze before independent-session test. Stricter thresholds/regional checks and unmasked simplicity break equal-recall ties.'}
    result = {'winner': winner, 'configs': configs, 'scores': {f: [dict(s) for s in ss] for f, ss in scores.items()}, 'recordings': by_video, 'cpu_seconds': cpu_spent, 'positive_frames': frames_positive, 'closed_frames': frames_closed, 'unique_positive_weight': weight_positive, 'source_hashes': fingerprints, 'approved_plan': plan}
    (out / 'report.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    (out / 'frozen-winner.json').write_text(json.dumps(winner, indent=2), encoding='utf-8')
    print(json.dumps({'finished': True, 'winner': winner}), flush=True)
if __name__ == '__main__':
    main()
