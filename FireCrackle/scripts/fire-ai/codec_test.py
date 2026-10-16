"""Held-out animated shots through real H.264, not JPEG/block approximations.

160x160 local scene, not a YouTube bitrate simulation. Codec state resets at
each32-frame shot. Exact same pixel crops are evaluated before/after encoding.
"""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path
import numpy as np
from render import SIZE,ROOT,load_sprites,random_quad,background,raster,rectify,contact_sheet


def main():
    ap=argparse.ArgumentParser();ap.add_argument("out",type=Path);ap.add_argument("--ffmpeg",type=Path,required=True);args=ap.parse_args()
    args.out.mkdir(parents=True,exist_ok=True);sprites=load_sprites();frames=[];cases=[]
    for shot in range(32):
        rng=np.random.default_rng(6000000+shot);q=random_quad(rng,True);bg=background(rng);brightness=rng.uniform(.4,1)
        sheet,mirror=shot%2,(shot//2)%2
        for frame in range(32):
            row=(shot//4*4+frame//3)%32;label=sheet*64+row*2+mirror
            qq=q+[np.sin(frame*.12)*.4,np.cos(frame*.12)*.4]
            rgba=raster(sprites[label],qq);im=bg.copy();mask=rgba[:,:,3]>0
            im[mask]=np.uint8(rgba[mask,:3]*brightness)
            frames.append(im);cases.append(dict(shot=shot,frame=len(frames)-1,quad=(qq/SIZE).tolist(),expected=[sheet,row,bool(mirror)],split="validation",source="synthetic",visibility=1,veil=0,id=f"{shot}-{frame}"))
    raw=np.stack(frames);ys=np.array([c["expected"][0]*64+c["expected"][1]*2+int(c["expected"][2]) for c in cases])
    manifest=dict(width=SIZE,height=SIZE,samples=cases,seed_start=6000000,shots=32,joined_sha256=None)
    (args.out/"manifest.json").write_text(json.dumps(manifest))
    meta={"ffmpeg":subprocess.check_output([str(args.ffmpeg),"-version"],text=True).splitlines()[0],"raw_sha256":hashlib.sha256(raw.tobytes()).hexdigest()}
    for crf in [None,24,32]:
        name="uncompressed" if crf is None else f"h264-crf{crf}"
        if crf is None:decoded=raw
        else:
            movie=args.out/f"{name}.mp4"
            command=[str(args.ffmpeg),"-v","error","-y","-f","rawvideo","-pix_fmt","rgb24","-s",f"{SIZE}x{SIZE}","-r","60","-i","pipe:0","-c:v","libx264","-preset","medium","-crf",str(crf),"-pix_fmt","yuv420p","-g","32","-keyint_min","32","-sc_threshold","0",str(movie)]
            subprocess.run(command,input=raw.tobytes(),check=True)
            buf=subprocess.check_output([str(args.ffmpeg),"-v","error","-i",str(movie),"-f","rawvideo","-pix_fmt","rgb24","pipe:1"])
            decoded=np.frombuffer(buf,np.uint8).reshape(raw.shape);meta[name]=dict(command=command,sha256=hashlib.sha256(movie.read_bytes()).hexdigest())
        crops=np.stack([rectify(im,np.array(c["quad"])*SIZE) for im,c in zip(decoded,cases)])
        np.savez_compressed(args.out/f"{name}.npz",x=crops,y=ys)
        contact_sheet(crops[::32],[f"shot {i}" for i in range(32)],args.out/f"{name}.png")
        # A fixed balanced subset of native scenes is available to production
        # matcher evaluation. It receives full native pixels and supplied quad.
        native=args.out/name;native.mkdir(exist_ok=True)
        selected=[c for c in cases if c["frame"]%8==0]
        (native/"manifest.json").write_text(json.dumps({**manifest,"samples":selected}))
        for c in selected:(native/f'{c["frame"]}.rgb').write_bytes(decoded[c["frame"]].tobytes())
        print(name,len(crops),flush=True)
    (args.out/"codec.json").write_text(json.dumps(meta,indent=2))


if __name__=="__main__":main()
