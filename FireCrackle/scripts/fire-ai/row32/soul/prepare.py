"""Approved real-only soul-fire cohorts; native decoding and canonical unveil."""
import collections,hashlib,importlib.util,json,subprocess,sys,time
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[5];OUT=ROOT/'.board/soul-phase128'
sys.path[:0]=[str(Path(__file__).parents[1]/'real'),str(ROOT/'FireCrackle/scripts/fire-ai'),str(ROOT/'fire-detection/bench/no_fire')]
from render import rectify
from veil_native import apply as unveil
spec=importlib.util.spec_from_file_location('real_frame_prepare',Path(__file__).parents[1]/'real/prepare.py')
real_prepare=importlib.util.module_from_spec(spec);spec.loader.exec_module(real_prepare)
expression,read_exact=real_prepare.expression,real_prepare.read_exact

def digest(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def main():
 OUT.mkdir(exist_ok=True);started=time.perf_counter();rows=[];provenance={}
 for name,alias,role in [('soul-12m','new_soul12','train'),('soul-holdout','soul_holdout','test')]:
  directory=ROOT/'.board'/name;summary=json.loads((directory/'audit.json').read_text())
  for r in json.loads((directory/'selected.json').read_text())['samples']:
   if r['material']=='soul':rows.append({**r,'id':alias+'-'+r['id'],'video':alias,'video_file':Path(summary['video']).name,'split':role})
  provenance[alias]={k:summary[k] for k in ['video','video_sha256','joined_sha256','snapshot']}
 old=json.loads((ROOT/'.board/row32/selected.json').read_text())
 for r in old:
  if r['kind']!='soul':continue
  role='calibration' if r['split']=='tune' else 'test'
  rows.append({**r,'id':'older-'+r['id'],'video':'older_soul','video_file':'2026-10-19 16-49-48.mkv','split':role,'material':'soul'})
 expected={'train':2350,'calibration':178,'test':2098}
 assert dict(collections.Counter(r['split'] for r in rows))==expected
 assert len({r['id'] for r in rows})==len(rows)
 assert all(0<=r['phase']<32 for r in rows)
 assert max(r['frame'] for r in rows if r['split']=='calibration')<5881
 assert min(r['frame'] for r in rows if r['video']=='older_soul' and r['split']=='test')>=6120
 pre={f:digest(ROOT/'fire-detection/core/src'/f) for f in ['veil.rs','veil_abi.rs','portal.rs']}
 plan=dict(material='soul_fire_blocks',model='128px ResNet101; generic ImageNet, no fire-trained checkpoint',train=2350,calibration=178,test_new=1983,test_older=115,max_epochs=12,patience=3,min_epochs=4,steps=32,batch=64,microbatch=32,seed=219,metric='animation phase in one ranked top3',fusion=dict(cnn_weight=.25,deterministic_temperature=.01),budget='20–30 minutes estimated; stop after12epochs or early stopping',synthetic_fire=False,augmentation='horizontal flip, brightness .85–1.15, Gaussian noise1.5/255',preprocessing=pre)
 (OUT/'plan.json').write_text(json.dumps(plan,indent=2))
 inventory=json.loads((ROOT/'docs/TRAINING_DATA_INVENTORY.json').read_text());sources=[]
 for v in inventory['videos']:
  if v['role']!='original':continue
  rr=[r for r in rows if Path(v['path']).name==r['video_file']]
  sources.append(dict(recording=v['path'],roles=dict(collections.Counter(r['split'] for r in rr)),samples_used=len(rr),reason='Approved soul-fire cohort; per-target renderer labels and readable geometry' if rr else 'Excluded: no audited eligible soul-fire phase labels in this recording; normal-fire targets are a separate model'))
 families=[dict(path=m['path'],role='provenance_only' if any(k in m['path'] for k in ['soul-12m','soul-holdout','soul-quad']) else 'excluded',reason='Use explicitly selected canonical cohorts only; derived cache duplicates, ordinary-fire/other tasks, synthetic data and predictions are not additional soul phase truth') for m in inventory['manifests']]
 coverage=dict(catalogue='docs/TRAINING_DATA_CATALOGUE.md',catalogue_commit=subprocess.check_output(['git','-c','safe.directory='+ROOT.as_posix(),'rev-parse','HEAD'],text=True).strip(),inventory_sha256=digest(ROOT/'docs/TRAINING_DATA_INVENTORY.json'),sources=sources,dataset_families=families,provenance=provenance,older_selection_sha256=digest(ROOT/'.board/row32/selected.json'),preprocessing=pre,session_caveat='new_soul12 and soul_holdout share Minecraft session/world; disjoint rendered frames. Older calibration and secondary test use preserved temporal purge.')
 (OUT/'coverage.json').write_text(json.dumps(coverage,indent=2))
 xs={};metadata={}
 for video in ['new_soul12','older_soul','soul_holdout']:
  rr=[r for r in rows if r['video']==video];byframe=collections.defaultdict(list)
  for r in rr:byframe[r['frame']].append(r)
  frames=sorted(byframe);d=OUT/video;d.mkdir(exist_ok=True);script=d/'select.filter';script.write_text("select='"+expression(frames)+"'")
  command=[str(ROOT/'FireCrackle/src-tauri/runtime/ffmpeg.exe'),'-v','error','-threads','2','-i',str(ROOT/'fire-detection/data/video'/rr[0]['video_file']),'-filter_script:v',str(script),'-frames:v',str(len(frames)),'-fps_mode','passthrough','-pix_fmt','rgb24','-f','rawvideo','pipe:1']
  with (d/'decode.log').open('wb') as err:
   proc=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=err)
   try:
    for i,frame in enumerate(frames):
     rgb=np.frombuffer(read_exact(proc.stdout,1920*1080*3),np.uint8).reshape(1080,1920,3)
     rgb,applied,share=unveil(rgb)
     # Native corrected RGB is retained for deterministic controls, never synthetic.
     if video!='new_soul12':rgb.tofile(d/f'{frame}.rgb')
     for r in byframe[frame]:
      crop=rectify(rgb,np.array(r['quad'])*[1920,1080],size=128)
      xs[r['id']]=crop;metadata[r['id']]={**r,'crop_sha256':hashlib.sha256(crop.tobytes()).hexdigest(),'unveil_applied':bool(applied),'veil_share':float(share)}
     if i%100==0:print(json.dumps(dict(video=video,frames=i+1,total=len(frames),seconds=round(time.perf_counter()-started))),flush=True)
    proc.stdout.close()
    if proc.wait()!=0:raise RuntimeError((d/'decode.log').read_text())
   finally:
    if proc.poll() is None:proc.kill();proc.wait()
 ordered=[metadata[r['id']] for r in rows]
 assert pre=={f:digest(ROOT/'fire-detection/core/src'/f) for f in pre}
 pixels=collections.defaultdict(set)
 for r in ordered:pixels[r['crop_sha256']].add(r['split'])
 cross=sum(len(s)>1 for s in pixels.values())
 if cross:raise ValueError(f'{cross} identical pixel crops cross splits')
 np.savez_compressed(OUT/'real.npz',x=np.stack([xs[r['id']] for r in rows]),y=np.array([r['phase'] for r in rows]),split=np.array([r['split'] for r in rows]),video=np.array([r['video'] for r in rows]))
 summary={s:dict(crops=sum(r['split']==s for r in rows),frames=len({(r['video'],r['frame']) for r in rows if r['split']==s})) for s in expected}
 manifest=dict(samples=ordered,splits=summary,preprocessing=pre,dataset_sha256=digest(OUT/'real.npz'),seconds=time.perf_counter()-started,cross_split_pixel_duplicates=cross)
 (OUT/'manifest.json').write_text(json.dumps(manifest,indent=2));print(json.dumps(dict(done=True,splits=summary,seconds=manifest['seconds'])),flush=True)
if __name__=='__main__':main()
