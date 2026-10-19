"""Validate exact cohort/phase parity and register the approved resolution ablation."""
import hashlib
import json
from pathlib import Path
import subprocess
import numpy as np

ROOT=Path(__file__).resolve().parents[5];OLD=ROOT/'.board/row32-real';OUT=ROOT/'.board/row32-128'
def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def main():
    previous=json.loads((OLD/'manifest.json').read_text());current=json.loads((OUT/'manifest.json').read_text())
    assert len(current['samples'])==3780
    fields=['id','video','frame','render_frame','split','phase','quad','source']
    assert all(all(a[k]==b[k] for k in fields) for a,b in zip(previous['samples'],current['samples']))
    assert current['preprocessing']==previous['preprocessing'];assert current['splits']==previous['splits']
    current['preparation_source_hashes']={str(p.relative_to(ROOT)):digest(p) for p in [Path(__file__).with_name('prepare.py'),ROOT/'FireCrackle/scripts/fire-ai/render.py',ROOT/'FireCrackle/scripts/fire-ai/row32/real/prepare.py']}
    (OUT/'manifest.json').write_text(json.dumps(current,indent=2))
    with np.load(OUT/'real.npz') as new,np.load(OLD/'real.npz') as old:
        assert new['x'].shape==(3780,128,128,3)
        for key in ['y','split','video']:assert np.array_equal(new[key],old[key])
    coverage=json.loads((OLD/'coverage.json').read_text())
    coverage.update(dataset_sha256=current['dataset_sha256'],reference64_dataset_sha256=previous['dataset_sha256'],input_size=128,experiment='Owner-approved real-only resolution ablation; same frozen cohorts,3fit sources/1cal/1test recording; no preprocessing or ensembles in this run',inventory_sha256=digest(ROOT/'docs/TRAINING_DATA_INVENTORY.json'),catalogue_commit=subprocess.check_output(['git','-c',f'safe.directory={ROOT.as_posix()}','rev-parse','HEAD'],cwd=ROOT,text=True).strip())
    (OUT/'coverage.json').write_text(json.dumps(coverage,indent=2))
    (OUT/'plan.json').write_text(json.dumps(dict(approved_by='Owner: sure,I agree; revised duration approved with manual early stopping',architecture='resnet101',input_size=128,fit=3006,calibration=157,test=617,max_epochs=12,manual_early_stop='review calibration loss every epoch; request graceful stop after3 consecutive epochs without a new minimum, minimum4epochs; test untouched until stop',steps=32,batch=64,microbatch=32,seed=219,initialization='generic ImageNet',synthetic_fire=False,preprocessing='unchanged shared automatic unveil; optional preprocessing and ensembles later, separate agreed plan',selection='calibration cross entropy; no target-test selection'),indent=2))
    print(json.dumps(dict(parity='passed',cases=3780,shape=[3780,128,128,3],splits=current['splits'])),flush=True)

if __name__=='__main__':main()
