"""Apply explicit visual review IDs; never inspect model predictions."""
import argparse,collections,json
from pathlib import Path
import numpy as np


def main():
    ap=argparse.ArgumentParser();ap.add_argument('source',type=Path);ap.add_argument('review',type=Path);ap.add_argument('out',type=Path);args=ap.parse_args()
    m=json.loads((args.source/'manifest.json').read_text());review=json.loads(args.review.read_text())
    if m['joined_sha256']!=review['source_joined_sha256'] or m['screening']!=review['screening']:raise ValueError('Review does not match this source/screening')
    args.out.mkdir(parents=True,exist_ok=True);summary={}
    for split in ['train','val']:
        data=np.load(args.source/f'{split}.npz');cases=[c for c in m['samples'] if c['split']==split];accepted=set(review[split]);ids=[i for i,c in enumerate(cases) if c['id'] in accepted]
        if len(ids)!=len(accepted):raise ValueError('Missing or duplicated reviewed IDs')
        np.savez_compressed(args.out/f'{split}.npz',x=data['x'][ids],y=data['y'][ids])
        summary[split]=dict(crops=len(ids),frames=len(set(cases[i]['frame'] for i in ids)),classes=len(set(data['y'][ids].tolist())),sources=dict(collections.Counter(cases[i]['source'] for i in ids)))
    (args.out/'review.json').write_text(json.dumps(review,indent=2));(args.out/'summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary),flush=True)


if __name__=='__main__':main()
