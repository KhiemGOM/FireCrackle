"""Full-resolution real-video evaluation of adjacent orange/pale connected regions.

Rules are explicit in colour_blobs.rs. The yellow-core variant was added after
visual error review, so comparisons on these familiar recordings are diagnostic,
not a pristine blind holdout. Detector evidence is video-only; capture labels
are joined only for offline scoring and error review.
"""
import argparse
import hashlib
import json
import subprocess
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from colour_support import frames
from prepare import ROOT, SOURCES


def truth_rows(name, stride, min_side):
    rows = {}
    for line in (ROOT/f'fire-detection/data/joined/{name}.jsonl').open(encoding='utf8'):
        row = json.loads(line)
        if row['n'] % stride or not row.get('tick_ok') or not isinstance(row.get('label'), dict):
            continue
        label = row['label']; boxes = []
        for source in label.get('fires', []):
            box = source.get('box')
            if box:
                box = np.asarray(box)*[1920/label['w'],1080/label['h'],1920/label['w'],1080/label['h']]
                boxes.append(box.tolist())
        # Configurable pragmatic size proxy; no attempt to turn boxes into exact flame area.
        substantial = any(b[2]-b[0] >= min_side and b[3]-b[1] >= min_side for b in boxes)
        rows[row['n']] = {'fire': bool(label['fire']), 'substantial': bool(substantial), 'boxes': boxes}
    return rows


def metrics(rows):
    fire = np.array([r['truth']['fire'] for r in rows], bool)
    large = np.array([r['truth']['substantial'] for r in rows], bool)
    result = {'frames': len(rows), 'no_fire': int((~fire).sum()), 'fire': int(fire.sum()),
        'substantial_fire': int(large.sum()), 'negligible_fire': int((fire & ~large).sum()), 'variants': {}}
    branches = [('all', 'raw', 'auto')]
    if rows and 'raw_nohud' in rows[0]['evidence']:
        branches.append(('nohud', 'raw_nohud', 'auto_nohud'))
    for variant, raw, auto in branches:
        for field in ('pixels', 'single', 'pair', 'separated'):
            for cutoff in (4,16,64):
                score = np.array([max(r['evidence'][raw][field],r['evidence'][auto][field]) for r in rows])
                clear = score < cutoff
                result['variants'][f'{variant}:{field}<{cutoff}'] = {
                    'cleared_no_fire': int((clear & ~fire).sum()),
                    'cleared_negligible_fire': int((clear & fire & ~large).sum()),
                    'missed_substantial_fire': int((clear & large).sum()),
                    'missed_any_fire': int((clear & fire).sum())}
    return result


def save_case(rgb, row, path):
    original = Image.fromarray(rgb); draw = ImageDraw.Draw(original)
    for b in row['truth']['boxes']:
        draw.rectangle(b, outline='red', width=3)
    image = original.resize((768,432))
    canvas = Image.new('RGB',(768,468),'#20242c'); canvas.paste(image)
    draw = ImageDraw.Draw(canvas)
    e = row['evidence']; text = f"{row['source']} #{row['frame']} fire={row['truth']['fire']} substantial={row['truth']['substantial']}"
    draw.text((4,434),text,fill='white')
    a,b=e.get('raw_nohud',e['raw']),e.get('auto_nohud',e['auto'])
    scope='HUD-excluded' if 'raw_nohud' in e else 'Full-frame'
    draw.text((4,450),f"{scope} pair {a['pair']}/{b['pair']} separated {a['separated']}/{b['separated']} | red=capture box",fill='white')
    canvas.save(path)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('out',type=Path); ap.add_argument('--stride',type=int,default=90)
    ap.add_argument('--min-fire-side',type=float,default=4); ap.add_argument('--threads',type=int,default=6)
    ap.add_argument('--sources',nargs='+',choices=list(SOURCES),default=list(SOURCES))
    ap.add_argument('--binary',type=Path)
    ap.add_argument('--pale-mode',choices=['literal','yellow'],default='literal')
    args = ap.parse_args()
    if args.stride < 1 or args.min_fire_side < 0: ap.error('Invalid sampling/size cutoff')
    args.out.mkdir(parents=True,exist_ok=True)
    binary = args.binary or args.out/'colour_blobs.exe'; source = Path(__file__).with_name('colour_blobs.rs')
    if not args.binary or not binary.exists():
        subprocess.run(['rustc','--edition','2021','-O',str(source),'-o',str(binary)],check=True)
    report = {'stride':args.stride,'min_fire_side_px':args.min_fire_side,
        'pale_mode':args.pale_mode,
        'size_truth':'At least one visible-fire label box has width and height >= cutoff; approximate footprint, not exact fire pixel area.',
        'rules_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),
        'binary_sha256':hashlib.sha256(binary.read_bytes()).hexdigest(),
        'combination':'Review if either raw or conditionally unveiled branch has qualifying evidence.',
        'pair_rule':'Two distinct 8-connected colour regions must touch; each >=2px and >=5% of pair area.',
        'separated_rule':'Pair rule plus centroid distance >=12% of combined bounding-box diagonal, any orientation.',
        'hud_diagnostic':'Exclude centre half of bottom12% and right15% of top18%; real fire inside these is NOT removed from truth.',
        'sources':{}}
    (args.out/'frozen-protocol.json').write_text(json.dumps(report,indent=2))
    helper = subprocess.Popen([str(binary.resolve()),'1920','1080',args.pale_mode],stdin=subprocess.PIPE,stdout=subprocess.PIPE)
    try:
        for name in args.sources:
            truth = truth_rows(name,args.stride,args.min_fire_side); rows = []; last_case = {}; start = time.time()
            for n,rgb in frames(name,args.stride,args.threads):
                if n not in truth: continue
                helper.stdin.write(rgb.tobytes()); helper.stdin.flush()
                answer = helper.stdout.readline()
                if not answer: raise RuntimeError('Blob helper exited unexpectedly')
                row = {'source':name,'frame':n,'truth':truth[n],'evidence':json.loads(answer)}; rows.append(row)
                e = row['evidence']; score = max(e.get('raw_nohud',e['raw'])['separated'],e.get('auto_nohud',e['auto'])['separated'])
                category = 'missed-large' if score < 16 and truth[n]['substantial'] else 'cleared-negative' if score < 16 and not truth[n]['fire'] else None
                if category and n-last_case.get(category,-10000) >= 600:
                    saved = sum(1 for p in args.out.glob(f'{name}-{category}-*.png'))
                    if saved < 6:
                        save_case(rgb,row,args.out/f'{name}-{category}-{n}.png');last_case[category]=n
                if len(rows)%200 == 0: print(json.dumps({'source':name,'frames':len(rows),'seconds':round(time.time()-start)}),flush=True)
            (args.out/f'{name}.json').write_text(json.dumps(rows))
            report['sources'][name] = metrics(rows)
            report['sources'][name]['seconds'] = round(time.time()-start,2)
            (args.out/'report.json').write_text(json.dumps(report,indent=2))
            print(json.dumps({name:report['sources'][name]}),flush=True)
    finally:
        helper.stdin.close(); helper.stdout.close()
        if helper.wait() != 0: raise RuntimeError('Blob helper failed')


if __name__ == '__main__': main()
