"""Research-only ViT-B/16 trial; identical ResNet bag recipe and frozen data roles."""
import argparse,json,os
from pathlib import Path
import torch
from torchvision.models import vit_b_16,ViT_B_16_Weights
from crop_v2 import load_base
from refine_v3 import fitting_crops,validate_crop_roles
from resnet_bench import fit


class ViTFeatures(torch.nn.Module):
    def __init__(self,pretrained):
        super().__init__()
        self.net=vit_b_16(weights=ViT_B_16_Weights.IMAGENET1K_V1 if pretrained else None)
        self.net.heads=torch.nn.Identity()
    def forward(self,x):
        # The official forward returns the class token with the classifier removed.
        return self.net(x)[:,:,None,None]


class ViTBag(torch.nn.Module):
    def __init__(self,pretrained=True):
        super().__init__()
        self.features=ViTFeatures(pretrained)
        self.head=torch.nn.Sequential(torch.nn.Linear(768,128),torch.nn.ReLU(),torch.nn.Dropout(.2),torch.nn.Linear(128,1))
    def forward(self,x):return self.head(self.features(x).mean((2,3))).squeeze(-1)


def set_trainable(model,fine):
    for p in model.features.parameters():p.requires_grad_(False)
    if fine:
        for block in list(model.features.net.encoder.layers.children())[-2:]:
            for p in block.parameters():p.requires_grad_(True)
        for p in model.features.net.encoder.ln.parameters():p.requires_grad_(True)


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
    protocol={'architecture':'vit_b_16','epochs':8,'frozen_epochs':2,'seed':321,
        'pretrained':ViT_B_16_Weights.IMAGENET1K_V1.url,
        'data':'Unchanged350fit/83dev/218clip2calibration/919survivaldiagnostic;188reviewedpositivefitcrops',
        'inputs':'Sameglobal+8native640tiles resized224,ImageNetnormalization,raw/auto randomfit+flip;maxallviewsatevaluation',
        'optimization':'SameResNetrecipeAdamW1e-4backbone/1e-3headdecay.001;4bags+4positivecrops/update;balancedBCE+.2positiveaux;FP32',
        'unfreeze':'First2epochsheadonly;thenlast2transformerblocks+finalLayerNorm;backboneeval(nointernaldropout),head768-128-1dropout.2',
        'selection':'Minimum83devBCE,freezecheckpointbeforeclip2strictminimumpositivecalibration;thresholdbeforetest',
        'preprocessing_sha256':prior['preprocessing_sha256'],'dataset_sha256':base.sha(baseline/'dataset.json'),'review_sha256':base.sha(crop_run/'review.json'),
        'source_sha256':base.sha(__file__),'training_source_sha256':base.sha(Path(__file__).with_name('resnet_bench.py')),
        'status':'Researchonly,noapp/releaseintegration;familiarcorrelateddiagnosticnotfreshvalidation;singlepredeclaredrecipe,noholdoutretuning'}
    (out/'protocol.json').write_text(json.dumps(protocol,indent=2))
    device=torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    fit('vit_b_16',out,baseline,crop_run,base,rows,crops,protocol,device,ViTBag,set_trainable)


if __name__=='__main__':main()
