"""Broad orange rules. Freeze clip2 thresholds before evaluating other recordings."""
import argparse, hashlib, json, subprocess, time
from pathlib import Path
import numpy as np
from PIL import Image
from blob_pilot import truth_rows
from blob_calibration import meaningful
from colour_support import frames,labels,texel_samples
from features import unveil
from prepare import ROOT
from temporal_presence import calibrate,metrics
RULES=['orange','dark','dark_red']
def accepts(c,v):
 r,g,b=c.astype(float).T
 if v==0:return (r>=64)&(g>=.23*r)&(g<=.88*r)&(b<=.5*r)&(r-b>=24)
 if v==1:return (r>=32)&(g>=.23*r)&(g<=.88*r)&(b<=.5*r)&(r-b>=20)
 return (r>=32)&(g>=.12*r)&(g<=.95*r)&(b<=.6*r)&(r-b>=20)
def main():
 ap=argparse.ArgumentParser();ap.add_argument('out',type=Path);ap.add_argument('--threads',type=int,default=2);ap.add_argument('--rescore',action='store_true');args=ap.parse_args();args.out.mkdir(parents=True,exist_ok=True)
 src=Path(__file__).with_name('broad_colour_rules.rs');binary=args.out/'rules.exe';data={};sampled=[];calibration_samples=[]
 protocol={'calibration':'clip2','evaluation':['clip1','quad1','survival1'],'stride':90,'positive':'clear no-fire/negligible;FP=meaningful fire wrongly cleared','size_proxy':'24 native horizontal pixels, no height threshold','GUI':'No GUI removal. Ideal piece masking not available; no rectangular oracle invented.','shared_veil_sha256':hashlib.sha256((ROOT/'fire-detection/core/src/veil.rs').read_bytes()).hexdigest(),'rules_sha256':hashlib.sha256(src.read_bytes()).hexdigest(),'python_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'rules':{'orange':'R>=64,.23R<=G<=.88R,B<=.5R,R-B>=24','dark':'R>=32,.23R<=G<=.88R,B<=.5R,R-B>=20','dark_red':'R>=32,.12R<=G<=.95R,B<=.6R,R-B>=20'},'branches':'max raw and shared automatic unveil','white':'excluded in all variants','selection':'all variants predeclared; thresholds independently zero-FP calibrated clip2 before evaluation; historical projected pixels consulted as diagnostic only'}
 (args.out/'protocol.json').write_text(json.dumps(protocol,indent=2))
 if not args.rescore:
  subprocess.run(['rustc','--edition=2021','-O',str(src),'-o',str(binary)],check=True)
  helper=subprocess.Popen([str(binary.resolve()),'1920','1080'],stdin=subprocess.PIPE,stdout=subprocess.PIPE)
  sprites=[np.asarray(Image.open(ROOT/f'fire-detection/data/assets/fire_{s}.png').convert('RGBA')) for s in range(2)]
 try:
  for name in ['clip2','clip1','quad1','survival1']:
   path=args.out/f'{name}.json';start=time.time()
   if args.rescore:rows=json.loads(path.read_text())
   else:
    truth=truth_rows(name,90,0);lab=labels(name) if name=='clip2' else {};rows=[]
    for n,rgb in frames(name,90,args.threads):
     if n not in truth:continue
     truth[n]['substantial']=meaningful(truth[n]['boxes'],24)
     helper.stdin.write(rgb.tobytes());helper.stdin.flush();e=json.loads(helper.stdout.readline())
     scores={f'{RULES[v]}:{field}':max(e[f'v{v}']['raw'][field],e[f'v{v}']['auto'][field]) for v in range(3) for field in e[f'v{v}']['raw']}
     rows.append({'source':name,'frame':n,'truth':truth[n],'scores':scores})
     if n in lab:
      points=texel_samples(lab[n],sprites,1920,1080)
      if points:
       fixed,_,_=unveil(rgb)
       for x,y,target in points[::max(1,len(points)//32)][:32]:
        # Keep only expected chromatic sprite texels; whites cannot inform an orange range.
        if int(target[0])-int(target[2])>=20:
         calibration_samples.append(fixed[y,x].tolist())
     if len(rows)%100==0:print(name,len(rows),round(time.time()-start),flush=True)
    path.write_text(json.dumps(rows))
   data[name]=rows
   if name=='clip2':
    thresholds={k:calibrate(rows,k,0) for k in rows[0]['scores']};(args.out/'frozen-thresholds.json').write_text(json.dumps(thresholds,indent=2))
    if calibration_samples:
     c=np.array(calibration_samples,dtype=np.uint8);np.save(args.out/'clip2-projected-colours.npy',c)
     print('calibration projected support',len(c),{RULES[v]:int(accepts(c,v).sum()) for v in range(3)},flush=True)
   print(name,'done',len(rows),round(time.time()-start),flush=True)
 finally:
  if not args.rescore:helper.stdin.close();helper.stdout.close();helper.wait()
 evaluation=sum([data[n] for n in protocol['evaluation']],[])
 report={'protocol':protocol,'thresholds':thresholds,'calibration':{k:metrics(data['clip2'],k,t) for k,t in thresholds.items()},'evaluation':{k:metrics(evaluation,k,t) for k,t in thresholds.items()},'per_source':{name:{k:metrics(rows,k,t) for k,t in thresholds.items()} for name,rows in data.items()},'false_clears':{k:[{'source':r['source'],'frame':r['frame'],'boxes':r['truth']['boxes']} for r in evaluation if r['truth']['substantial'] and r['scores'][k]<t] for k,t in thresholds.items()}}
 historical=ROOT/'.board/fire-color-support/pixels.npz'
 if historical.exists():
  z=np.load(historical);c=z['corrected'];expected=z['expected'];c=c[expected[:,0].astype(int)-expected[:,2].astype(int)>=20]
  report['historical_projected_support_diagnostic']={'pixels':len(c),'accepted':{RULES[v]:int(accepts(c,v).sum()) for v in range(3)},'warning':'Historical corrected pixels predate shared unveil; not training or fresh parity evidence.'}
 (args.out/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report['evaluation']),flush=True)
if __name__=='__main__':main()
