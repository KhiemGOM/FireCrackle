"""Audit hand-mask intervention counts without changing annotations."""
import json,hashlib
from pathlib import Path
import numpy as np
from prepare import ROOT,OUT
from masks import fields


def main():
    r=json.loads((OUT/'results.json').read_text());manifest=json.loads((OUT/'manifest.json').read_text());freeze=json.loads((OUT/'mask-freeze.json').read_text())
    assert r['annotation_sha256']==freeze['annotation_sha256']==hashlib.sha256(Path(__file__).with_name('annotations.json').read_bytes()).hexdigest()
    assert freeze['manifest_sha256']==hashlib.sha256((OUT/'manifest.json').read_bytes()).hexdigest()
    review=json.loads(Path(__file__).with_name('annotations.json').read_text())
    for case in review['cases']:
        for name,value in fields(case).items():assert np.array_equal(value,np.fromfile(OUT/f"{case['code']}.{name}",'<f4').reshape(64,64))
    assert r['n']==50==len({x['frame'] for x in r['rows']})
    for name,digest in r['hashes'].items():assert hashlib.sha256((ROOT/f'FireCrackle/src/lib/{name}.ts').read_bytes()).hexdigest()==digest
    cases={x['sample']['id']:x for x in manifest['cases']};old={}
    for dataset in ['survival-exact','additional-exact']:
        source=json.loads((ROOT/'.board/occlusion-mask/survival/scores'/dataset/'results.json').read_text())
        old.update({x['id']:x['methods']['colour'] for x in source['rows']})
    for row in r['rows']:
        assert row['methods']['baseline']['top']==old[row['id']]['top']
        assert row['methods']['baseline']['correct']==old[row['id']]['correct']
        assert row['expected']==cases[row['id']]['sample']['expected']
        for name,value in row['methods'].items():
            assert value['score']<=row['methods']['baseline']['score']+1e-10
            assert value['weight']<=row['methods']['baseline']['weight']+1e-10
    changes={};ci={};rng=np.random.default_rng(1703);draws=rng.integers(0,50,(10000,50))
    for name,m in r['summary'].items():
        assert m['top1']==sum(x['methods'][name]['correct'] for x in r['rows'])
        assert m['nonzeroCorrect']==sum(x['methods'][name]['nonzeroCorrect'] for x in r['rows'])
        assert m['wrongClear']==sum(x['methods'][name]['clear'] and not x['methods'][name]['correct'] for x in r['rows'])
        delta=np.array([int(x['methods'][name]['correct'])-int(x['methods']['baseline']['correct']) for x in r['rows']])
        ci[name]=np.quantile(100*delta[draws].mean(1),[.025,.975]).tolist()
        changes[name]=[dict(code=x['code'],id=x['id'],before=x['methods']['baseline']['correct'],after=x['methods'][name]['correct']) for x in r['rows'] if x['methods'][name]['correct']!=x['methods']['baseline']['correct']]
    result=dict(summary=r['summary'],ci_percentage_points=ci,changes=changes,annotation_sha256=r['annotation_sha256'])
    (OUT/'audit.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))


if __name__=='__main__':main()
