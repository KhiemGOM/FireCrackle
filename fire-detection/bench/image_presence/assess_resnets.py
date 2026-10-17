"""Apply frozen shared gates, compare ensemble additions and time GPU model inference."""
import argparse,json,time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
import numpy as np
import torch
from crop_v2 import load_base
from compare_rules import init_worker,check,counts
from resnet_bench import ResNetBag


def timed(model,arrays,base,device):
    model.eval()
    with torch.inference_mode():
        for arr in arrays[:3]:model(base.tensor_views(arr,device)).max()
        torch.cuda.synchronize();times=[]
        for _ in range(3):
            for arr in arrays:
                torch.cuda.synchronize();start=time.perf_counter()
                model(base.tensor_views(arr,device)).max();torch.cuda.synchronize()
                times.append((time.perf_counter()-start)*1000)
    return {'median_ms_per_frame':float(np.median(times)),'p95_ms_per_frame':float(np.percentile(times,95)),
            'mean_ms_per_frame':float(np.mean(times)),'samples':len(times),
            'scope':'FP32 GPU tiled model+normalization/host-to-device; cached images in RAM; excludes video decode, GUI, unveiling and material checks'}


def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('run',type=Path)
    ap.add_argument('--data-root',type=Path,required=True);ap.add_argument('--baseline-run',type=Path,required=True)
    ap.add_argument('--comparison',type=Path,required=True);ap.add_argument('--v3-run',type=Path,required=True);args=ap.parse_args()
    root=args.data_root.resolve();run=args.run.resolve();baseline=args.baseline_run.resolve();comp=args.comparison.resolve()
    base=load_base(Path(__file__).with_name('pipeline.py'),root);torch.set_num_threads(4)
    reference=json.loads((comp/'predictions.json').read_text());evidence={r['frame']:r['evidence'] for r in reference if r['evidence']}
    guard_protocol=json.loads((comp/'protocol.json').read_text())
    for name,expected in guard_protocol['source_sha256'].items():
        if base.sha(root/'fire-detection/bench/no_fire'/name)!=expected:raise ValueError('Shared gate source changed')
    models={};pending={}
    for name in ['resnet18','resnet50']:
        folder=run/name;cal=json.loads((folder/'calibration.json').read_text())
        if cal['weights_sha256']!=base.sha(folder/'best.pt'):raise ValueError('Weights/calibration mismatch')
        rows=json.loads((folder/'test-predictions.json').read_text());models[name]=(rows,cal['threshold'])
        if len(rows)!=len(reference):raise ValueError('Frame count mismatch')
        for row,old in zip(rows,reference):
            for key in ['frame','source','fire','raw_fire','abstain','file']:
                if row[key]!=old[key]:raise ValueError('Evaluation frame/truth mismatch')
            if row['score']<cal['threshold'] and row['frame'] not in evidence:pending[row['frame']]=old
    protocol={'status':'Familiar919frame diagnostic only, no retuning; excluded from0.2.1',
        'existing_ensemble':'Rules+MobileNetV3 with identical shared gates:43TP/0FP',
        'new_candidate_checks':len(pending),'gate_protocol_sha256':base.sha(comp/'protocol.json'),
        'latency':'Same32sampled919testframes;3passes;FP32;cachedimages;includes9or18tiles,nomaterial/decodecost'}
    (run/'assessment-protocol.json').write_text(json.dumps(protocol,indent=2))
    if pending:
        with ProcessPoolExecutor(max_workers=6,initializer=init_worker,initargs=(root,baseline,comp/'frozen-rules.exe')) as pool:
            for i,item in enumerate(pool.map(check,pending.values()),1):
                evidence[item['frame']]=item
                if i%20==0:print(json.dumps({'fresh_gate_checks':i,'total':len(pending)}),flush=True)
    (run/'shared-evidence.json').write_text(json.dumps(list(evidence.values()),indent=2))
    report={'protocol':protocol,'models':{},'old_ensemble':counts(reference,'union')}
    newrows=[]
    for index,old in enumerate(reference):
        r={'source':old['source'],'frame':old['frame'],'fire':old['fire'],'raw_fire':old['raw_fire'],'old_ensemble':old['union']}
        for name,(rows,threshold) in models.items():
            row=rows[index];e=evidence.get(r['frame'])
            r[name]=bool(row['score']<threshold and e and not e['common_blocked'])
            r[name+'_new']=r[name] and not r['old_ensemble'];r[name+'_ensemble']=r[name] or r['old_ensemble']
        r['all_ensemble']=r['old_ensemble'] or r['resnet18'] or r['resnet50'];newrows.append(r)
    for name,(rows,threshold) in models.items():
        report['models'][name]={'standalone':counts(newrows,name),'new_beyond_old':counts(newrows,name+'_new'),
            'ensemble':counts(newrows,name+'_ensemble'),'raw_original_guard':json.loads((run/name/'report.json').read_text())['roles']['test']}
        for label,selected in [('matched-clears',[dict(row) for row,r in zip(rows,newrows) if r[name] and not r['fire']]),
                              ('new-clears',[dict(row) for row,r in zip(rows,newrows) if r[name+'_new'] and not r['fire']]),
                              ('false-clears',[dict(row) for row,r in zip(rows,newrows) if r[name] and r['fire']])]:
            for i in range(0,len(selected),24):base.sheet(selected[i:i+24],baseline,run/name/f'{label}-{i//24}.png',name+' '+label)
    report['all_ensemble']=counts(newrows,'all_ensemble')
    (run/'matched-predictions.json').write_text(json.dumps(newrows,indent=2))
    device=torch.device('cuda');indices=np.linspace(0,len(reference)-1,32).round().astype(int)
    arrays=[np.load(baseline/reference[i]['file']) for i in indices];report['latency']={}
    for name in ['mobilenet_v3','resnet18','resnet50']:
        folder=args.v3_run if name=='mobilenet_v3' else run/name
        cp=torch.load(folder/'best.pt',map_location=device,weights_only=False)
        model=base.make_model(pretrained=False) if name=='mobilenet_v3' else ResNetBag(name,False)
        model=model.to(device);model.load_state_dict(cp['state']);report['latency'][name]=timed(model,arrays,base,device)
        del model;torch.cuda.empty_cache()
    (run/'assessment.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)


if __name__=='__main__':main()
