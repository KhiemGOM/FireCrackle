"""Fixed already-approved fusion; no fitting/selection on either test cohort."""
import json,hashlib,sys
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[5];OUT=ROOT/'.board/soul-phase128'
def softmax(x):
 x=x-x.max(1,keepdims=True);p=np.exp(x);return p/p.sum(1,keepdims=True)
def metrics(p,y):
 rank=np.argsort(-p,axis=1,kind='stable');hit=(rank[:,:3]==y[:,None]).any(1)
 return dict(n=len(y),top1=int((rank[:,0]==y).sum()),top3=int(hit.sum()),top3_accuracy=float(hit.mean()))
def main():
 meta=json.loads((OUT/'manifest.json').read_text());rows=meta['samples'];cnn=np.load(OUT/'predictions.npz');manual=json.loads((OUT/'matcher.json').read_text());byid={r['id']:r for r in manual['rows']};result={}
 for name,indices,logits in [('calibration',cnn['calibration_indices'],cnn['calibration_logits']),('tests',cnn['indices'],cnn['logits'])]:
  aligned=[byid[rows[i]['id']] for i in indices];y=np.array([rows[i]['phase'] for i in indices]);c=softmax(logits);s=np.array([r['scores'] for r in aligned]);usable=np.array([r['usable'] for r in aligned]);m=np.where(usable[:,None],softmax(s/.01),1/32);f=.25*c+.75*m
  for video in sorted({rows[i]['video'] for i in indices}):
   take=np.array([rows[i]['video']==video for i in indices]);rr=[r for r,t in zip(aligned,take) if t];yy=y[take]
   baseline=dict(n=len(rr),top1=sum(r['usable'] and r['top3'][0]==int(truth) for r,truth in zip(rr,yy)),top3=sum(r['usable'] and int(truth) in r['top3'] for r,truth in zip(rr,yy)),unusable=sum(not r['usable'] for r in rr));baseline['top3_accuracy']=baseline['top3']/baseline['n']
   result[name+'_'+video]=dict(deterministic=baseline,cnn128=metrics(c[take],yy),fusion=metrics(f[take],yy))
 report=dict(plan=json.loads((OUT/'plan.json').read_text()),results=result,cnn_training=json.loads((OUT/'cnn-results.json').read_text()),cpu_speed=json.loads((OUT/'cpu-speed.json').read_text()),matcher={k:v for k,v in manual.items() if k!='rows'},dataset_sha256=meta['dataset_sha256'],shared_preprocessing=meta['preprocessing'],coverage_sha256=hashlib.sha256((OUT/'coverage.json').read_bytes()).hexdigest(),source_hashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in Path(__file__).parent.iterdir() if p.suffix in ['.py','.mjs']},limitations='New evaluation is a separate video from same game session/world; correlated quads, not independent scenes. Older secondary check has only13frames and is familiar. Fixed original-quad matcher, no geometry refinement. Timing is PyTorch model-only, not app ONNX or end-to-end. No app changes or deployment.')
 (OUT/'results.json').write_text(json.dumps(report,indent=2));(Path(__file__).parent/'results.json').write_text(json.dumps(report,indent=2));(Path(__file__).parent/'coverage.json').write_text((OUT/'coverage.json').read_text());(Path(__file__).parent/'plan.json').write_text((OUT/'plan.json').read_text());print(json.dumps(result,indent=2))
if __name__=='__main__':main()
