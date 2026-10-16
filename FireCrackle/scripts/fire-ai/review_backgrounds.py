"""Apply explicit frame-level background exclusions after visual review."""
import argparse,hashlib,json
from pathlib import Path
import numpy as np


def main():
    ap=argparse.ArgumentParser();ap.add_argument('source',type=Path);ap.add_argument('review',type=Path);ap.add_argument('out',type=Path);args=ap.parse_args()
    args.out.mkdir(parents=True,exist_ok=True);manifest=json.loads((args.source/'manifest.json').read_text());review=json.loads(args.review.read_text())
    manifest['review']=review
    for split in ['train','val']:
        source=manifest['sources'][split];excluded=set(review['excluded_frames'][split]);data=np.load(args.source/f'{split}.npz')['x']
        if not excluded<=set(source['frames']):raise ValueError('Review source mismatch')
        ids=[i for i,p in enumerate(source['patches']) if p['frame'] not in excluded]
        np.savez_compressed(args.out/f'{split}.npz',x=data[ids]);source['patches']=[source['patches'][i] for i in ids];source['frames']=[n for n in source['frames'] if n not in excluded]
        print(split,len(source['frames']),len(ids),flush=True)
    (args.out/'manifest.json').write_text(json.dumps(manifest,indent=2))


if __name__=='__main__':main()
