"""Offline deterministic colour-support pilot from projected opaque sprite texels.

No box pixels are used as fire truth. Projection is still a sampling proxy:
recorded visibility is approximate, and particles/overlapping geometry can contaminate
samples. Contact sheets expose extremes for review; nothing is silently trimmed.
"""
import argparse
import heapq
import json
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from features import unveil
from prepare import ROOT, SOURCES


def project(matrix, points):
    p = np.c_[points, np.ones(len(points))] @ matrix.T
    return p[:, :2] / p[:, 2:]


def homography(uv, corners):
    a, b = [], []
    for (u, v), (x, y) in zip(uv, corners):
        a += [[u, v, 1, 0, 0, 0, -x*u, -x*v],
              [0, 0, 0, u, v, 1, -y*u, -y*v]]
        b += [x, y]
    return np.r_[np.linalg.solve(a, b), 1].reshape(3, 3)


def texel_samples(label, sprites, width, height):
    """Opaque texel centres screened by their projected texel size."""
    output = []
    for source in label.get('fires', []):
        for q in source.get('quads', []):
            if q.get('vis', 0) < .999 or not q.get('c'):
                continue
            sprite = sprites[q['s']][q['row']*16:(q['row']+1)*16]
            yy, xx = np.where(sprite[:, :, 3] >= 26)
            uv = (np.c_[xx, yy] + .5)/16
            try:
                h = homography(np.asarray(q['uv']).reshape(4, 2),
                    np.asarray(q['c']).reshape(4, 2)*[width/label['w'], height/label['h']])
                centre = project(h, uv)
                # Projected centre-to-edge-midpoint size heuristic, independent of RGB.
                edge = np.minimum.reduce([np.linalg.norm(project(h, uv+offset)-centre, axis=1)
                    for offset in ([1/32, 0], [-1/32, 0], [0, 1/32], [0, -1/32])])
                xy = np.floor(centre).astype(int)
                good = (edge >= 2.25) & (xy[:, 0] >= 2) & (xy[:, 0] < width-2) & (xy[:, 1] >= 12) & (xy[:, 1] < height-2)
                for i in np.flatnonzero(good):
                    output.append((int(xy[i, 0]), int(xy[i, 1]), sprite[yy[i], xx[i], :3]))
            except np.linalg.LinAlgError:
                continue
    return output


def frames(name, stride, threads=2):
    ffmpeg = ROOT/'FireCrackle/src-tauri/runtime/ffmpeg.exe'
    video = ROOT/'fire-detection/data/video'/SOURCES[name]
    command = [str(ffmpeg), '-v', 'error', '-threads', str(threads), '-i', str(video),
        '-vf', f'select=not(mod(n\\,{stride}))', '-fps_mode', 'passthrough',
        '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']
    proc = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        n = 0
        while True:
            raw = proc.stdout.read(1920*1080*3)
            if not raw:
                break
            if len(raw) != 1920*1080*3:
                raise RuntimeError('Truncated RGB frame')
            yield n, np.frombuffer(raw, np.uint8).reshape(1080, 1920, 3)
            n += stride
        error = proc.stderr.read().decode(errors='replace')
        if proc.wait():
            raise RuntimeError(error)
    finally:
        proc.stdout.close()
        proc.stderr.close()
        if proc.poll() is None:
            proc.terminate()
            proc.wait()


def labels(name):
    return {r['n']: r['label'] for line in (ROOT/f'fire-detection/data/joined/{name}.jsonl').open(encoding='utf8')
            if (r := json.loads(line)).get('tick_ok') and isinstance(r.get('label'), dict)}


def bins(rgb):
    v = rgb.astype(np.int32)//8
    return (v[..., 0]*32+v[..., 1])*32+v[..., 2]


def support(colours, radius=1):
    cube = np.zeros((32, 32, 32), bool)
    v = np.unique(colours.astype(int)//8, axis=0)
    for dr in range(-radius, radius+1):
        for dg in range(-radius, radius+1):
            for db in range(-radius, radius+1):
                p = np.clip(v+[dr, dg, db], 0, 31)
                cube[p[:, 0], p[:, 1], p[:, 2]] = True
    return cube.ravel()


def palette_stats(colours):
    """Chebyshev RGB distance to ANY opaque original palette colour, not same UV texel."""
    palette = np.concatenate([np.fromfile(ROOT/f'fire-detection/data/assets/fire_{s}.rgba', np.uint8).reshape(-1, 4) for s in (0, 1)])
    palette = np.unique(palette[palette[:, 3] >= 26, :3], axis=0).astype(int)
    distance = np.concatenate([np.abs(c[:, None, :].astype(int)-palette[None, :, :]).max(axis=2).min(axis=1)
        for c in np.array_split(colours, max(1, (len(colours)+1023)//1024))])
    return {'pixels': len(colours), 'rgb_min': colours.min(axis=0).tolist(),
        'rgb_max': colours.max(axis=0).tolist(), 'nearest_palette_distance_quantiles':
        dict(zip(['50', '90', '95', '99', '100'], np.quantile(distance, [.5, .9, .95, .99, 1]).tolist()))}


def sample(args):
    sprites = [np.asarray(Image.open(ROOT/f'fire-detection/data/assets/fire_{s}.png').convert('RGBA')) for s in range(2)]
    rng = np.random.default_rng(7103)
    raw, corrected, expected, provenance, extremes = [], [], [], [], []
    serial = 0
    for name in ('quad1', 'survival1'):
        lab = labels(name)
        sampled_frames = 0
        for n, rgb in frames(name, args.sample_stride):
            if n not in lab:
                continue
            points = texel_samples(lab[n], sprites, 1920, 1080)
            if not points:
                continue
            fixed, detected, _ = unveil(rgb)
            sampled_frames += 1
            for j in rng.choice(len(points), min(32, len(points)), replace=False):
                x, y, target = points[j]
                value, norm = rgb[y, x], fixed[y, x]
                raw.append(value); corrected.append(norm); expected.append(target)
                provenance.append([name, n, x, y, bool(detected)])
                drift = int(np.abs(norm.astype(int)-target.astype(int)).max())
                # Keep the highest-drift examples WITHOUT rejecting them by colour.
                tile = np.asarray(Image.fromarray(rgb[max(0, y-40):y+41, max(0, x-40):x+41]).resize((162, 162)))
                item = (drift, serial, tile, [name, n, x, y, value.tolist(), norm.tolist(), target.tolist(), bool(detected)])
                serial += 1
                if len(extremes) < 40:
                    heapq.heappush(extremes, item)
                elif drift > extremes[0][0]:
                    heapq.heapreplace(extremes, item)
        print(json.dumps({'sample_source': name, 'frames_with_samples': sampled_frames, 'total_pixels': len(raw)}), flush=True)
    if not raw:
        raise RuntimeError('No sufficiently large fully-visible opaque texels')
    np.savez_compressed(args.out/'pixels.npz', raw=raw, corrected=corrected, expected=expected)
    (args.out/'pixels.json').write_text(json.dumps(provenance))
    sheet = Image.new('RGB', (5*240, 8*220), '#20242c'); draw = ImageDraw.Draw(sheet)
    review = []
    for i, (drift, _, tile, info) in enumerate(sorted(extremes, reverse=True)):
        x, y = (i % 5)*240, (i//5)*220
        sheet.paste(Image.fromarray(tile), (x, y)); draw.ellipse((x+77, y+77, x+85, y+85), outline='cyan', width=1)
        draw.text((x, y+164), f'{i}: {info[0]} #{info[1]} drift {drift}', fill='white')
        draw.text((x, y+179), f'RGB {info[4]}', fill='white')
        draw.text((x, y+194), f'target {info[6]} veil {info[7]}', fill='white')
        review.append({'index': i, 'drift': drift, 'sample': info})
    sheet.save(args.out/'outliers.png')
    (args.out/'outliers.json').write_text(json.dumps(review, indent=2))


def review_fit(args):
    """One marked, deterministic representative per occupied coarse fit RGB bin."""
    data = np.load(args.out/'pixels.npz')
    meta = json.loads((args.out/'pixels.json').read_text())
    groups = {}
    for i, point in enumerate(meta):
        if point[0] == 'quad1':
            groups.setdefault(tuple(data['raw'][i]//32), []).append(i)
    chosen = [v[len(v)//2] for _, v in sorted(groups.items())]
    images, records = {}, []
    for j, i in enumerate(chosen):
        _, n, x, y, _ = meta[i]
        if n not in images:
            ffmpeg = ROOT/'FireCrackle/src-tauri/runtime/ffmpeg.exe'
            raw = subprocess.check_output([str(ffmpeg), '-v', 'error', '-ss', str(n/60),
                '-i', str(ROOT/'fire-detection/data/video'/SOURCES['quad1']),
                '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'])
            images[n] = Image.fromarray(np.frombuffer(raw, np.uint8).reshape(1080, 1920, 3))
        if j % 30 == 0:
            sheet = Image.new('RGB', (1200, 1320), '#20242c'); draw = ImageDraw.Draw(sheet)
        sx, sy = (j % 5)*240, ((j % 30)//5)*220
        sheet.paste(images[n].crop((x-40, y-40, x+41, y+41)).resize((162, 162)), (sx, sy))
        draw.ellipse((sx+77, sy+77, sx+85, sy+85), outline='cyan', width=1)
        draw.text((sx, sy+164), f'{j}: pixel {i} frame {n}', fill='white')
        draw.text((sx, sy+180), f'RGB {data["raw"][i].tolist()}', fill='white')
        records.append({'index': j, 'pixel': i, 'frame': n, 'xy': [x, y],
            'bin': (data['raw'][i]//32).tolist(), 'rgb': data['raw'][i].tolist(),
            'members': len(groups[tuple(data['raw'][i]//32)])})
        if j % 30 == 29 or j == len(chosen)-1:
            sheet.save(args.out/f'fit-bin-review-{j//30}.png')
    (args.out/'fit-bin-review.json').write_text(json.dumps(records, indent=2))


def evaluate(args):
    data = np.load(args.out/'pixels.npz'); meta = json.loads((args.out/'pixels.json').read_text())
    fit = np.array([p[0] == 'quad1' for p in meta])
    held_out = ~fit
    suffix = ''
    if args.reviewed_bins:
        review = json.loads(args.reviewed_bins.read_text())
        accepted = {tuple(b) for b in review['accepted_rgb_bins_32']}
        fit &= np.array([tuple(c//32) in accepted for c in data['raw']])
        suffix = '-reviewed'
    # Fit one recording, freeze before any held-out frame is decoded/scored.
    lut = support(data['raw'][fit], 1)
    auto_lut = support(data['corrected'][fit], 1)
    np.save(args.out/f'frozen-raw-lut{suffix}.npy', lut)
    np.save(args.out/f'frozen-auto-lut{suffix}.npy', auto_lut)
    report = {'fit': 'quad1 projected opaque texel centres', 'sample_pixels': len(meta),
        'fit_pixels': int(fit.sum()), 'support_rgb_cube_fraction': float(lut.mean()),
        'no_samples_trimmed': not bool(args.reviewed_bins), 'sources': {}}
    report['protocol'] = {'sample_stride': args.sample_stride, 'test_stride': args.test_stride,
        'rgb_bin_width': 8, 'bin_dilation_radius': 1,
        'candidate_sampling_drift_is_unreviewed': True,
        'note': 'Frame fire/no-fire labels are capture-mod truth, not exhaustive human verification. Tiny/occluded fire stays in the test denominator.'}
    if args.reviewed_bins:
        report['visual_review'] = review
        report['review_approved_fit_colour_stats'] = palette_stats(data['raw'][fit])
        report['visually_verified_colour_stats'] = palette_stats(data['raw'][review['reviewed_positive_pixels']])
    for branch in ('raw', 'corrected'):
        drift = np.abs(data[branch].astype(int)-data['expected'].astype(int))
        report[branch+'_drift'] = {'channel_max': drift.max(axis=0).tolist(),
            'observed_rgb_min': data[branch].min(axis=0).tolist(),
            'observed_rgb_max': data[branch].max(axis=0).tolist(),
            'max_channel_quantiles': dict(zip(['50', '90', '95', '99', '100'], np.quantile(drift.max(axis=1), [.5, .9, .95, .99, 1]).tolist()))}
    report['held_out_sample_pixel_coverage'] = float(lut[bins(data['raw'][held_out])].mean())
    report['held_out_auto_sample_pixel_coverage'] = float(auto_lut[bins(data['corrected'][held_out])].mean())
    (args.out/f'fit{suffix}.json').write_text(json.dumps(report, indent=2))
    if args.mode == 'stats':
        path = args.out/f'report{suffix}.json'
        if path.exists():
            report['sources'] = json.loads(path.read_text()).get('sources', {})
        path.write_text(json.dumps(report, indent=2))
        return
    for name in args.sources:
        lab = labels(name); rows = []
        for n, rgb in frames(name, args.test_stride, args.threads):
            if n not in lab:
                continue
            count = int(lut[bins(rgb[12:])].sum())
            fixed, detected, _ = unveil(rgb)
            auto_count = int(auto_lut[bins(fixed[12:])].sum())
            rows.append([n, bool(lab[n]['fire']), count, auto_count, bool(detected)])
        (args.out/f'{name}-counts{suffix}.json').write_text(json.dumps(rows))
        truth = np.array([r[1] for r in rows], bool)
        report['sources'][name] = {'frames': len(rows), 'fire': int(truth.sum()), 'no_fire': int((~truth).sum()),
            'branches': {}}
        for branch, col in [('raw', 2), ('auto_unveil', 3)]:
            counts = np.array([r[col] for r in rows])
            report['sources'][name]['branches'][branch] = {
                'minimum_matching_pixels_on_fire_frame': int(counts[truth].min()),
                'thresholds': {str(t): {'cleared_no_fire': int(((counts < t) & ~truth).sum()),
                    'missed_fire': int(((counts < t) & truth).sum())} for t in (1, 2, 4, 16, 64)}}
        (args.out/f'report{suffix}.json').write_text(json.dumps(report, indent=2))
        print(json.dumps({name: report['sources'][name]}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('mode', choices=['sample', 'review', 'evaluate', 'stats'])
    parser.add_argument('out', type=Path); parser.add_argument('--sample-stride', type=int, default=60)
    parser.add_argument('--test-stride', type=int, default=90)
    parser.add_argument('--sources', nargs='+', choices=list(SOURCES), default=list(SOURCES))
    parser.add_argument('--threads', type=int, default=2)
    parser.add_argument('--reviewed-bins', type=Path)
    args = parser.parse_args(); args.out.mkdir(parents=True, exist_ok=True)
    if args.sample_stride < 1 or args.test_stride < 1 or args.threads < 1:
        parser.error('Strides and thread count must be positive')
    if args.mode == 'sample':
        sample(args)
    elif args.mode == 'review':
        review_fit(args)
    else:
        evaluate(args)
