"""Freeze real soul-fire quads at native video resolution, using the shared unveil.

Truth determines evaluation targets only, never candidate filtering or scoring.
Temporal split is declared on the command line before any scoring.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'fire-detection/bench/no_fire'))
from veil_native import apply as unveil

spec = importlib.util.spec_from_file_location('actual_quad', Path(__file__).with_name('prepare-actual-quad-eval.py'))
geometry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(geometry)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('video', type=Path)
    ap.add_argument('joined', type=Path)
    ap.add_argument('out', type=Path)
    ap.add_argument('--ffmpeg', type=Path, required=True)
    ap.add_argument('--stride', type=int, default=60)
    ap.add_argument('--tune-end', type=int, required=True)
    ap.add_argument('--validation-start', type=int, required=True)
    args = ap.parse_args()
    if args.stride < 1 or not 0 < args.tune_end < args.validation_start:
        ap.error('Invalid stride/split')
    probe = args.ffmpeg.with_name('ffprobe.exe' if args.ffmpeg.suffix == '.exe' else 'ffprobe')
    stream = json.loads(subprocess.check_output([str(probe), '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', str(args.video)]))['streams'][0]
    w, h = stream['width'], stream['height']
    labels = {}
    seen = set()
    for line in args.joined.open(encoding='utf8'):
        row = json.loads(line)
        if row['n'] % args.stride or not row.get('tick_ok') or not row.get('label'):
            continue
        # OBS can repeat a rendered frame; don't count it twice.
        if row['f'] in seen:
            continue
        seen.add(row['f'])
        labels[row['n']] = row
    args.out.mkdir(parents=True, exist_ok=True)
    hashes = {}
    for i in (0, 1):
        sheet = np.asarray(Image.open(ROOT/f'FireCrackle/public/animation-atlases/soul_fire_{i}.png').convert('RGBA'))
        if i == 0:
            sheet = np.concatenate([sheet[256:], sheet[:256]])
        sheet.tofile(args.out/f'soul_{i}.rgba')
        hashes[f'soul_{i}'] = hashlib.sha256(sheet.tobytes()).hexdigest()
    command = [str(args.ffmpeg), '-v', 'error', '-i', str(args.video), '-vf', f'select=not(mod(n\\,{args.stride}))', '-fps_mode', 'passthrough', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']
    proc = subprocess.Popen(command, stdout=subprocess.PIPE)
    samples, skips, frame = [], {}, 0
    while True:
        raw = proc.stdout.read(w*h*3)
        if not raw:
            break
        if len(raw) != w*h*3:
            raise ValueError('Truncated frame')
        n = frame * args.stride
        frame += 1
        row = labels.get(n)
        if not row:
            continue
        label = row['label']
        if 'soul_fires' not in label:
            raise ValueError(f'Soul capture unavailable at frame {n}')
        split = 'tune' if n < args.tune_end else 'validation' if n >= args.validation_start else 'gap'
        if split == 'gap':
            continue
        cases = []
        for fi, fire in enumerate(label['soul_fires']):
            for qi, q in enumerate(fire.get('quads', [])):
                points, error = geometry.canonical_quad(q, label['w'], label['h'])
                if error:
                    skips[error] = skips.get(error, 0)+1
                    continue
                quad = [[x/label['w'], y/label['h']] for x, y in points]
                if max(p[0] for p in quad) <= 0 or min(p[0] for p in quad) >= 1 or max(p[1] for p in quad) <= 0 or min(p[1] for p in quad) >= 1:
                    skips['offscreen'] = skips.get('offscreen', 0)+1
                    continue
                cases.append(dict(id=f'{n}-{fi}-{qi}', frame=n, rendered_frame=row['f'], split=split,
                    quad=quad, expected=[q['s'], (q['row']+(16 if q['s'] == 0 else 0)) % 32, bool(q['m'])],
                    physical_row=q['row'], visibility=q['vis'], veil=q['veil'], source=fire['src']))
        if cases:
            pixels, applied, _ = unveil(np.frombuffer(raw, np.uint8).reshape(h, w, 3))
            np.ascontiguousarray(pixels).tofile(args.out/f'{n}.rgb')
            for c in cases:
                c['unveiled'] = bool(applied)
            samples.extend(cases)
        if frame % 30 == 0:
            print(f'{frame} decoded samples; {len(samples)} quads', flush=True)
    proc.stdout.close()
    if proc.wait() != 0:
        raise RuntimeError('FFmpeg failed')
    for name in ('veil.rs', 'veil_abi.rs', 'portal.rs'):
        hashes[name] = hashlib.sha256((ROOT/'fire-detection/core/src'/name).read_bytes()).hexdigest()
    result = dict(kind='real_recording_soul', video=str(args.video.resolve()), width=w, height=h,
                  joined_sha256=hashlib.sha256(args.joined.read_bytes()).hexdigest(), hashes=hashes,
                  stride=args.stride, tune_end=args.tune_end, validation_start=args.validation_start,
                  skips=skips, samples=samples)
    (args.out/'manifest.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(dict(quads=len(samples), frames=len({x['frame'] for x in samples}), skips=skips)))


if __name__ == '__main__':
    main()
