"""Weak real-patch supervision, not oracle real-world ownership labels.

Transparent expected texels are negatives for this target plane. Opaque texels
are positive only when colour and one robust plane gain agree; other opaque
texels stay ignored. Known injected occluders supply unambiguous negatives.
"""
import json
import numpy as np
import torch
from torch.nn import functional as F
from core import input_tensor
from render import ROOT,load_sprites


def weak_labels(rgb,labels,sprites):
    expected=F.interpolate(sprites[labels,:3],size=64,mode='nearest')
    alpha=F.interpolate(sprites[labels,3:],size=64,mode='nearest')>.5
    r=rgb[:,:1].clamp_min(1/255);R=expected[:,:1].clamp_min(1/255)
    chroma=(r>=20/255)&((rgb[:,1:2]/r-expected[:,1:2]/R).abs()<=.08)&((rgb[:,2:3]/r-expected[:,2:3]/R).abs()<=.12)&alpha
    gain=torch.log2(r/R)
    good_gain=torch.where(chroma,gain,float('nan')).reshape(len(rgb),-1).nanmedian(1).values
    good_gain=torch.nan_to_num(good_gain,nan=0.)[:,None,None,None]
    positive=chroma&((gain-good_gain).abs()<=.25)
    # Ignore texel edges, where raster/filtering makes weak labels least reliable.
    pixel=torch.arange(64,device=rgb.device);inner=((pixel%4==1)|(pixel%4==2))
    inner=(inner[:,None]&inner[None,:])[None,None]
    valid=((~alpha)|positive)&inner
    return positive.float(),valid.float()


class SurvivalPatches:
    def __init__(self,split,device='cuda'):
        self.device=torch.device(device)
        source=ROOT/'.board/fire-ai/survival-curated'
        data=np.load(source/f'{split}.npz');self.rgb=torch.tensor(data['x'].transpose(0,3,1,2).copy(),device=device).float()/255
        self.labels=torch.tensor(data['y'],device=device)
        self.sprites=torch.tensor(load_sprites().transpose(0,3,1,2).copy(),device=device).float()/255
        self.target,self.valid=weak_labels(self.rgb,self.labels,self.sprites)
        backgrounds=np.load(ROOT/'.board/fire-ai/backgrounds'/('train.npz' if split=='train' else 'val.npz'))['x']
        self.backgrounds=F.interpolate(torch.tensor(backgrounds.transpose(0,3,1,2).copy(),device=device).float()/255,size=64,mode='bilinear',align_corners=False)
        review=json.loads((source/'review.json').read_text());self.ids=review[split]
        assert len(self.ids)==len(self.rgb)

    @torch.inference_mode()
    def batch(self,n,seed):
        generator=torch.Generator(device=self.device).manual_seed(seed)
        def rand(*shape):return torch.rand(*shape,device=self.device,generator=generator)
        ids=torch.randint(len(self.rgb),(n,),device=self.device,generator=generator)
        rgb=self.rgb[ids].clone();target=self.target[ids].clone();valid=self.valid[ids].clone()
        # Translate/scale/mirror the complete observed plane consistently.
        theta=torch.zeros(n,2,3,device=self.device);scale=.9+.2*rand(n,2)
        theta[:,0,0]=scale[:,0]*torch.where(rand(n)<.5,-1.,1.);theta[:,1,1]=scale[:,1]
        theta[:,:,2]=(rand(n,2)-.5)*.08
        grid=F.affine_grid(theta,rgb.shape,align_corners=False)
        rgb=F.grid_sample(rgb,grid,mode='bilinear',align_corners=False)
        target=F.grid_sample(target,grid,mode='nearest',align_corners=False)
        valid=F.grid_sample(valid,grid,mode='nearest',align_corners=False)
        kind=torch.randint(7,(n,),device=self.device,generator=generator)
        t=(torch.arange(64,device=self.device)+.5)/64;v,u=torch.meshgrid(t,t,indexing='ij')
        centre=.2+.6*rand(n,2);extent=.15+.6*rand(n,2)
        extent[:,0]=torch.where(kind==2,extent[:,0]*.2,extent[:,0])
        rectangle=((u[None]-centre[:,0,None,None]).abs()<extent[:,0,None,None]/2)&((v[None]-centre[:,1,None,None]).abs()<extent[:,1,None,None]/2)
        alpha=rectangle[:,None].float()*((kind>=1)&(kind<=4))[:,None,None,None]
        foreign=self.backgrounds[torch.randint(len(self.backgrounds),(n,),device=self.device,generator=generator)]
        rod=torch.cat([.4+.5*rand(n,1,1,1),.3+.55*rand(n,1,1,1),.05+.4*rand(n,1,1,1)],1)
        foreign=torch.where((kind==2)[:,None,None,None],rod,foreign)
        foreign=torch.where((kind==3)[:,None,None,None],.65+.35*rand(n,1,1,1),foreign)
        foreign=torch.where((kind==4)[:,None,None,None],.1+.6*rand(n,1,1,1),foreign)
        alpha=torch.where((kind==4)[:,None,None,None],alpha*(.3+.7*rand(n,1,1,1)),alpha)
        # Fire overlap includes an aligned ambiguity condition and a rotated plane.
        rgba=F.interpolate(self.sprites[torch.randint(128,(n,),device=self.device,generator=generator)],size=64,mode='nearest')
        angle=rand(n)*1.8-.9;rotation=torch.zeros(n,2,3,device=self.device)
        rotation[:,0,0]=angle.cos();rotation[:,0,1]=-angle.sin();rotation[:,1,0]=angle.sin();rotation[:,1,1]=angle.cos()
        rotated=F.grid_sample(rgba,F.affine_grid(rotation,rgba.shape,align_corners=False),mode='nearest',align_corners=False)
        rgba=torch.where((kind==6)[:,None,None,None],rgba,rotated)
        fire=(kind>=5)[:,None,None,None]
        alpha=torch.where(fire,(rgba[:,3:]>=.5).float(),alpha)
        foreign=torch.where(fire,rgba[:,:3]*(.3+.7*rand(n,1,1,1)),foreign)
        rgb=rgb*(1-alpha)+foreign*alpha;covered=alpha>=.1
        target=torch.where(covered,0,target);valid=torch.where(covered,1,valid)
        rgb=(rgb*(.85+.25*rand(n,1,1,1))+torch.randn(rgb.shape,device=self.device,generator=generator)*.004).clamp(0,1)
        rgb=(rgb*255).round()/255
        return dict(x=input_tensor(rgb),y=target,valid=valid,rgb=rgb,foreign=covered.float())
