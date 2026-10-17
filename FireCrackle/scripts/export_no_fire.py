"""Export the frozen V3 model. Conversion only: never trains or changes calibration."""
import argparse, hashlib, json, math
from pathlib import Path
CHECKPOINT_SHA='4542be2d4ac9f9f9df5dbb9b0a7d1a05a94241b6292cb7e7259ea8bed0d1548a'
THRESHOLD=-1.7570972442626953

def verify_checkpoint(path):
    if hashlib.sha256(Path(path).read_bytes()).hexdigest()!=CHECKPOINT_SHA:raise ValueError('Frozen checkpoint hash mismatch')
def is_clear(score):return math.isfinite(score) and score<THRESHOLD-0.0001

def export(checkpoint,output):
    verify_checkpoint(checkpoint)
    import torch
    from torchvision.models import mobilenet_v3_small
    torch.set_num_threads(2)
    class BagModel(torch.nn.Module):
        def __init__(self):
            super().__init__();self.features=mobilenet_v3_small(weights=None).features
            self.head=torch.nn.Sequential(torch.nn.Linear(576,128),torch.nn.ReLU(),torch.nn.Dropout(.2),torch.nn.Linear(128,1))
        def forward(self,x):return self.head(self.features(x).mean((2,3))).squeeze(-1)
    class InputModel(torch.nn.Module):
        def __init__(self,model):super().__init__();self.model=model
        def forward(self,x):
            x=x.permute(0,3,1,2)/255.
            mean=x.new_tensor([.485,.456,.406])[None,:,None,None]
            std=x.new_tensor([.229,.224,.225])[None,:,None,None]
            return self.model((x-mean)/std)
    model=BagModel().eval();model.load_state_dict(torch.load(checkpoint,map_location='cpu',weights_only=False)['state'])
    model=InputModel(model).eval();output=Path(output);output.parent.mkdir(parents=True,exist_ok=True)
    dummy=torch.zeros((1,224,224,3),dtype=torch.float32)
    torch.onnx.export(model,dummy,str(output),input_names=['pixels'],output_names=['fire_logit'],opset_version=17,dynamo=False)
    import onnx,onnxruntime as ort,numpy as np
    onnx.checker.check_model(str(output))
    options=ort.SessionOptions();options.intra_op_num_threads=2;options.inter_op_num_threads=1
    session=ort.InferenceSession(str(output),sess_options=options,providers=['CPUExecutionProvider'])
    rng=np.random.default_rng(179);errors=[]
    for arr in [np.zeros((1,224,224,3),np.float32),np.full((1,224,224,3),255,np.float32),rng.integers(0,256,(1,224,224,3)).astype(np.float32)]:
        with torch.inference_mode():expected=float(model(torch.from_numpy(arr))[0])
        actual=float(session.run(None,{'pixels':arr})[0][0]);errors.append(abs(expected-actual))
    if max(errors)>1e-4:raise ValueError(f'ONNX parity failed: {errors}')
    manifest={'schema':1,'name':'FireCrackle no-fire MobileNetV3 V3','checkpoint_sha256':CHECKPOINT_SHA,'onnx_sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'threshold':THRESHOLD,'opset':17,'input_shape':[1,224,224,3],'input_type':'float32 RGB 0..255','parity_max_error':max(errors)}
    output.with_suffix('.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps(manifest))
def calibrate(model,dataset,output):
    """Audit only the original reserved calibration split; never select evaluation IDs."""
    import numpy as np, onnxruntime as ort
    dataset=Path(dataset)
    expected='df5d5fd734f3305e3be6eb429b274f46c431d181080d1e796eeb0d5d960f76fe'
    if hashlib.sha256(dataset.read_bytes()).hexdigest()!=expected:raise ValueError('Reserved calibration dataset hash mismatch')
    rows=[r for r in json.loads(dataset.read_text())['rows'] if r['source']=='clip2']
    if len(rows)!=218 or sum(r['fire'] for r in rows)!=125:raise ValueError('Calibration cohort changed')
    options=ort.SessionOptions();options.intra_op_num_threads=2;options.inter_op_num_threads=1
    options.enable_mem_pattern=False;options.add_session_config_entry('session.intra_op.allow_spinning','0')
    session=ort.InferenceSession(str(model),sess_options=options,providers=['CPUExecutionProvider'])
    predictions=[]
    for row in rows:
        views=np.load(dataset.parent/row['file']).astype(np.float32)
        score=max(float(session.run(None,{'pixels':v[None]})[0][0]) for v in views)
        predictions.append({'frame':row['frame'],'fire':row['fire'],'score':score})
    threshold=min(r['score'] for r in predictions if r['fire'])
    report={'threshold':threshold,'rounding_abstention_margin':.0001,'dataset_sha256':expected,'onnx_sha256':hashlib.sha256(Path(model).read_bytes()).hexdigest(),'frames':predictions}
    Path(output).write_text(json.dumps(report,indent=2)+'\n')
    if abs(threshold-THRESHOLD)>1e-5:raise ValueError('Portable calibration drift: inspect, do not automatically retune')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('checkpoint',type=Path);parser.add_argument('output',type=Path);parser.add_argument('--calibration-dataset',type=Path);args=parser.parse_args();export(args.checkpoint,args.output)
    if args.calibration_dataset:calibrate(args.output,args.calibration_dataset,args.output.with_suffix('.calibration.json'))
