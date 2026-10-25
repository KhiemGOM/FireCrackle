"""Export selected soul checkpoint to the existing native ONNX phase ABI."""
import hashlib,json,sys,time
from pathlib import Path
import numpy as np
import torch,onnx,onnxruntime as ort
ROOT=Path(__file__).resolve().parents[5];DATA=ROOT/'.board/soul-phase128';OUT=ROOT/'.board/soul-phase-onnx'
sys.path.insert(0,str(Path(__file__).parents[1]/'real'))
from train import model_for,normalize
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
class InputModel(torch.nn.Module):
 def __init__(self,model):super().__init__();self.model=model
 def forward(self,pixels):return self.model(normalize(pixels.permute(0,3,1,2)/255.))
def main():
 torch.set_num_threads(4);OUT.mkdir(exist_ok=True);saved=torch.load(DATA/'best.pt',map_location='cpu',weights_only=True)
 assert saved['epoch']==5 and saved['dataset_sha256']==json.loads((DATA/'manifest.json').read_text())['dataset_sha256']
 base=model_for('resnet101',False).eval();base.load_state_dict(saved['state_dict']);model=InputModel(base).eval()
 destination=ROOT/'FireCrackle/src-tauri/runtime/models/quad-soul-phase-v1.onnx'
 torch.onnx.export(model,torch.zeros(1,128,128,3),str(destination),input_names=['pixels'],output_names=['phase_logits'],opset_version=17,dynamo=False)
 onnx.checker.check_model(str(destination));opts=ort.SessionOptions();opts.intra_op_num_threads=4;opts.inter_op_num_threads=1
 session=ort.InferenceSession(str(destination),sess_options=opts,providers=['CPUExecutionProvider']);data=np.load(DATA/'real.npz');pred=np.load(DATA/'predictions.npz');rows=json.loads((DATA/'manifest.json').read_text())['samples'];checks=[];fixtures=[]
 indices=list(pred['calibration_indices'][::max(1,len(pred['calibration_indices'])//3)][:3])
 for video in ['older_soul','soul_holdout']:
  bank=[i for i in pred['indices'] if rows[i]['video']==video];indices+=bank[::max(1,len(bank)//3)][:3]
 lookup={int(i):l for i,l in zip(pred['indices'],pred['logits'])};lookup.update({int(i):l for i,l in zip(pred['calibration_indices'],pred['calibration_logits'])})
 for i in indices:
  x=data['x'][i:i+1].astype(np.float32)
  with torch.inference_mode():cpu=model(torch.from_numpy(x)).numpy()[0]
  actual=session.run(None,{'pixels':x})[0][0];error=float(np.max(abs(cpu-actual)));cached_error=float(np.max(abs(actual-lookup[int(i)])))
  assert error<.0001 and cached_error<.02,(i,error,cached_error)
  checks.append(dict(id=rows[i]['id'],cpu_error=error,cached_gpu_error=cached_error));(OUT/f'{len(checks)-1}.rgb').write_bytes(data['x'][i].tobytes());fixtures.append({**rows[i],'index':int(i),'crop_file':f'{len(checks)-1}.rgb'})
 metadata=dict(schema=1,name='FireCrackle soul-fire quad phase ResNet101128',file=destination.name,url=None,sha256=sha(destination),checkpoint_sha256=sha(DATA/'best.pt'),input_shape=[1,128,128,3],output='32 animation-phase logits',cnn_weight=.25,matcher_temperature=.01,provenance='Generic ImageNet initialization, fine-tuned only on real recorded soul-fire quads. Separate from the ordinary-fire model. No synthetic fire examples.',distribution='Hash-pinned model asset required for clean release builds.')
 (ROOT/'FireCrackle/release/quad-soul-phase-model.json').write_text(json.dumps(metadata,indent=2)+'\n');destination.with_suffix('.json').write_text(json.dumps(metadata,indent=2)+'\n')
 report=dict(model=metadata,checks=checks,model_bytes=destination.stat().st_size,source_sha256=sha(__file__))
 (OUT/'export.json').write_text(json.dumps(report,indent=2));(OUT/'fixtures.json').write_text(json.dumps(fixtures));(Path(__file__).with_name('export-results.json')).write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
if __name__=='__main__':main()
