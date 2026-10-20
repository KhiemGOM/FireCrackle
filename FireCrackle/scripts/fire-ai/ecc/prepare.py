"""Frozen deterministic ECC pilot: real pixels, perturbed geometry only."""
import collections, hashlib, json
from pathlib import Path
import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[4]
OUT = ROOT / '.board/ecc-align'

def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []; sources = []
    for material, folder, video in [('normal', 'row32-128', 'quad1'), ('soul', 'soul-phase128', 'soul_holdout')]:
        manifest = ROOT / '.board' / folder / 'manifest.json'
        eligible = [r for r in json.loads(manifest.read_text())['samples'] if r['split']=='test' and r['video']==video]
        # One target per decoded frame; deterministic hash ordering independent of scores/truth.
        unique = {}
        for r in sorted(eligible, key=lambda r:r['id']): unique.setdefault(r['frame'],r)
        chosen = sorted(unique.values(), key=lambda r:hashlib.sha256(r['id'].encode()).digest())[:64]
        for r in chosen:
            seed = int.from_bytes(hashlib.sha256(r['id'].encode()).digest()[:8], 'little')
            rng = np.random.default_rng(seed)
            q = np.asarray(r['quad']); h = cv2.getPerspectiveTransform(np.float32([[0,0],[1,0],[1,1],[0,1]]), q.astype(np.float32))
            uv = np.float32([[0,0],[1,0],[1,1],[0,1]]) + rng.uniform(-.04,.04,(4,2)).astype(np.float32)
            rough = cv2.perspectiveTransform(uv[None],h)[0]
            cache = '.board/row32-real/quad1' if material=='normal' else '.board/soul-phase128/soul_holdout'
            rows.append({**r,'material':material,'rough':rough.tolist(),'pixels':f'{cache}/{r["frame"]}.rgb'})
        sources.append(dict(material=material,manifest=manifest.relative_to(ROOT).as_posix(),sha256=sha(manifest),eligible=len(eligible),unique_frames=len(unique),selected=len(chosen)))
    assert len(rows)==128
    wanted={r['frame'] for r in rows if r['material']=='normal'}; labels={}
    joined=ROOT/'fire-detection/data/joined/quad1.jsonl'
    for line in joined.open():
        v=json.loads(line)
        if v['n'] in wanted:labels[v['n']]=v['label']
    for r in rows:
        if r['material']=='normal':
            source,part=map(int,r['id'].split('-')[-2:]);q=labels[r['frame']]['fires'][source]['quads'][part]
            assert (q['row']+(16 if q['s']==0 else 0))%32==r['phase']
            r['sheet']=q['s'];r['mirrored']=bool(q['m'])
        r['selected_model']=r['sheet']*64+r['phase']*2+int(r['mirrored'])
    assert all(len({r['render_frame'] for r in rows if r['material']==m})==64 for m in ['normal','soul'])
    (OUT/'cases.json').write_text(json.dumps(rows))
    (OUT/'plan.json').write_text(json.dumps(dict(sources=sources,selection='64 per material; unique decoded and renderer frames; SHA256(id) ordering; no outcome selection',geometry='Recorded quad and deterministic +/-4% per-corner UV jitter; real video pixels unchanged; not synthetic fire',selected_sprite='Renderer-labelled phase, sheet and mirror held fixed for every fitter; classification uses no truth',methods=['fixed quad','current production bounded Nelder-Mead','masked ECC homography, 60 iterations, epsilon1e-5, blur3,128px canvas','projected bounded ECC:30 single updates; same120% corner envelope; best encountered correlation'],metrics=['distinct-phase top3 on rough outlines','known-sprite corner error before/after','wall inference ms including failures'],model_training=False,preprocessing='Existing frozen native RGB caches from shared Rust unveil; no new inverse',truth_join_sha256=sha(joined)),indent=2))
    print(json.dumps(dict(cases=len(rows),sources=sources)))

if __name__=='__main__':main()
