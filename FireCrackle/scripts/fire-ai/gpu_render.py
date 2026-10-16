"""Batched equivalent of the isolated-plane renderer, using real no-fire BGs.

All foreground labels/geometry are synthetic. Inference still takes the same
64x64RGB plus rough mask. Geometry/rendering stays float32, outside AMP.
"""
import torch
from torch.nn import functional as F
from render import load_sprites


def homography(q):
    x0,y0=q[:,0].unbind(1);x1,y1=q[:,1].unbind(1);x2,y2=q[:,2].unbind(1);x3,y3=q[:,3].unbind(1)
    dx1,dx2,dx3=x1-x2,x3-x2,x0-x1+x2-x3
    dy1,dy2,dy3=y1-y2,y3-y2,y0-y1+y2-y3
    det=dx1*dy2-dx2*dy1;g=(dx3*dy2-dx2*dy3)/det;h=(dx1*dy3-dx3*dy1)/det
    return torch.stack([x1-x0+g*x1,x3-x0+h*x3,x0,y1-y0+g*y1,y3-y0+h*y3,y0,g,h,torch.ones_like(g)],1).reshape(-1,3,3)


def projected(h,points):
    p=torch.cat([points,torch.ones_like(points[...,:1])],-1)
    if p.ndim==2:p=p.unsqueeze(0).expand(len(h),-1,-1)
    p=torch.bmm(p,h.transpose(1,2))
    return p[...,:2]/p[...,2:]


def mask_input(rgb):
    r,g,b=rgb[:,0],rgb[:,1],rgb[:,2]
    mask=(r>=25/255)&(g<=1.12*r)&(((g>=.25*r)&(b<=.65*r))|((r>=130/255)&(g>=.8*r)))
    return torch.cat([rgb,mask[:,None].float()],1)*2-1


class Renderer:
    def __init__(self,backgrounds,device='cuda'):
        self.device=torch.device(device)
        self.backgrounds=torch.as_tensor(backgrounds.transpose(0,3,1,2).copy(),device=self.device)
        self.sprites=torch.tensor(load_sprites().transpose(0,3,1,2).copy(),device=self.device).float()/255
        yy,xx=torch.meshgrid(torch.arange(160,device=self.device)+.5,torch.arange(160,device=self.device)+.5,indexing='ij')
        self.native=torch.stack([xx,yy],-1).reshape(-1,2)
        t=(torch.arange(64,device=self.device)+.5)/64;v,u=torch.meshgrid(t,t,indexing='ij')
        self.uv=torch.stack([u,v],-1).reshape(-1,2)

    def quads(self,n,rand):
        yaw,pitch,roll=(rand(n)*2-1),(rand(n)*2-1),(rand(n)*1.3-.65)
        cy,sy,cx,sx,cz,sz=yaw.cos(),yaw.sin(),pitch.cos(),pitch.sin(),roll.cos(),roll.sin()
        # Apply the same Ry -> Rx -> Rz order as the NumPy physical renderer.
        uv=torch.tensor([[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]],device=self.device)
        x=uv[:,0][None,:]*(.55+.9*rand(n,1));y=uv[:,1][None,:].expand(n,-1)
        X=x*cy[:,None];Z=-x*sy[:,None]
        Y=y*cx[:,None]-Z*sx[:,None];Z=y*sx[:,None]+Z*cx[:,None]
        X,Y=X*cz[:,None]-Y*sz[:,None],X*sz[:,None]+Y*cz[:,None]
        Z=Z+1.8+rand(n,1)*4.2
        return torch.stack([X/Z,Y/Z],-1)*150+(70+20*rand(n,1,2))

    def raster(self,labels,q):
        uv=projected(torch.linalg.inv(homography(q)),self.native).reshape(-1,160,160,2)
        rgba=F.grid_sample(self.sprites[labels],uv*2-1,mode='nearest',padding_mode='zeros',align_corners=False)
        inside=((uv>=0)&(uv<1)).all(-1)
        rgba*=((rgba[:,3]>=26/255)&inside)[:,None]
        return rgba

    @torch.inference_mode()
    def batch(self,labels,seed,hard=True,return_native=False):
        generator=torch.Generator(device=self.device).manual_seed(seed)
        def rand(*shape):return torch.rand(*shape,device=self.device,generator=generator)
        n=len(labels);q=self.quads(n,rand)
        for _ in range(30):
            edges=torch.linalg.vector_norm(q-torch.roll(q,1,1),dim=2)
            bad=(q.amin((1,2))<=5)|(q.amax((1,2))>=155)|(edges.amin(1)<=16)
            count=int(bad.sum())
            if not count:break
            q[bad]=self.quads(count,rand)
        if count:raise RuntimeError('Could not sample valid physical rectangles')
        ids=torch.randint(len(self.backgrounds),(n,),device=self.device,generator=generator)
        bg=self.backgrounds[ids].float()/255
        rgba=self.raster(labels,q);opaque=rgba[:,3:]>0
        brightness=.3+rand(n,1,1,1)*.75
        image=torch.where(opaque,rgba[:,:3]*brightness,bg)
        # Foreground rectangles take texture from a different no-fire BG patch.
        # Label does not select either background or occluder.
        if hard:
            lo=q.amin(1);hi=q.amax(1);centre=lo+(hi-lo)*rand(n,2);extent=(hi-lo)*(.12+.43*rand(n,2))
            xy=self.native[None,:,:];covered=((xy>=centre[:,None,:]-extent[:,None,:]/2)&(xy<centre[:,None,:]+extent[:,None,:]/2)).all(-1).reshape(n,1,160,160)
            covered&=(rand(n,1,1,1)<.6)
            occluder=self.backgrounds[torch.randint(len(self.backgrounds),(n,),device=self.device,generator=generator)].float()/255
            image=torch.where(covered,occluder,image)
            fog=.12*rand(n,1,1,1);fogcolour=.4*rand(n,3,1,1)
            image=image*(1-fog)+fogcolour*fog
            blurred=F.avg_pool2d(image,3,stride=1,padding=1)
            image=torch.where(rand(n,1,1,1)<.4,image*.6+blurred*.4,image)
            noise=torch.randn(image.shape,device=self.device,generator=generator)*rand(n,1,1,1)*(1.7/255)
            image=(image+noise).clamp(0,1)
        supplied=q.clone()
        if hard:supplied+=torch.randn(q.shape,device=self.device,generator=generator)*.017*(q.amax(1)-q.amin(1))[:,None,:]
        xy=projected(homography(supplied),self.uv).reshape(n,64,64,2)
        crop=F.grid_sample(image,xy/80-1,mode='bilinear',padding_mode='zeros',align_corners=False)
        # Match saved8-bit data/inference preprocessing, not float-only training.
        crop=(crop*255).floor().clamp(0,255)/255
        x=mask_input(crop)
        if return_native:return x,image,q,supplied
        return x
