"""Both flame colours, same phase target; independent synthetic nuisance layers.

Reuses the existing native-raster/projection primitives. No GUI inverse or veil
detector is implemented here. Fog and lighting are explicit training variations.
"""
import sys
from pathlib import Path
import numpy as np
import torch
from torch.nn import functional as F
sys.path.append(str(Path(__file__).resolve().parents[1]))
from gpu_render import Renderer,homography,projected

class PhaseRenderer(Renderer):
    def __init__(self,backgrounds,sheets,device,colour=None):
        super().__init__(backgrounds,device)
        sprites=np.stack([sheets[s,r,:,::-1 if m else 1] for s in range(4) for r in range(32) for m in range(2)])
        self.sprites=torch.tensor(sprites.transpose(0,3,1,2).copy(),device=device).float()/255
        if colour not in [None,'orange','soul']:raise ValueError('Unknown flame colour')
        self.labels=torch.arange(256,device=device) if colour is None else torch.arange(128,device=device)+(128 if colour=='soul' else 0)

    @torch.inference_mode()
    def batch(self,n,seed):
        g=torch.Generator(device=self.device).manual_seed(seed)
        def rand(*shape):return torch.rand(*shape,device=self.device,generator=g)
        labels=self.labels[torch.randint(len(self.labels),(n,),device=self.device,generator=g)];phase=(labels//2)%32
        corners=torch.tensor([[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]],device=self.device)
        q=corners[None]*(72+rand(n,1,1)*40)+80+(rand(n,4,2)-.5)*10
        bg=self.backgrounds[torch.randint(len(self.backgrounds),(n,),device=self.device,generator=g)].float()/255
        rgba=self.raster(labels,q);image=torch.where(rgba[:,3:]>0,rgba[:,:3]*(.3+rand(n,1,1,1)*.8),bg)
        # A foreign flame can cover the target; it never selects the target phase.
        other=self.labels[torch.randint(len(self.labels),(n,),device=self.device,generator=g)];other_q=q+(rand(n,1,2)-.5)*70
        foreign=self.raster(other,other_q)
        covered=(foreign[:,3:]>0)&(rand(n,1,1,1)<.55)
        image=torch.where(covered,foreign[:,:3]*(.3+rand(n,1,1,1)*.8),image)
        lo=q.amin(1);hi=q.amax(1);centre=lo+(hi-lo)*rand(n,2);extent=(hi-lo)*(.1+.4*rand(n,2))
        xy=self.native[None];occluded=((xy>=centre[:,None]-extent[:,None]/2)&(xy<centre[:,None]+extent[:,None]/2)).all(-1).reshape(n,1,160,160)&(rand(n,1,1,1)<.4)
        image=torch.where(occluded,bg.roll(11,3),image)
        fog=.12*rand(n,1,1,1);image=image*(1-fog)+.4*rand(n,3,1,1)*fog
        image=image*.75+F.avg_pool2d(image,3,1,1)*.25
        # Small outline errors; pixel centres and bilinear rectification match input.
        supplied=q+(rand(n,4,2)-.5)*3
        grid=projected(homography(supplied),self.uv).reshape(n,64,64,2)
        crop=F.grid_sample(image,grid/80-1,mode='bilinear',align_corners=False)
        crop=(crop+torch.randn(crop.shape,device=self.device,generator=g)*1.5/255).clamp(0,1)
        crop=(crop*255).floor()/255
        return crop,phase
