"""Read-only failure audit of the frozen GUI-neutral first-person matcher.

Truth is used to identify/audit errors, never to produce a deployable decision.
Images are inspection aids sought at n/60 in these constant-rate recordings;
all numerical diagnostics are joined by the exact cached frame ID.
"""
import argparse
import json
import subprocess
from pathlib import Path
from collections import Counter

import numpy as np
from PIL import Image, ImageDraw

from pov_gui_ablation import ROOT, SOURCES, sha, truth_for
from pov_gui_remaining import OUT as REMAINING, MODELS
from pov_gui_spatial import RULES
from pov_gui_support import OUT as SUPPORT, features
from pov_gui_stages import OUT as STAGES

OUT = ROOT / '.board/pov-gui-misses'


def audit_source(name):
    with np.load(REMAINING / f'{name}-features.npz') as archive:
        data = {k: archive[k] for k in archive.files}
    with np.load(SUPPORT / f'{name}-spatial-predictions.npz') as archive:
        frozen = {k: archive[k] for k in archive.files}
    rule = RULES.index([('x_span', 2), ('mask_margin', .5)])
    order = {int(n): i for i, n in enumerate(frozen['frames'])}
    truth, _, truth_hash = truth_for(name)
    spatial = json.loads((SUPPORT / f'{name}-spatial-features.json').read_text())
    misses = {}
    for i, n in enumerate(data['frames']):
        n = int(n)
        j = order[n]
        assert int(data['truth'][i]) == int(frozen['truth'][j])
        accepted = bool(frozen['accepted'][j, rule])
        row, expected = int(frozen['rows'][j]), int(data['truth'][i])
        if expected < 0 or (accepted and row == expected):
            continue
        assert not accepted, 'Unexpected accepted wrong row in frozen baseline'
        variants = []
        for k, model in enumerate(MODELS):
            if data['rows'][i, k] == expected and data['scores'][i, k] >= .5:
                variants.append({'model': list(model), 'evidence': float(data['scores'][i, k]),
                                 'margin': float(data['margins'][i, k]),
                                 'span': int(data['spans'][i, k])})
        misses[n] = {'source': name, 'n': n, 'seconds': n / 60, 'truth': expected,
                     'selected': row, 'candidate_correct': row == expected,
                     **{k: v for k, v in truth[n].items() if k != 'truth'},
                     'spatial': spatial.get(str(n)), 'passing_true_row_variants': variants}
    for line in (STAGES / f'{name}.jsonl').open():
        record = json.loads(line)
        n = record['n']
        if n not in misses:
            continue
        target = misses[n]
        target['gui_reliable'], target['veiled'] = record['reliable'], record['veiled']
        target['features'] = features(record)
        target['fovs'] = []
        for fov in range(2):
            stages = []
            for offset in [0, 2, 4, 6]:
                s = record['stats'][offset + fov]
                combined = np.asarray(s['sz']) + s['weight'] * np.asarray(s['cz'])
                ev = np.divide(s['sum'], s['used'], out=np.zeros(32), where=np.asarray(s['used']) >= 5)
                expected = target['truth']
                stages.append({'winner': int(combined.argmax()),
                    'truth_rank': int(1 + (combined > combined[expected]).sum()),
                    'truth_evidence': float(ev[expected]), 'truth_used': s['used'][expected],
                    'winner_evidence': float(ev[combined.argmax()]),
                    'truth_margin': float(combined[expected] - np.max(np.delete(combined, expected)))})
            target['fovs'].append({'degrees': [70, 60][fov], 'stages': stages})
        f = target['features']
        target['blockers'] = (['wrong_candidate'] if not target['candidate_correct'] else [])
        if f['visible_evidence'] < .5:
            target['blockers'].append('colour_evidence')
        else:
            if f['mask_margin'] < .5:
                target['blockers'].append('row_margin')
            if target['spatial'] and target['spatial']['x_span'] < 2:
                target['blockers'].append('spatial_spread')
    assert all('features' in r for r in misses.values())
    return list(misses.values()), {'truth_sha256': truth_hash,
        'features_sha256': sha(REMAINING / f'{name}-features.npz'),
        'frozen_predictions_sha256': sha(SUPPORT / f'{name}-spatial-predictions.npz'),
        'stage_cache_sha256': sha(STAGES / f'{name}.jsonl')}


def pictures(records):
    ffmpeg = ROOT / 'FireCrackle/src-tauri/runtime/ffmpeg.exe'
    for name in SOURCES:
        selected = [r for r in records if r['source'] == name]
        if not selected:
            continue
        sheet = Image.new('RGB', (1920, 400 * ((len(selected) + 2) // 3)), '#121820')
        draw = ImageDraw.Draw(sheet)
        for i, r in enumerate(selected):
            target = OUT / f"{name}-{r['n']}.png"
            if not target.exists():
                subprocess.run([str(ffmpeg), '-v', 'error', '-threads', '2', '-ss',
                    f"{r['seconds']:.9f}", '-i', str(ROOT / 'fire-detection/data/video' / SOURCES[name]),
                    '-frames:v', '1', '-threads', '1', str(target)], check=True)
            with Image.open(target) as image:
                image = image.convert('RGB').resize((640, 360))
                x, y = (i % 3) * 640, (i // 3) * 400
                sheet.paste(image, (x, y))
                draw.text((x + 8, y + 362), f"{name} n={r['n']} truth={r['truth']} pick={r['selected']} vis={r['vis']:.3f}", fill='white')
                draw.text((x + 8, y + 378), ', '.join(r['blockers']), fill='#ffbf69')
        sheet.save(OUT / f'{name}-sheet.jpg', quality=92)


def counterfactual(records):
    """Use shared Rust correction; verify image seeks against cached diagnostics."""
    native = ROOT / 'fire-detection/core/target/release/examples/pov_miss_counterfactual.exe'
    target = OUT / 'counterfactual.jsonl'
    with target.open('wb') as output:
        process = subprocess.Popen([str(native), '1920', '1080'], stdin=subprocess.PIPE, stdout=output)
        try:
            for r in records:
                with Image.open(OUT / f"{r['source']}-{r['n']}.png") as image:
                    process.stdin.write(image.convert('RGB').tobytes())
            process.stdin.close()
            assert process.wait() == 0
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
    observations = [json.loads(line) for line in target.open()]
    assert len(observations) == len(records)
    for i, (r, observation) in enumerate(zip(records, observations)):
        assert observation['index'] == i
        assert observation['auto'] == r['veiled']
        assert observation['gui_reliable'] == r['gui_reliable']
        summaries = []
        for mode, fovs in enumerate(observation['modes']):
            candidates, evidences = [], []
            for f, stats in enumerate(fovs):
                raw_scores = np.asarray(stats['raw_sz']) + 2 * np.asarray(stats['raw_cz'])
                masked_scores = np.asarray(stats['mask_sz']) + 2 * np.asarray(stats['mask_cz'])
                row = int(raw_scores.argmax())
                raw_ev = stats['raw_sum'][row] / stats['raw_used'][row]
                masked_ev = np.divide(stats['mask_sum'], stats['mask_used'],
                    out=np.zeros(32), where=np.asarray(stats['mask_used']) >= 5)
                if mode == int(r['veiled']):
                    cached = r['fovs'][f]['stages']
                    assert row == cached[0]['winner']
                    assert abs(raw_ev - cached[0]['winner_evidence']) < 1e-8
                    assert abs(masked_ev[r['truth']] - cached[3]['truth_evidence']) < 1e-8
                    assert int(masked_scores.argmax()) == cached[3]['winner']
                candidates.append({'fov': [70, 60][f], 'row': row,
                    'raw_evidence': raw_ev, 'mask_evidence': float(masked_ev[row]),
                    'truth_mask_evidence': float(masked_ev[r['truth']]),
                    'masked_winner': int(masked_scores.argmax())})
                evidences.append(raw_ev)
            f = int(evidences[1] > evidences[0])
            summaries.append({'veiled': bool(mode), 'selected': candidates[f], 'fovs': candidates})
        r['veil_counterfactual'] = summaries
    return {'native_sha256': sha(native), 'source_sha256': sha(
        ROOT / 'fire-detection/core/examples/pov_miss_counterfactual.rs'),
        'image_auto_cache_parity_frames': len(records)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--images', action='store_true')
    parser.add_argument('--counterfactual', action='store_true')
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    records, signatures = [], {}
    for name in SOURCES:
        found, signatures[name] = audit_source(name)
        records.extend(found)
    assert len(records) == 30
    counts = dict(Counter(b for r in records for b in r['blockers']))
    result = {'analysis_sha256': sha(Path(__file__)), 'input_hashes': signatures,
              'count': len(records), 'blocker_counts_overlapping': counts, 'records': records}
    for r in records:
        f = r['features']
        print(r['source'], r['n'], r['truth'], r['selected'], r['blockers'],
              'ev', round(f['visible_evidence'], 3), 'margin', round(f['mask_margin'], 3),
              'vis', r['vis'], 'veil', r['veil'], 'variants', len(r['passing_true_row_variants']))
    print('Blockers (overlap):', counts)
    if args.images:
        pictures(records)
    if args.counterfactual:
        result['counterfactual_provenance'] = counterfactual(records)
    (OUT / 'audit.json').write_text(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
