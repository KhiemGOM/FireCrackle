"""Material-veto validation, then regression on the unchanged 91/13 clear cohort."""
import argparse,json,sys,subprocess,time,hashlib
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
from translucency import detect,VERSION
from prepare import ROOT,SOURCES
USE_GUI=False

def classify(rgb):
 if not USE_GUI:return detect(rgb)
 from gui_mask_native import mask
 world,packed,info=mask(rgb,vanilla_confirmed=True)
 result=detect(rgb,world)
 result['gui']=info
 return result

def material_frame(item):
 label,t,use_gui=item
 global USE_GUI
 USE_GUI=use_gui
 command=[str(ROOT/'FireCrackle/src-tauri/runtime/ffmpeg.exe'),'-v','error','-threads','2','-ss',str(t),'-i',str(ROOT/'fire-detection/data/video/2026-10-17 18-28-42.mkv'),'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1']
 raw=subprocess.run(command,stdout=subprocess.PIPE,check=True).stdout
 rgb=np.frombuffer(raw,np.uint8).reshape(1080,1920,3)
 return {'seconds':t,'label':label,'positive':label!='opaque_control','detector':classify(rgb)}

def old_source(item):
 name,use_gui=item
 global USE_GUI
 USE_GUI=use_gui
 cache=ROOT/'.board/no-fire-parallel/fragments'
 selected=[r for r in json.loads((cache/f'{name}.json').read_text()) if r['scores']['all:r4']<2198]
 out=ROOT/'.board/no-fire-parallel/fragment-review/translucency-detector';rows=[]
 for r in selected:
  # Accurate seek to the known CFR frame timestamp; no full-video sparse decode.
  n=r['frame'];command=[str(ROOT/'FireCrackle/src-tauri/runtime/ffmpeg.exe'),'-v','error','-threads','2','-ss',str(n/60),'-i',str(ROOT/'fire-detection/data/video'/SOURCES[name]),'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1']
  raw=subprocess.run(command,stdout=subprocess.PIPE,check=True).stdout
  rgb=np.frombuffer(raw,np.uint8).reshape(1080,1920,3);g=classify(rgb)
  rows.append({'source':name,'frame':n,'fire':r['truth']['substantial'],'detector':g})
  Image.fromarray(rgb).resize((960,540)).save(out/f'{name}-{n}.jpg',quality=92)
 (out/f'{name}.json').write_text(json.dumps(rows,indent=2));return rows

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--old',action='store_true');ap.add_argument('--gui-mask',action='store_true');a=ap.parse_args()
 out=ROOT/'.board/no-fire-parallel/fragment-review/translucency-detector';out.mkdir(parents=True,exist_ok=True)
 new=ROOT/'.board/no-fire-parallel/fragment-review/translucency-new'
 rows=[]
 # Manual material labels selected before the first run. These are development
 # cases: v2/v3 were revised after inspecting sky/cloud false alarms.
 positive={'water':[182,186,190,194,198,202,210,214,220,250,300], 'glass':[432,434,436,440,442,444,448,450,452,454,456], 'portal':[170,174,178,180,404,406,460]}
 negative=[0,2,4,6,8,14,16,18,24,28,40,44,46,50,54,60,62,66,70,74,76,78,408,410,412,416,420,424,428]
 with ProcessPoolExecutor(max_workers=3) as pool:
  rows=list(pool.map(material_frame,[(label,t,a.gui_mask) for label,times in [*positive.items(),('opaque_control',negative)] for t in times]))
 report={'version':VERSION,'material_review':rows,'detector_sha256':hashlib.sha256(Path(__file__).with_name('translucency.py').read_bytes()).hexdigest(),'scope':'Manual material-presence development labels, freshly decoded native1920x1080 RGB frames. V2/V3 revised after sky/cloud false alarms; not held-out validation. Opaque controls may contain small particles; labels target large portal/water/glass surfaces. Not exhaustive alpha truth.'}
 report['material_counts']={label:{'frames':sum(r['label']==label for r in rows),'vetoed':sum(r['label']==label and r['detector']['abstain'] for r in rows)} for label in [*positive,'opaque_control']}
 if a.old:
  with ProcessPoolExecutor(max_workers=3) as pool:old=sum(pool.map(old_source,[(n,a.gui_mask) for n in ['clip1','quad1','survival1']]),[])
  assert len(old)==104
  report['baseline']={'original_TP':sum(not r['fire'] for r in old),'original_FP':sum(r['fire'] for r in old),'remaining_TP':sum(not r['fire'] and not r['detector']['abstain'] for r in old),'remaining_FP':sum(r['fire'] and not r['detector']['abstain'] for r in old),'cases':old}
 if a.gui_mask:
  report['gui_mask']={'enabled':True,'source_sha256':hashlib.sha256((ROOT/'fire-detection/core/src/gui_mask.rs').read_bytes()).hexdigest(),'material_reliable':sum(r['detector']['gui']['reliable'] for r in rows),'material_frames':len(rows),'baseline_reliable':sum(r['detector']['gui']['reliable'] for r in report.get('baseline',{}).get('cases',[])),'baseline_frames':len(report.get('baseline',{}).get('cases',[])),'policy':'Canonical defaults and all local atlases. Known classes1/2 and unknown item/effect/crosshair interiors excluded; unknown edges retained. Unreliable=unavailable, not proof of no GUI. Fire scores unchanged; this experiment changes material veto only.'}
 (out/'report.json').write_text(json.dumps(report,indent=2))
 cards=''.join(f'<article><p>{r["seconds"]}s · {r["label"]} · veto={r["detector"]["abstain"]} · {r["detector"]["reasons"]}</p><a href="../translucency-new/{r["seconds"]*60}.jpg"><img loading="lazy" src="../translucency-new/{r["seconds"]*60}.jpg"></a></article>' for r in rows)
 (out/'index.html').write_text('<!doctype html><meta charset="utf-8"><title>Translucency material detector</title><style>body{background:#10151d;color:white;font:15px system-ui}main{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}img{width:100%}article{border:1px solid #456;padding:10px}</style><h1>Material detection, not fire detection</h1><pre>'+json.dumps(report['material_counts'],indent=2)+'</pre><pre>'+json.dumps({k:v for k,v in report.get('baseline',{}).items() if k!='cases'},indent=2)+'</pre><pre>'+json.dumps(report.get('gui_mask',{}),indent=2)+'</pre><main>'+cards+'</main>',encoding='utf8')
 print(json.dumps(report['material_counts']),flush=True);print(json.dumps({k:v for k,v in report.get('baseline',{}).items() if k!='cases'}),flush=True)

if __name__=='__main__':main()
