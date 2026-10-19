"""Account for every original clip and derived family; no quiet cache concatenation."""
import collections
import hashlib
import json
from pathlib import Path
import subprocess
from inventory import ROOT,OUT,digest

def main():
    catalogue=ROOT/'docs/TRAINING_DATA_INVENTORY.json'
    physical=json.loads(catalogue.read_text());inventory=json.loads((OUT/'inventory.json').read_text());run=json.loads((OUT/'manifest.json').read_text());rows=run['samples']
    known={r['video']:r for r in inventory['recordings']};sources=[]
    for path in sorted((ROOT/'fire-detection/data/video').glob('*')):
        if path.suffix.lower() not in {'.mkv','.mp4'}:continue
        entry=known.get(path.name)
        selected=[r for r in rows if r['video_file']==path.name]
        role=entry['split'] if entry else 'excluded'
        if role=='inventory_only':role='excluded'
        reason=('Whole-recording split, native real RGB, geometry-only eligibility; normal material only.' if selected else 'No per-plane quad corners in the joined historical schema; boxes cannot rectify true manual quads.' if entry else 'No qualified aligned renderer quad truth registered for this short pilot; app/prediction labels are not renderer truth.')
        sources.append(dict(recording=str(path.relative_to(ROOT)),role=role,material='normal_fire',samples_used=len(selected),frames_used=len({r['frame'] for r in selected}),reason=reason,video_sha256=digest(path),labels_sha256=entry.get('joined_sha256') if entry else None,provenance=entry))
    families=[dict(family=family,role='train' if family=='recorded partial ownership' else 'excluded',reason=reason) for family,reason in [
        ('bounding boxes / presence / first-person pools','Task/input mismatch: no exact world-quad geometry; no pseudo-label substitution.'),
        ('synthetic / codec / backgrounds','Owner requests actual fire crops only; descendants add no independent recorded phase observations.'),
        ('old row32 / row32-large checkpoints','Synthetic-fire-trained checkpoints excluded from initialization; generic ImageNet only.'),
        ('old normal quad caches / rough-exact / GUI ownership evaluations','Overlap with fresh native candidates; never count duplicate cache variants as new recordings.'),
        ('recorded partial ownership','Included once via locally audited mapped planes; warnings retained, 69 geometry-qualified crops. Not global oracle.'),
        ('soul-fire pixels','Deferred separate-colour model; current run uses only normal fires from the newest mixed capture.'),
        ('Jolt / cut edits / app auto-labels','Clock/prediction/derived evidence is not new renderer sprite supervision.')]]
    ownership=[]
    for session in physical['ownership']:
        path=session['path'];used=path.endswith('ebe022b2-f48a-456d-8c2c-169aedede5f9')
        ownership.append(dict(path=path,role='train' if used else 'excluded',samples_used=69 if used else 0,reason='Previously locally audited mapped planes only; current geometry screen and fresh shared unveil; warnings retained.' if used else 'Pending local ownership audit, outside the frozen audited ebe training pool. aa9 lacks known-fire evidence metadata; e6 has451 rejected samples and8 unvalidated. Neither is proven to contain zero usable phase crops.',metadata=session))
    result=dict(task='normal_fire_32_animation_phase',catalogue='docs/TRAINING_DATA_CATALOGUE.md',inventory_sha256=digest(catalogue),catalogue_commit=subprocess.check_output(['git','-c',f'safe.directory={ROOT.as_posix()}','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),catalogue_uncommitted_at_preparation=bool(subprocess.check_output(['git','-c',f'safe.directory={ROOT.as_posix()}','status','--porcelain','--','docs/TRAINING_DATA_CATALOGUE.md','docs/TRAINING_DATA_INVENTORY.json'],cwd=ROOT,text=True)),sources=sources,ownership=ownership,dataset_families=families,split=run['splits'],preprocessing=run['preprocessing'],dataset_sha256=run['dataset_sha256'],sampling='stride11 unique rendered frame; at most8 candidates/frame sorted by minimum edge; >=95% recorded visibility; fully onscreen; >=3 native px/texel; <=2.5 directional stretch; no colour/template filter on fresh joins; ownership subset was historically locally audited')
    (OUT/'coverage.json').write_text(json.dumps(result,indent=2));print(json.dumps(dict(originals=len(sources),used=sum(s['samples_used'] for s in sources),roles=dict(collections.Counter(s['role'] for s in sources)))),flush=True)

if __name__=='__main__':main()
