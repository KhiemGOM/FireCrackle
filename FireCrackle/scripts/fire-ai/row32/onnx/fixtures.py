"""Prepare private real-pixel/ranking bridge fixtures; no fitting or new data."""
import argparse,json,sys
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[5];OUT=ROOT/'.board/row32-onnx'
def prepare():
    meta=json.loads((ROOT/'.board/row32-128/manifest.json').read_text());images=np.load(ROOT/'.board/row32-128/real.npz')['x']
    ids=np.load(ROOT/'.board/row32-128/resnet101/predictions.npz')['indices'][::77];cases=[]
    for i in ids:
        r=meta['samples'][int(i)];images[i].tofile(OUT/f'{r["id"]}-expected.rgb');cases.append({k:r[k] for k in ['id','quad','frame','width','height']})
    (OUT/'pixel-parity.json').write_text(json.dumps(cases));images[int(ids[0])].tofile(OUT/'example.rgb')
    old=np.load(ROOT/'.board/row32-fusion/predictions.npz');rows=[];reports={}
    sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'fusion'))
    from run import softmax,fuse,select,metrics
    for prefix,file in [('calibration_','calibration'),('','test')]:
        z=np.load(OUT/f'{file}.npz');logits=z['logits'];raw=old[prefix+'scores'];valid=old[prefix+'usable'];p=softmax(logits);f=fuse(p,raw,valid,.01,.25)
        for a,b,c,mask in zip(logits,raw,np.argsort(-f,axis=1,kind='stable')[:,:3],valid):
            if mask:rows.append(dict(logits=a.tolist(),scores=b.tolist(),expected=c.tolist()))
        reports[file]=metrics(f,old[prefix+'truth'])
        if prefix:
            choice,_=select(p,raw,valid,old['calibration_truth']);assert choice['temperature']==.01 and choice['cnn_weight']==.25
            reports['calibration_choice']=choice
    assert reports['test']['top3']==514
    (OUT/'fusion-fixtures.json').write_text(json.dumps(rows));(OUT/'fusion-parity.json').write_text(json.dumps(reports,indent=2))
    print(json.dumps(dict(real_pixel_cases=len(cases),usable_rank_vectors=len(rows),fusion=reports)))
def verify():
    import onnxruntime as ort
    cases=json.loads((OUT/'pixel-parity.json').read_text());options=ort.SessionOptions();options.intra_op_num_threads=4
    session=ort.InferenceSession(str(ROOT/'FireCrackle/src-tauri/runtime/ai/quad-phase-v1.onnx'),sess_options=options,providers=['CPUExecutionProvider']);error=0
    for r in cases:
        def run(name):return session.run(None,{'pixels':np.fromfile(OUT/f'{r["id"]}-{name}.rgb',np.uint8).reshape(1,128,128,3).astype(np.float32)})[0][0]
        a,b=run('expected'),run('frontend');error=max(error,float(np.max(abs(a-b))));assert a.argmax()==b.argmax();assert set(a.argsort()[-3:])==set(b.argsort()[-3:])
    result=dict(cases=len(cases),max_logit_error=error,pixel=json.loads((OUT/'pixel-parity-results.json').read_text()))
    (OUT/'frontend-parity.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--verify',action='store_true');args=p.parse_args()
    verify() if args.verify else prepare()
