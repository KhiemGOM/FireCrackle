"""Record hashes and explicit pilot coverage; never copy private pixels into source."""
import hashlib,json,platform
from pathlib import Path
import cv2,numpy as np
ROOT=Path(__file__).resolve().parents[4];OUT=ROOT/'.board/ecc-align'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
    cases=json.loads((OUT/'cases.json').read_text());inventory=json.loads((ROOT/'docs/TRAINING_DATA_INVENTORY.json').read_text())
    used={r['video_file'] for r in cases}
    sources=[dict(path=v['path'],role='evaluation' if Path(v['path']).name in used else 'excluded',reason='Fixed 64-case material cohort from existing held-out cache' if Path(v['path']).name in used else 'Explicit small deterministic alignment pilot; no training, calibration or all-data claim') for v in inventory['videos'] if v['role']=='original']
    files={r['pixels'] for r in cases}|{f'.board/ecc-align/{m}-{s}.rgba' for m in ['normal','soul'] for s in [0,1]}
    output=dict(catalogue='docs/TRAINING_DATA_CATALOGUE.md',sources=sources,plan=json.loads((OUT/'plan.json').read_text()),versions=dict(python=platform.python_version(),opencv=cv2.__version__,numpy=np.__version__),private_input_hashes={f:sha(ROOT/f) for f in sorted(files)},source_hashes=json.loads((OUT/'baseline.json').read_text())['source_hashes'],case_manifest_sha256=sha(OUT/'cases.json'),checks=dict(frozen_scorer_max_error=max(r['error'] for r in json.loads((OUT/'parity.json').read_text())['rows']),unique_renderer_frames={m:len({r['render_frame'] for r in cases if r['material']==m}) for m in ['normal','soul']}))
    output['experiment_source_hashes']={p.name:sha(p) for p in Path(__file__).parent.iterdir() if p.suffix in ['.py','.mjs']}
    (OUT/'provenance.json').write_text(json.dumps(output,indent=2))
    print('Provenance recorded for',len(cases),'real cases')
if __name__=='__main__':main()
