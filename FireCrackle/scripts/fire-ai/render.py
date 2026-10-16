"""Research-only pixel-centre fire-plane renderer; no game assets are vendored.

Models one isolated cutout plane, not the complete Minecraft world renderer.
Perspective-correct nearest texels and alpha discard follow the shipped quad
rasterizer. Lighting/fog/background/occluders are explicit domain randomization.
"""
from pathlib import Path
import json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[3]
SIZE = 160
OUT = 64
UV = np.array([[0., 0.], [1., 0.], [1., 1.], [0., 1.]])


def load_sprites():
    sheets = [np.asarray(Image.open(ROOT / f"fire-detection/data/assets/fire_{s}.png").convert("RGBA")) for s in range(2)]
    assert all(s.shape == (512, 16, 4) for s in sheets)
    return np.stack([sheets[s][row*16:(row+1)*16, ::-1 if mirror else 1] for s in range(2) for row in range(32) for mirror in range(2)])


def homography(quad):
    q = np.asarray(quad, dtype=np.float64)
    a, b = [], []
    for (u, v), (x, y) in zip(UV, q):
        a.extend([[u,v,1,0,0,0,-x*u,-x*v], [0,0,0,u,v,1,-y*u,-y*v]])
        b.extend([x,y])
    return np.r_[np.linalg.solve(a, b), 1].reshape(3,3)


def project(h, points):
    p = np.c_[np.asarray(points).reshape(-1,2), np.ones(np.asarray(points).reshape(-1,2).shape[0])] @ h.T
    return p[:,:2] / p[:,2:]


def random_quad(rng, hard=False):
    """Project a physical 3-D rectangle through a pinhole camera, no arbitrary warp."""
    for _ in range(100):
        yaw, pitch = rng.uniform(-1.0, 1.0, 2)
        roll = rng.uniform(-.65, .65)
        cy, sy, cx, sx, cz, sz = np.cos(yaw),np.sin(yaw),np.cos(pitch),np.sin(pitch),np.cos(roll),np.sin(roll)
        ry=np.array([[cy,0,sy],[0,1,0],[-sy,0,cy]])
        rx=np.array([[1,0,0],[0,cx,-sx],[0,sx,cx]])
        rz=np.array([[cz,-sz,0],[sz,cz,0],[0,0,1]])
        aspect=rng.uniform(.55,1.45)
        xyz=np.c_[(UV-.5)*[aspect,1],np.zeros(4)] @ (rz@rx@ry).T
        distance=rng.uniform(1.8, 6.0 if hard else 4.2)
        xyz[:,2]+=distance
        q=xyz[:,:2]/xyz[:,2:]*150 + rng.uniform(70,90,2)
        edges=np.linalg.norm(q-np.roll(q,1,axis=0),axis=1)
        if q.min()>5 and q.max()<SIZE-5 and edges.min()>(16 if hard else 24):
            return q
    raise RuntimeError("failed to sample a visible rectangle")


def background(rng, size=SIZE):
    # Random palettes and block-like textures, independent of sprite identity.
    colours=np.array([[45,42,37],[82,51,32],[95,92,85],[32,65,26],[45,17,15],[120,63,24]])
    base=colours[rng.integers(len(colours))]*rng.uniform(.35,1.5)
    small=rng.normal(0,15,(rng.integers(6,16),rng.integers(6,16),3)) + base
    im=Image.fromarray(np.uint8(np.clip(small,0,255))).resize((size,size),Image.Resampling.NEAREST)
    draw=ImageDraw.Draw(im)
    for _ in range(12):
        x,y=rng.integers(0,size,2); w,h=rng.integers(3,45,2)
        draw.rectangle((int(x),int(y),int(x+w),int(y+h)),fill=tuple(np.uint8(np.clip(base+rng.normal(0,25,3),0,255))))
    return np.asarray(im).copy()


def raster(sprite, quad, size=SIZE):
    yy,xx=np.mgrid[:size,:size]
    uv=project(np.linalg.inv(homography(quad)), np.stack([xx+.5,yy+.5],axis=-1))
    inside=((uv>=0)&(uv<1)).all(axis=1)
    indices=np.clip(np.floor(uv*16).astype(int),0,15)
    rgba=sprite[indices[:,1],indices[:,0]].copy()
    rgba[~inside]=0
    # Minecraft cutout layer discards low-alpha fragments. Vanilla sprite
    # alpha is binary; unlike overlay rendering there is no 0.9 global alpha.
    rgba[rgba[:,3]<26]=0
    return rgba.reshape(size,size,4)


def rectify(image, quad):
    t=(np.arange(OUT)+.5)/OUT
    u,v=np.meshgrid(t,t)
    xy=project(homography(quad), np.stack([u,v],axis=-1))-.5
    x,y=xy[:,0],xy[:,1]
    x0,y0=np.floor(x).astype(int),np.floor(y).astype(int)
    dx,dy=x-x0,y-y0
    h,w=image.shape[:2]
    out=np.zeros((OUT*OUT,3),np.float64)
    for ax,ay,weight in [(0,0,(1-dx)*(1-dy)),(1,0,dx*(1-dy)),(0,1,(1-dx)*dy),(1,1,dx*dy)]:
        ix,iy=x0+ax,y0+ay
        valid=(ix>=0)&(iy>=0)&(ix<w)&(iy<h)
        out[valid]+=image[iy[valid],ix[valid],:3]*weight[valid,None]
    return np.uint8(np.clip(out.reshape(OUT,OUT,3),0,255))


def colour_mask(rgb):
    # Candidate-independent rough warm/bright mask, deliberately imperfect.
    r,g,b=np.moveaxis(rgb.astype(np.float32),-1,0)
    warm=(g>=.25*r)&(b<=.65*r)
    core=(r>=130)&(g>=.8*r)
    return np.uint8((r>=25)&(g<=1.12*r)&(warm|core))*255


def sample(sprites, label, seed, mode="train"):
    rng=np.random.default_rng(seed)
    hard=mode in ("hard","train")
    q=random_quad(rng,hard)
    bg=background(rng)
    rgba=raster(sprites[label],q)
    mask=rgba[:,:,3]>0
    brightness=rng.uniform(.3,1.05) if mode!="clean" else rng.uniform(.65,1)
    bg[mask]=np.uint8(np.clip(rgba[mask,:3]*brightness,0,255))
    visible=mask.copy()
    if hard and rng.random()<.6:
        # Solid foreground objects; no truth mask is supplied to the model.
        lo,hi=q.min(axis=0),q.max(axis=0)
        x,y=rng.uniform(lo,hi); w,h=(hi-lo)*rng.uniform(.12,.55,2)
        x0,y0=max(0,int(x-w/2)),max(0,int(y-h/2))
        x1,y1=min(SIZE,int(x+w/2)),min(SIZE,int(y+h/2))
        bg[y0:y1,x0:x1]=rng.integers(5,110,3)
        visible[y0:y1,x0:x1]=False
    if hard:
        fog=rng.uniform(0,.12)
        bg=np.uint8(bg*(1-fog)+rng.integers(0,100,3)*fog)
        if rng.random()<.4:
            bg=np.asarray(Image.fromarray(bg).filter(ImageFilter.GaussianBlur(rng.uniform(.15,.65))))
        noise=rng.normal(0,rng.uniform(0,1.7),bg.shape)
        bg=np.uint8(np.clip(bg.astype(float)+noise,0,255))
    supplied=q.copy()
    if mode in ("train","rough"):
        supplied+=rng.normal(0,.017,(4,2))*np.ptp(q,axis=0)
    crop=rectify(bg,supplied)
    return crop,dict(quad=q.tolist(),supplied_quad=supplied.tolist(),brightness=float(brightness),visible_fraction=float(visible.sum()/max(mask.sum(),1))),bg


def contact_sheet(images, captions, path, columns=8):
    if not len(images):return
    canvas=Image.new("RGB",(columns*128, ((len(images)+columns-1)//columns)*150),(20,24,31))
    draw=ImageDraw.Draw(canvas)
    for i,(im,text) in enumerate(zip(images,captions)):
        x,y=(i%columns)*128,(i//columns)*150
        canvas.paste(Image.fromarray(im).resize((128,128),Image.Resampling.NEAREST),(x,y))
        draw.text((x+3,y+130),text,fill="white")
    canvas.save(path)


if __name__ == "__main__":
    import argparse
    ap=argparse.ArgumentParser();ap.add_argument("out",type=Path);ap.add_argument("--per-class",type=int,default=128);ap.add_argument("--negative-only",action="store_true");args=ap.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    if args.negative_only:
        crops=[]
        for i in range(256):
            rng=np.random.default_rng(7000000+i);quad=random_quad(rng,True)
            crops.append(rectify(background(rng),quad))
        np.savez_compressed(args.out/"negative.npz",x=np.stack(crops),y=np.full(256,-1))
        contact_sheet(crops[:32],["no fire"]*32,args.out/"negative.png")
        raise SystemExit(0)
    if args.per_class<1:ap.error("per-class must be positive")
    sprites=load_sprites()
    for mode,count,seed0 in [("train",args.per_class,100000),("val",8,2000000),("clean",16,3000000),("hard",16,4000000),("rough",16,5000000)]:
        xs,ys,meta=[],[],[]
        for j in range(count):
            for label in range(128):
                crop,m,_=sample(sprites,label,seed0+j*128+label,mode)
                xs.append(crop);ys.append(label);meta.append(m)
        np.savez_compressed(args.out/f"{mode}.npz",x=np.stack(xs),y=np.array(ys))
        (args.out/f"{mode}.json").write_text(json.dumps(dict(seed_start=seed0,count=len(ys),samples=meta)))
        contact_sheet(xs[:32],[f"S{y//64} R{y%64//2} M{y%2}" for y in ys[:32]],args.out/f"{mode}.png")
        print(mode,len(ys),flush=True)
