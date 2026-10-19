"""Inventory every normal recording; select real, visible, readable quad candidates.

Boxes are recorded in the inventory but never silently treated as quad geometry.
The video split is frozen before decoding or examining classification scores.
"""
import collections
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[5]
OUT = ROOT / '.board/row32-real'
spec = importlib.util.spec_from_file_location('quad_geometry', ROOT/'FireCrackle/scripts/prepare-actual-quad-eval.py')
geometry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(geometry)
SOURCES = [
    ('early', '2026-10-15 14-15-51.mkv', '.board/pov-independent-20261018/early.joined.jsonl', 'inventory_only'),
    ('clip1', '2026-10-15 14-48-36.mkv', 'fire-detection/data/joined/clip1.jsonl', 'inventory_only'),
    ('clip2', '2026-10-15 18-18-16.mkv', 'fire-detection/data/joined/clip2.jsonl', 'inventory_only'),
    ('quad1', '2026-10-16 00-40-22.mkv', 'fire-detection/data/joined/quad1.jsonl', 'test'),
    ('survival1', '2026-10-16 18-23-42.mkv', 'fire-detection/data/joined/survival1.jsonl', 'train'),
    ('later', '2026-10-17 17-04-31.mkv', '.board/pov-independent-20261018/later.joined.jsonl', 'calibration'),
    ('new_normal', '2026-10-19 16-49-48.mkv', '.board/soul-quad/joined.jsonl', 'train'),
]

def digest(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda:f.read(1048576),b''): h.update(chunk)
    return h.hexdigest()

def phase(sheet, row):
    # Legacy capture import boundary. Everything downstream uses animation phase.
    return (row + (16 if sheet == 0 else 0)) % 32

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    summaries=[]; candidates=[]
    for name,video,joined,split in SOURCES:
        path=ROOT/joined; counts=collections.Counter(); phases=collections.Counter(); seen=set()
        stream=json.loads(subprocess.check_output([str(ROOT/'FireCrackle/src-tauri/runtime/ffprobe.exe'),'-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','json',str(ROOT/'fire-detection/data/video'/video)]))['streams'][0]
        w,h=stream['width'],stream['height']
        for line in path.open(encoding='utf8'):
            r=json.loads(line);counts['joined_frames']+=1
            lab=r.get('label') or {}
            if not r.get('tick_ok'):continue
            counts['synced_frames']+=1
            fires=lab.get('fires',[]);counts['fire_frames']+=bool(fires)
            counts['quads']+=sum(len(f.get('quads',[])) for f in fires)
            counts['boxed_parts']+=sum(len(f.get('parts',[])) for f in fires)
            if r['n']%11 or r['f'] in seen:continue
            seen.add(r['f']); items=[]
            for fi,f in enumerate(fires):
                if f.get('src')=='overlay':continue
                for qi,q in enumerate(f.get('quads',[])):
                    if q.get('vis',0)<.95:continue
                    xy,error=geometry.canonical_quad(q,lab['w'],lab['h'])
                    if error:continue
                    quad=np.array(xy)/[lab['w'],lab['h']]
                    if quad.min()<0 or quad.max()>1:continue
                    edges=np.linalg.norm((quad-np.roll(quad,1,axis=0))*[w,h],axis=1)
                    if edges.min()<48:continue
                    p=phase(q['s'],q['row']);phases[p]+=1
                    items.append(dict(id=f'{name}-{r["n"]}-{fi}-{qi}',video=name,video_file=video,joined=joined,split=split,frame=r['n'],render_frame=r['f'],quad=quad.tolist(),width=w,height=h,phase=p,source=f['src'],visibility=q['vis'],veil=q.get('veil'),min_edge=float(edges.min())))
            # Cap related quads per frame using geometry only, not prediction/colour.
            items.sort(key=lambda c:(-c['min_edge'],c['id']))
            candidates.extend(items[:8]);counts['pre_readability_candidates']+=min(8,len(items))
        summary=dict(name=name,video=video,joined=joined,split=split,counts=dict(counts),sampled_phase_counts=dict(sorted(phases.items())),joined_sha256=digest(path),width=w,height=h)
        summaries.append(summary);print(json.dumps(summary),flush=True)
    # The seventh normal recording provides partial renderer ownership sidecars.
    recorded=json.loads((ROOT/'.board/occlusion-recorded/manifest.json').read_text())
    for r in recorded['samples']:
        source=Path(recorded['session'])/r['source_json']; d=json.loads(source.read_text())
        image=Path(recorded['session'])/d['rgb']
        with Image.open(image) as im:w,h=im.size
        candidates.append(dict(id='ownership-'+r['id'],video='ownership',video_file=recorded['video'],split='train',frame=r['frame'],render_frame=r['frame'],quad=r['quad'],width=w,height=h,phase=phase(*r['expected'][:2]),source='partial_ownership',source_json=str(source),source_rgb=str(image),source_rgb_sha256=d['rgb_sha256'],warning_count=r['warning_count'],global_ground_truth=False,legacy_quality_screened=True))
    summaries.append(dict(name='ownership',video=recorded['video'],split='train',available_crops=len(recorded['samples']),status='partial_ownership_sidecars',reason='Real RGB; recorder warnings retained; geometry screening still required'))
    (OUT/'inventory.json').write_text(json.dumps(dict(recordings=summaries,protocol=dict(stride=11,min_visibility=.95,max_candidates_per_frame=8,split='whole video; no target test in selection',excluded='bbox-only captures cannot supply true outlined quads; soul deferred')),indent=2))
    (OUT/'candidates.json').write_text(json.dumps(candidates))
    print(json.dumps(dict(candidates=len(candidates))),flush=True)

if __name__=='__main__':main()
