"""Research-only target-plane ownership masks; no real labels used for training."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import numpy as np
import torch
from torch import nn
from torch.nn import functional as F
from gpu_render import Renderer,homography,projected,mask_input


class MaskNet(nn.Module):
    """Small U-Net, RGB plus broad fire colour mask; no candidate sprite input."""
    def __init__(self):
        super().__init__()
        def block(a,b):return nn.Sequential(nn.Conv2d(a,b,3,padding=1),nn.GroupNorm(4,b),nn.SiLU(),nn.Conv2d(b,b,3,padding=1),nn.GroupNorm(4,b),nn.SiLU())
        self.a=block(4,16);self.b=block(16,24);self.c=block(24,48)
        self.d=block(72,24);self.e=block(40,16);self.out=nn.Conv2d(16,1,1)

    def forward(self,x):
        a=self.a(x);b=self.b(F.avg_pool2d(a,2));c=self.c(F.avg_pool2d(b,2))
        d=self.d(torch.cat([F.interpolate(c,size=b.shape[-2:],mode='bilinear',align_corners=False),b],1))
        return self.out(self.e(torch.cat([F.interpolate(d,size=a.shape[-2:],mode='bilinear',align_corners=False),a],1)))


def input_tensor(rgb):
    return mask_input(rgb)


def spatial_masks(colour):
    """Fixed morphology, no appearance label or candidate ranking input."""
    def erode(x):return -F.max_pool2d(-F.pad(x,(1,1,1,1),value=0),3,stride=1)
    def dilate(x):return F.max_pool2d(x,3,stride=1,padding=1)
    return {'colour':colour,'opening':dilate(erode(colour)),
            'majority':(F.avg_pool2d(colour,3,1,1)>=5/9).float()}


def crop_native(image,quad,size=64,mode='bilinear'):
    t=(torch.arange(size,device=image.device)+.5)/size
    v,u=torch.meshgrid(t,t,indexing='ij');uv=torch.stack([u,v],-1).reshape(-1,2)
    xy=projected(homography(quad),uv).reshape(len(image),size,size,2)
    scale=torch.tensor([image.shape[-1]/2,image.shape[-2]/2],device=image.device)
    return F.grid_sample(image,xy/scale-1,mode=mode,padding_mode='zeros',align_corners=False)


class OwnershipRenderer(Renderer):
    kinds=['clean','background_patch','rod','white_ui','smoke','other_fire','aligned_fire','no_target']

    @torch.inference_mode()
    def scene(self,labels,seed,kind=None):
        generator=torch.Generator(device=self.device).manual_seed(seed)
        def rand(*shape):return torch.rand(*shape,device=self.device,generator=generator)
        n=len(labels);q=self.quads(n,rand)
        for _ in range(50):
            edges=torch.linalg.vector_norm(q-torch.roll(q,1,1),dim=2)
            bad=(q.amin((1,2))<=5)|(q.amax((1,2))>=155)|(edges.amin(1)<=16)
            if not bool(bad.any()):break
            q[bad]=self.quads(int(bad.sum()),rand)
        if bool(bad.any()):raise RuntimeError('Invalid target geometry')
        which=torch.randint(len(self.kinds),(n,),device=self.device,generator=generator) if kind is None else torch.full((n,),self.kinds.index(kind),device=self.device)
        bg=self.backgrounds[torch.randint(len(self.backgrounds),(n,),device=self.device,generator=generator)].float()/255
        target=self.raster(labels,q);opacity=(target[:,3:]>0)&(which[:,None,None,None]!=7)
        gain=.25+.85*rand(n,1,1,1)
        image=torch.where(opacity,target[:,:3]*gain,bg)
        lo=q.amin(1);hi=q.amax(1);centre=lo+(hi-lo)*(.2+.6*rand(n,2));extent=(hi-lo)*(.2+.65*rand(n,2))
        # Native rectangles and narrow rods cross the target independently of class.
        extent[:,0]=torch.where(which==2,extent[:,0]*.18,extent[:,0])
        xy=self.native[None];covered=((xy>=centre[:,None]-extent[:,None]/2)&(xy<centre[:,None]+extent[:,None]/2)).all(-1).reshape(n,1,160,160)
        foreign_bg=self.backgrounds[torch.randint(len(self.backgrounds),(n,),device=self.device,generator=generator)].float()/255
        rod=torch.cat([.4+.5*rand(n,1,1,1),.3+.55*rand(n,1,1,1),.05+.4*rand(n,1,1,1)],1)
        white=(.65+.35*rand(n,1,1,1)).expand(-1,3,-1,-1)
        grey=(.1+.6*rand(n,1,1,1)).expand(-1,3,-1,-1)
        foreign=foreign_bg.clone()
        foreign=torch.where((which==2)[:,None,None,None],rod,foreign)
        foreign=torch.where((which==3)[:,None,None,None],white,foreign)
        foreign=torch.where((which==4)[:,None,None,None],grey,foreign)
        alpha=covered.float()*((which>=1)&(which<=4))[:,None,None,None]
        alpha=torch.where((which==4)[:,None,None,None],alpha*(.3+.7*rand(n,1,1,1)),alpha)
        # A separately projected fire plane; aligned_fire is deliberately ambiguous.
        other_q=self.quads(n,rand);other_q+=q.mean(1,keepdim=True)-other_q.mean(1,keepdim=True)
        other_q=torch.where((which==6)[:,None,None],q,other_q)
        other_labels=(labels+torch.randint(1,128,(n,),device=self.device,generator=generator))%128
        other=self.raster(other_labels,other_q)
        fire_occ=((which==5)|(which==6))[:,None,None,None]
        alpha=torch.where(fire_occ,(other[:,3:]>0).float(),alpha)
        foreign=torch.where(fire_occ,other[:,:3]*(.25+.85*rand(n,1,1,1)),foreign)
        image=image*(1-alpha)+foreign*alpha
        # Ownership: discard materially mixed smoke; never infer hidden texture.
        visible=opacity&(alpha<.1);foreign_mask=(alpha>=.1)
        fog=.09*rand(n,1,1,1);image=image*(1-fog)+(.3*rand(n,3,1,1))*fog
        blurred=F.avg_pool2d(image,3,1,1)
        image=torch.where(rand(n,1,1,1)<.35,image*.65+blurred*.35,image)
        image=(image+torch.randn(image.shape,device=self.device,generator=generator)*(.008*rand(n,1,1,1))).clamp(0,1)
        image=(image*255).round()/255
        # Half exact, half perturbed corners: learning must tolerate a rough outline.
        supplied=q+torch.randn(q.shape,device=self.device,generator=generator)*.035*(hi-lo)[:,None]
        supplied=torch.where((rand(n,1,1)<.5),q,supplied)
        rgb=crop_native(image,supplied).clamp(0,1)
        truth=crop_native(visible.float(),supplied,mode='nearest')
        badmask=crop_native(foreign_mask.float(),supplied,mode='nearest')
        return dict(x=input_tensor(rgb),rgb=rgb,y=truth,foreign=badmask,image=image,visible=visible,occluder=foreign_mask,quad=q,supplied=supplied,kinds=which,labels=labels)


def counts(pred,truth,foreign):
    pred=pred.bool();truth=truth.bool();foreign=foreign.bool()
    return dict(tp=int((pred&truth).sum()),fp=int((pred&~truth).sum()),fn=int((~pred&truth).sum()),
                foreign_kept=int((pred&foreign).sum()),foreign_total=int(foreign.sum()),visible_total=int(truth.sum()))


def metrics(c):
    def ratio(a,b):return a/b if b else None
    return {**c,'iou':ratio(c['tp'],c['tp']+c['fp']+c['fn']),
            'precision':ratio(c['tp'],c['tp']+c['fp']),'recall':ratio(c['tp'],c['visible_total']),
            'foreign_retention':ratio(c['foreign_kept'],c['foreign_total'])}
