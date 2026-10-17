"""Frozen policy check on separate recordings, before manual review of decisions."""
import json,subprocess
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
from retention_pilot import OUT,helper,close,evaluate
from prepare import ROOT
from gui_mask_native import mask
from translucency import detect

VIDEOS=['2026-10-15 14-15-51.mkv','2026-10-17 17-04-31.mkv']

def scan(name):
 out=OUT/Path(name).stem;out.mkdir(exist_ok=True)
 ff=ROOT/'FireCrackle/src-tauri/runtime/ffmpeg.exe'
 decoder=subprocess.Popen([str(ff),'-v','error','-threads','2','-i',str(ROOT/'fire-detection/data/video'/name),'-vf','select=not(mod(n\\,120))','-fps_mode','passthrough','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 sat=helper();old=subprocess.Popen([str(ROOT/'.board/portal-undo/fragment-score.exe'),'1920','1080'],stdin=subprocess.PIPE,stdout=subprocess.PIPE);rows=[]
 try:
  while True:
   raw=decoder.stdout.read(1920*1080*3)
   if not raw:break
   assert len(raw)==1920*1080*3
   rgb=np.frombuffer(raw,np.uint8).reshape(1080,1920,3);n=len(rows)*120
   info=mask(rgb,vanilla_confirmed=True);ret=evaluate(rgb,sat,info);material=detect(rgb,info[0])
   old.stdin.write(raw);old.stdin.flush();scores=json.loads(old.stdout.readline());candidate=max(scores['raw']['r4'],scores['auto']['r4'])<2198
   clear_material=candidate and not material['abstain'];clear_final=clear_material and not ret['retain']
   r={'video':name,'frame':n,'seconds':n/60,'candidate_clear':candidate,'clear_material':clear_material,'clear_final':clear_final,'retention':ret,'material':material};rows.append(r)
   Image.fromarray(rgb).resize((960,540)).save(out/f'{n}.jpg',quality=93)
  error=decoder.stderr.read().decode();assert decoder.wait()==0,error
 finally:
  close(sat);close(old);decoder.stdout.close();decoder.stderr.close()
  if decoder.poll() is None:decoder.terminate();decoder.wait()
 (out/'report.json').write_text(json.dumps(rows,indent=2))
 for offset in range(0,len(rows),40):
  sheet=Image.new('RGB',(1200,1272),'#10151d')
  for j,r in enumerate(rows[offset:offset+40]):
   x=j%5*240;y=j//5*159;sheet.paste(Image.open(out/f'{r["frame"]}.jpg').resize((240,135)),(x,y+24));ImageDraw.Draw(sheet).text((x+2,y+3),f'{r["seconds"]:.0f}s clear={r["clear_final"]} menu={r["retention"]["unveiled"]}',fill='red' if r['clear_final'] else 'white')
  sheet.save(out/f'contact-{offset//40}.jpg',quality=95)
 print(json.dumps({'video':name,'frames':len(rows),'component_clears':sum(r['candidate_clear'] for r in rows),'material_clears':sum(r['clear_material'] for r in rows),'final_clears':sum(r['clear_final'] for r in rows),'new_vetoes':[r['seconds'] for r in rows if r['clear_material'] and not r['clear_final']]}),flush=True)
 return rows

if __name__=='__main__':
 with ProcessPoolExecutor(max_workers=2) as pool:rows=sum(pool.map(scan,VIDEOS),[])
 (OUT/'validation.json').write_text(json.dumps({'policy':'Frozen restored-only menu saturated-orange128/24/8, materialv3, canonical GUI defaults. No thresholds changed after reading these recordings. Manual review pending.','cases':rows},indent=2))
