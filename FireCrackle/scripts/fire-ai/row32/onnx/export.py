"""Export frozen normal-fire128px phase CNN; verify existing real-crop outputs."""
import hashlib,json,sys,time
from pathlib import Path
import numpy as np
import torch
import onnx
import onnxruntime as ort
ROOT=Path(__file__).resolve().parents[5]
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'real'))
from train import model_for,normalize
def digest(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def main():
    torch.set_num_threads(4);out=ROOT/'.board/row32-onnx';out.mkdir(exist_ok=True)
    data=ROOT/'.board/row32-128';checkpoint=data/'resnet101/best.pt'
    expected=json.loads((data/'comparison.json').read_text())['models']['128']['checkpoint_sha256'];assert digest(checkpoint)==expected
    class InputModel(torch.nn.Module):
        def __init__(self,model):super().__init__();self.model=model
        def forward(self,pixels):return self.model(normalize(pixels.permute(0,3,1,2)/255.))
    base=model_for('resnet101',False).eval();base.load_state_dict(torch.load(checkpoint,map_location='cpu',weights_only=True)['state_dict'])
    model=InputModel(base).eval();destination=ROOT/'FireCrackle/src-tauri/runtime/models/quad-phase-v1.onnx';destination.parent.mkdir(parents=True,exist_ok=True)
    torch.onnx.export(model,torch.zeros(1,128,128,3),str(destination),input_names=['pixels'],output_names=['phase_logits'],opset_version=17,dynamo=False)
    onnx.checker.check_model(str(destination))
    opts=ort.SessionOptions();opts.intra_op_num_threads=4;opts.inter_op_num_threads=1
    start=time.perf_counter();session=ort.InferenceSession(str(destination),sess_options=opts,providers=['CPUExecutionProvider']);load=time.perf_counter()-start
    images=np.load(data/'real.npz')['x'];cache=np.load(data/'resnet101/predictions.npz');errors=[];agree1=[];agree3=[];probs=[];timings=[];cpu_errors=[]
    for split,indices,logits in [('calibration',cache['calibration_indices'],cache['calibration_logits']),('test',cache['indices'],cache['logits'])]:
        actual=[]
        for i in indices:
            start=time.perf_counter();actual.append(session.run(None,{'pixels':images[i:i+1].astype(np.float32)})[0][0]);timings.append(time.perf_counter()-start)
        actual=np.array(actual);error=float(np.max(abs(actual-logits)));errors.append(error)
        def softmax(x):x=x-x.max(1,keepdims=True);p=np.exp(x);return p/p.sum(1,keepdims=True)
        prob_error=float(np.max(abs(softmax(actual)-softmax(logits))));probs.append(prob_error)
        top1=int((actual.argmax(1)==logits.argmax(1)).sum());agree1.append(top1)
        ranks=np.sort(np.argsort(-actual,axis=1)[:,:3],axis=1);refs=np.sort(np.argsort(-logits,axis=1)[:,:3],axis=1)
        top3=int((ranks==refs).all(1).sum());agree3.append(top3)
        # Old cached CUDA convolutions may use TF32. Check the ONNX conversion
        # against a direct CPU PyTorch reference independently of that cache.
        for j in np.argsort(np.max(abs(actual-logits),axis=1))[-3:]:
            with torch.inference_mode():reference=model(torch.from_numpy(images[indices[j]:indices[j]+1].astype(np.float32))).numpy()[0]
            cpu_error=float(np.max(abs(reference-actual[j])));cpu_errors.append(cpu_error)
            assert cpu_error<.0001,(split,int(indices[j]),cpu_error)
        assert error<.02 and prob_error<.005,(split,error,prob_error)
        np.savez_compressed(out/f'{split}.npz',indices=indices,logits=actual)
        print(json.dumps(dict(split=split,n=len(indices),max_logit_error=error,max_probability_error=prob_error,top1_parity=top1,top3_parity=top3)),flush=True)
    manifest=dict(schema=1,name='FireCrackle normal-fire quad phase ResNet101128',checkpoint_sha256=expected,onnx_sha256=digest(destination),input_shape=[1,128,128,3],input_type='float32 RGB0..255',output='32 animation-phase logits',opset=17,cnn_weight=.25,matcher_temperature=.01,preprocessing=json.loads((data/'manifest.json').read_text())['preprocessing'],cpu_session_load_seconds=load,max_logit_error_vs_cached_cuda=max(errors),max_probability_error_vs_cached_cuda=max(probs),top1_parity_vs_cached_cuda=sum(agree1),top3_parity_vs_cached_cuda=sum(agree3),max_logit_error_vs_cpu_reference=max(cpu_errors),cpu_mean_ms=float(np.mean(timings[1:])*1000),cpu_p95_ms=float(np.percentile(timings[1:],95)*1000),checkpoint_provenance='ImageNet initialization; trained on real recorded normal fire only; no synthetic fire; soul not validated')
    (out/'model.json').write_text(json.dumps(manifest,indent=2));destination.with_suffix('.json').write_text(json.dumps(manifest,indent=2));(Path(__file__).parent/'results.json').write_text(json.dumps(manifest,indent=2))
    print(json.dumps(manifest,indent=2))
if __name__=='__main__':main()
