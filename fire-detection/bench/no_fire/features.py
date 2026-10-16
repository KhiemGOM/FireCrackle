"""Frame-only evidence features. No row, tick, timestamp or truth enters features."""
import numpy as np
from PIL import Image


def unveil(rgb):
    h,w,_=rgb.shape
    a=(192+(np.arange(h,dtype=np.float32)+.5)*16/h)/255
    margin=max(1,int(w*.2));edges=np.concatenate((rgb[:,:margin],rgb[:,-margin:]),axis=1)
    upper=np.floor(16*a+255*(1-a)+2)[:,None,None]
    share=float(((edges>=np.ceil(16*192/255-2))&(edges<=upper)).all(axis=2)[max(1,int(h*.012)):].mean())
    detected=share>=.9
    if not detected:return rgb,False,share
    corrected=np.clip(np.rint((rgb.astype(np.float32)-16*a[:,None,None])/(1-a[:,None,None])),0,255).astype(np.uint8)
    return corrected,True,share


def branch(rgb):
    # Work on every decoded pixel for colour counts; tiny fires are never removed by opening/downsampling.
    h,w,_=rgb.shape;y0=max(1,int(h*.012));rgb=rgb[y0:];h=rgb.shape[0]
    r,g,b=[rgb[:,:,c].astype(np.float32) for c in range(3)]
    lum=(.299*r+.587*g+.114*b)/255
    masks=[(r>=25)&(g>=.28*r)&(g<=1.08*r)&(b<=.65*r)&(r-b>=12),
           (r>=60)&(g>=.36*r)&(g<=r)&(b<=.30*r),
           (r>=160)&(g>=120)&(b>=80)&(r>=g)&(g>=b),
           (r>=20)&(r>=g*1.5)&(g>=b*1.5)]
    out=[]
    for mask in masks:
        # Log absolute counts and maximum local evidence retain faint/tiny candidate regions.
        out.extend([np.log1p(mask.sum()),mask.mean()])
        for grid in (4,8,16):
            hh=h//grid*grid;ww=w//grid*grid
            cells=mask[:hh,:ww].reshape(grid,hh//grid,grid,ww//grid).sum(axis=(1,3))
            out.extend(np.log1p(np.sort(cells.ravel())[-4:]))
    small=np.asarray(Image.fromarray(rgb).resize((160,90),Image.Resampling.BOX),dtype=np.float32)/255
    sr,sg,sb=[small[:,:,c] for c in range(3)]
    out.extend(np.quantile(.299*sr+.587*sg+.114*sb,[0,.1,.25,.5,.75,.9,.99,1]))
    for c in (sr,sg,sb,sr-sg,sg-sb):out.extend(np.quantile(c,[.1,.5,.9]))
    for c in range(3):
        hist,_=np.histogram(small[:,:,c],bins=12,range=(0,1));out.extend(hist/hist.sum())
    return np.asarray(out,dtype=np.float32)


def features(rgb):
    corrected,detected,share=unveil(rgb)
    raw=branch(rgb);auto=branch(corrected) if detected else raw
    return np.r_[raw,auto,float(detected),share].astype(np.float32),detected
