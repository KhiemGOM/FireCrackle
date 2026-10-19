"""Direct32 data; shared native unveil only, no new inverse or segmentation."""
import argparse, hashlib, json, sys
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(ROOT/'FireCrackle/scripts/fire-ai'))
sys.path.insert(0,str(ROOT/'fire-detection/bench/no_fire'))
from render import rectify
from veil_native import apply as unveil

def prepare(directory):
    directory=Path(directory);rows=json.loads((directory/'selected.json').read_text());xs=[];last=None;applied=[]
    for row in rows:
        key=(row['kind'],row['frame'])
        if key!=last:
            image=np.fromfile(Path(row['dir'])/f"{row['frame']}.rgb",np.uint8).reshape(row['height'],row['width'],3)
            if row['kind']=='orange':
                image,changed,_=unveil(image)
                if changed:
                    applied.append(key);target=directory/'unveiled';target.mkdir(exist_ok=True);image.tofile(target/f"{row['frame']}.rgb")
            last=key
        xs.append(rectify(image,np.array(row['quad'])*[row['width'],row['height']]))
    # Soul prepared frames have already passed the shared automatic unveil.
    # Orange controls can only reuse historical scores when pixels are unchanged.
    (directory/'unveiled.json').write_text(json.dumps(applied))
    np.savez_compressed(directory/'real.npz',x=np.stack(xs),y=np.array([r['phase'] for r in rows]),kind=np.array([r['kind'] for r in rows]),split=np.array([r['split'] for r in rows]))
    sheets=[]
    for kind in ['orange','soul']:
        for s in [0,1]:
            source=ROOT/(f'fire-detection/data/assets/fire_{s}.rgba' if kind=='orange' else f'.board/soul-quad/real/soul_{s}.rgba')
            atlas=np.fromfile(source,np.uint8).reshape(32,16,16,4)
            if kind=='orange' and s==0:atlas=np.concatenate([atlas[16:],atlas[:16]])
            sheets.append(atlas)
    np.save(directory/'sprites.npy',np.stack(sheets))
    (directory/'data-hashes.json').write_text(json.dumps(dict(selected=hashlib.sha256((directory/'selected.json').read_bytes()).hexdigest(),real=hashlib.sha256((directory/'real.npz').read_bytes()).hexdigest(),sprites=hashlib.sha256((directory/'sprites.npy').read_bytes()).hexdigest(),orange_unveil_applied=applied),indent=2))
    print(json.dumps(dict(crops=len(xs),shape=list(np.stack(xs).shape),orange_unveil_applied=applied)),flush=True)

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('directory');prepare(ap.parse_args().directory)
