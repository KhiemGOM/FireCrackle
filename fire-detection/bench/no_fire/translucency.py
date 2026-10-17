"""Deterministic material-conditioned abstention research prototype.

This detects suspicious portal/water/tinted-glass appearances, not alpha itself.
RGB alone cannot prove arbitrary transparency. No classifier/model or fire labels.
Shared menu inverse and portal inverse remain in Rust; no duplicate inverse here.
"""
import numpy as np
from veil_native import apply

VERSION='material-patches-v3'

def detect(rgb,world_mask=None):
    a=np.asarray(rgb,dtype=np.uint8)
    if a.ndim!=3 or a.shape[2]!=3:raise ValueError('Expected RGB24')
    h,w=a.shape[:2]
    if world_mask is not None and np.asarray(world_mask).shape!=(h,w):raise ValueError('Mask shape differs')
    # Shared automatic menu inverse before material features.
    a,unveiled,_=apply(a,y0=min(12,h-1))
    # Sample at native 3px spacing, preserving region texture. Exact masks override
    # the temporary GUI envelope; unknown pixels never become evidence of opacity.
    a=np.asarray(a)[::3,::3].astype(np.float32)
    m=np.ones(a.shape[:2],bool) if world_mask is None else np.asarray(world_mask)[::3,::3]!=0
    if world_mask is None:
        m[:4]=False;m[int(len(m)*.85):]=False
        m[:int(len(m)*.18),int(m.shape[1]*.85):]=False
    r,g,b=np.moveaxis(a,2,0)
    purple=(b>=95)&(r>=55)&(r>1.5*g)&(b>1.15*r)&(b>1.65*g)&m
    blue=(b>=42)&(b>1.20*r)&(b>1.30*g)&(g>1.12*r)&m
    # 16x16 sampled patches = 48x48 native pixels. Require textured, spatially
    # coherent blue areas; flat blue sky and isolated blue UI/particles don't suffice.
    ph,pw=len(m)//16,m.shape[1]//16
    def blocks(x):return x[:ph*16,:pw*16].reshape(ph,16,pw,16).transpose(0,2,1,3)
    blue_share=blocks(blue).mean((2,3));purple_share=blocks(purple).mean((2,3))
    luma=(r+g+b)/3
    texture=blocks(luma).std((2,3))
    # Measure variation inside the tinted surface, not the boundary from flat sky
    # to a white cloud/opaque building. Both sides must retain the blue tint.
    edges=np.zeros_like(luma)
    edges[:,1:]=np.abs(luma[:,1:]-luma[:,:-1])*(blue[:,1:]&blue[:,:-1])
    edges[1:]=np.maximum(edges[1:],np.abs(luma[1:]-luma[:-1])*(blue[1:]&blue[:-1]))
    edge_share=blocks(edges>5).mean((2,3))
    tint=(blue_share>=.65)&(texture>=4)&(edge_share>=.08)
    # Neighbouring patches give coherent surface support rather than one blue speck.
    adjacent=np.zeros_like(tint);adjacent[1:]|=tint[:-1];adjacent[:-1]|=tint[1:];adjacent[:,1:]|=tint[:,:-1];adjacent[:,:-1]|=tint[:,1:]
    tint&=adjacent
    portal=(purple_share>=.12)&(texture>=5)
    reasons=[]
    if portal.any():reasons.append('portal_or_purple_translucent_effect')
    if tint.any():reasons.append('textured_blue_water_or_tinted_glass')
    return {'abstain':bool(reasons),'reasons':reasons,'portal_patches':int(portal.sum()),'tinted_surface_patches':int(tint.sum()),'menu_unveiled':unveiled,'version':VERSION}
