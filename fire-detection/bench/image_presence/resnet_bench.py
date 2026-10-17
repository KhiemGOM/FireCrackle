"""Research-only pretrained ResNet18/50 frame-bag presence trials.

Same image caches/roles/crop review and strict calibration as MobileNetV3.
Weights/data are local artifacts. No automatic labels or release integration.
"""
import argparse,json,os,random,time
from pathlib import Path
import numpy as np
import torch
from torchvision.models import resnet18,resnet50,ResNet18_Weights,ResNet50_Weights
from crop_v2 import load_base
from refine_v3 import fitting_crops,validate_crop_roles,score_views


class ResNetBag(torch.nn.Module):
    def __init__(self,name,pretrained=True):
        super().__init__()
        if name=='resnet18':net=resnet18(weights=ResNet18_Weights.DEFAULT if pretrained else None)
        elif name=='resnet50':net=resnet50(weights=ResNet50_Weights.DEFAULT if pretrained else None)
        else:raise ValueError('Unsupported ResNet')
        self.features=torch.nn.Sequential(*list(net.children())[:-2])
        self.head=torch.nn.Sequential(torch.nn.Linear(net.fc.in_features,128),torch.nn.ReLU(),torch.nn.Dropout(.2),torch.nn.Linear(128,1))
    def forward(self,x):return self.head(self.features(x).mean((2,3))).squeeze(-1)


def set_trainable(model,fine):
    for param in model.features.parameters():param.requires_grad_(False)
    if fine:
        for block in list(model.features.children())[-2:]:
            for param in block.parameters():param.requires_grad_(True)


def fit(name,out,baseline,crop_run,base,rows,crops,protocol,device):
    dest=out/name;dest.mkdir()
    random.seed(321);np.random.seed(321);torch.manual_seed(321)
    model=ResNetBag(name).to(device)
    train=[r for r in rows if r['role']=='train'];dev=[r for r in rows if r['role']=='development']
    if len(train)!=350 or len(dev)!=83:raise ValueError('Frame split changed')
    pos=sum(r['fire'] for r in train);weights=[len(train)/(2*(len(train)-pos)),len(train)/(2*pos)]
    optimizer=torch.optim.AdamW([{'params':model.features.parameters(),'lr':1e-4},{'params':model.head.parameters(),'lr':1e-3}],weight_decay=.001)
    arrays=[np.load(crop_run/r['file']) for r in crops];rng=np.random.default_rng(944)
    best=float('inf');history=[];started=time.time()
    for epoch in range(1,protocol['epochs']+1):
        model.train();model.features.eval();set_trainable(model,epoch>2);order=np.random.permutation(len(train));losses=[]
        for start in range(0,len(order),4):
            batch=[train[i] for i in order[start:start+4]];bags=[]
            for row in batch:
                arr=np.load(baseline/row['file']);k=row['raw_views'];offset=k if len(arr)>k and random.random()<.5 else 0
                x=base.tensor_views(arr[offset:offset+k],device)
                if random.random()<.5:x=x.flip(-1)
                bags.append(x)
            logits=model(torch.cat(bags)).reshape(len(batch),bags[0].shape[0]).max(1).values
            targets=logits.new_tensor([r['fire'] for r in batch]);sw=targets.new_tensor([weights[int(r['fire'])] for r in batch])
            loss=(torch.nn.functional.binary_cross_entropy_with_logits(logits,targets,reduction='none')*sw).mean()
            aux=np.stack([arrays[i][int(rng.integers(len(arrays[i])))] for i in rng.integers(len(arrays),size=4)])
            loss=loss+.2*torch.nn.functional.softplus(-model(base.tensor_views(aux,device))).mean()
            optimizer.zero_grad();loss.backward();optimizer.step();losses.append(float(loss.detach()))
        scores,_=score_views(base,model,dev,baseline,device)
        dev_loss=float(torch.nn.functional.binary_cross_entropy_with_logits(torch.tensor(scores),torch.tensor([r['fire'] for r in dev],dtype=torch.float64)))
        entry={'epoch':epoch,'train_loss':float(np.mean(losses)),'development_loss':dev_loss,'seconds':round(time.time()-started)}
        history.append(entry);(dest/'history.json').write_text(json.dumps(history,indent=2));print(json.dumps({'model':name,**entry}),flush=True)
        if dev_loss<best:
            best=dev_loss;torch.save({'architecture':name,'state':model.state_dict(),'epoch':epoch,'protocol':protocol},dest/'best.pt')
    cp=torch.load(dest/'best.pt',map_location=device,weights_only=False);model.load_state_dict(cp['state'])
    freeze={'epoch':cp['epoch'],'development_loss':best,'weights_sha256':base.sha(dest/'best.pt')}
    (dest/'freeze.json').write_text(json.dumps(freeze,indent=2))
    report={'architecture':name,'protocol':protocol,'freeze':freeze,'roles':{},'recordings':{}}
    for role in ['calibration','development','test']:
        subset=[r for r in rows if r['role']==role];scores,winners=score_views(base,model,subset,baseline,device)
        if role=='calibration':
            threshold=base.clear_threshold(scores,[r['fire'] for r in subset]);(dest/'calibration.json').write_text(json.dumps({'threshold':threshold,'weights_sha256':freeze['weights_sha256']}))
        report['roles'][role]=base.metrics(subset,scores,threshold)
        predicted=[dict(r,score=float(s),winning_view=int(w)) for r,s,w in zip(subset,scores,winners)]
        (dest/f'{role}-predictions.json').write_text(json.dumps(predicted,indent=2))
        for source in sorted({r['source'] for r in subset}):
            m=np.array([r['source']==source for r in subset]);report['recordings'][f'{role}:{source}']=base.metrics([r for r in subset if r['source']==source],scores[m],threshold)
        clear=base.decisions(scores,threshold,[r['abstain'] for r in subset])
        for label,selected in [('TP',[r for r,c in zip(predicted,clear) if c and not r['fire']]),('FP',[r for r,c in zip(predicted,clear) if c and r['fire']])]:
            for i in range(0,len(selected),24):base.sheet(selected[i:i+24],baseline,dest/f'{role}-{label}-{i//24}.png',f'{name} {label}')
    report['threshold_logit']=threshold;(dest/'report.json').write_text(json.dumps(report,indent=2))
    print(json.dumps({'model':name,'result':report['roles'],'freeze':freeze}),flush=True)
    del model,optimizer;torch.cuda.empty_cache()


def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('out',type=Path)
    ap.add_argument('--data-root',type=Path,required=True);ap.add_argument('--baseline-run',type=Path,required=True);ap.add_argument('--crop-run',type=Path,required=True)
    args=ap.parse_args();out=args.out.resolve();out.mkdir(parents=True,exist_ok=True)
    if (out/'protocol.json').exists():raise ValueError('Fresh output folder required')
    os.environ['TORCH_HOME']=str(out/'torch');torch.set_num_threads(4)
    base=load_base(Path(__file__).with_name('pipeline.py'),args.data_root.resolve());baseline=args.baseline_run.resolve();crop_run=args.crop_run.resolve()
    prior=json.loads((baseline/'protocol.json').read_text());rows=json.loads((baseline/'dataset.json').read_text())['rows']
    for name,expected in prior['preprocessing_sha256'].items():
        if base.sha(args.data_root/'fire-detection/core/src'/name)!=expected:raise ValueError('Preprocessing changed')
    crops=fitting_crops(json.loads((crop_run/'dataset.json').read_text()),json.loads((crop_run/'review.json').read_text()));validate_crop_roles(crops,base)
    protocol={'architectures':['resnet18','resnet50'],'epochs':8,'frozen_epochs':2,'seed':321,
        'pretrained':{'resnet18':ResNet18_Weights.DEFAULT.url,'resnet50':ResNet50_Weights.DEFAULT.url},
        'data':'Same350fit/83development/218clip2calibration/919survivaltest;188reviewedpositivefitcrops',
        'inputs':'Unchanged V1 global+8native640px tiles,224px,randomraw/auto+flip;maxraw/autoat inference;topstripremoved',
        'loss':'BalancedframebagBCE plus.2positiveauxloss;4framebags+4positivecrops/update',
        'optimization':'AdamW1e-4backbone/1e-3head,decay.001,head512or2048to128to1dropout.2;BNfixed;finetunelayer3+4afterepoch2',
        'selection':'Minimum83developmentBCE,save/checkpoint hash beforecalibration;strictthresholdmin125calibrationfires beforetest',
        'preprocessing_sha256':prior['preprocessing_sha256'],'dataset_sha256':base.sha(baseline/'dataset.json'),
        'review_sha256':base.sha(crop_run/'review.json'),'source_sha256':base.sha(__file__),
        'status':'Researchonlyoutside0.2.1,familiarcorrelatedsurvivaldiagnostic;notpurearchitectureablationversuswarmstartedV3',
        'next':'Samecomparison1GUI/material/weakmenu/purplegates;extraunioncandidatesgetfreshchecks;reportgainsbeyond43ensemble andGPUlatency'}
    (out/'protocol.json').write_text(json.dumps(protocol,indent=2));device=torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    for name in protocol['architectures']:fit(name,out,baseline,crop_run,base,rows,crops,protocol,device)


if __name__=='__main__':main()
