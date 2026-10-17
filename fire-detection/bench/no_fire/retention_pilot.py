"""Freeze a small saturated-orange veto and test it against existing clear outputs."""
import argparse,hashlib,json,subprocess
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
from prepare import ROOT,SOURCES
from veil_native import apply
from gui_mask_native import mask

OUT=ROOT/'.board/no-fire-parallel/fragment-review/retention'

def retain_policy(unveiled,evidence):
 # Only restored evidence after a confirmed veil supports the extra small-fire
 # rule. Raw GUI colours must not acquire a globally lower threshold.
 return bool(unveiled and evidence and evidence[-1]['retain'])

def evaluate(rgb,helper,world_info=None):
 world,packed,gui=mask(rgb,vanilla_confirmed=True) if world_info is None else world_info
 answers=[]
 fixed,used,share=apply(rgb,y0=12)
 for a in [rgb,fixed] if used else [rgb]:
  helper.stdin.write(a.tobytes());helper.stdin.write(world.tobytes());helper.stdin.flush();answers.append(json.loads(helper.stdout.readline()))
 return {'retain':retain_policy(used,answers),'evidence':answers,'gui':gui,'unveiled':used}

def helper():
 return subprocess.Popen([str(OUT/'score.exe'),'1920','1080'],stdin=subprocess.PIPE,stdout=subprocess.PIPE)

def close(p):p.stdin.close();p.stdout.close();assert p.wait()==0

def source(name):
 old=json.loads((ROOT/'.board/no-fire-parallel/fragment-review/translucency-detector'/f'{name}.json').read_text());score=helper();rows=[]
 try:
  for row in old:
   n=row['frame'];raw=subprocess.check_output([str(ROOT/'FireCrackle/src-tauri/runtime/ffmpeg.exe'),'-v','error','-threads','2','-ss',str(n/60),'-i',str(ROOT/'fire-detection/data/video'/SOURCES[name]),'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'])
   rgb=np.frombuffer(raw,np.uint8).reshape(1080,1920,3);e=evaluate(rgb,score)
   rows.append({**row,'retention':e,'clear_after_material':not row['detector']['abstain'],'clear_after_both':not row['detector']['abstain'] and not e['retain']})
 finally:close(score)
 (OUT/f'{name}.json').write_text(json.dumps(rows,indent=2));return rows

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--single',action='store_true');ap.add_argument('--reuse-evidence',action='store_true');a=ap.parse_args();OUT.mkdir(parents=True,exist_ok=True)
 if a.single:
  p=helper();e=evaluate(np.asarray(Image.open(OUT/'41850.png').convert('RGB')),p);close(p);print(json.dumps(e));return
 if a.reuse_evidence:
  rows=json.loads((OUT/'report.json').read_text())['cases']
  for r in rows:
   e=r['retention'];e['retain']=retain_policy(e['unveiled'],e['evidence']);r['clear_after_both']=r['clear_after_material'] and not e['retain']
 else:
  with ProcessPoolExecutor(max_workers=3) as pool:rows=sum(pool.map(source,['clip1','quad1','survival1']),[])
 assert len(rows)==104
 counts=lambda key:{'TP':sum(r[key] and not r['fire'] for r in rows),'FP':sum(r[key] and r['fire'] for r in rows)}
 report={'before':counts('clear_after_material'),'after':counts('clear_after_both'),'cases':rows,'rules_sha256':hashlib.sha256(Path(__file__).with_name('retention_rules.rs').read_bytes()).hexdigest(),'protocol':'Strong orange R>=96,.30R<=G<=.85R,B<=.25R,R-B>=80;8connected area>=128,width>=24,height>=8. Extra veto ONLY on restored RGB after confirmed shared automatic unveil, canonical GUI exclusion. Policy refined on original104clear cohort; development, not independent.'}
 (OUT/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps({'before':report['before'],'after':report['after'],'newly_retained':[(r['source'],r['frame'],r['fire']) for r in rows if r['clear_after_material'] and not r['clear_after_both']]}),flush=True)

if __name__=='__main__':main()
