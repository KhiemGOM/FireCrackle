"""Geometry-only screening, independent of model predictions; never auto-certify labels.

Survival candidates remain an audit set: vis does not account for every other
fire plane, and this capture has no game-mode field to prove survival/creative.
"""
import argparse
import collections
import importlib.util
import json
import subprocess
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
from render import ROOT,rectify,load_sprites

spec=importlib.util.spec_from_file_location("prepare_actual",ROOT/"FireCrackle/scripts/prepare-actual-quad-eval.py")
geometry=importlib.util.module_from_spec(spec);spec.loader.exec_module(geometry)


def survival_candidates():
    candidates=[];skips=collections.Counter();last=-10000
    path=ROOT/"fire-detection/data/joined/survival1.jsonl"
    for line in path.open(encoding="utf8"):
        r=json.loads(line)
        if r["n"]%120 or r["n"]-last<300 or not r["tick_ok"]:continue
        label=r["label"];w,h=label["w"],label["h"];frame=[]
        for fi,fire in enumerate(label.get("fires",[])):
            if fire["src"]=="overlay":continue
            for qi,q in enumerate(fire.get("quads",[])):
                quad,error=geometry.canonical_quad(q,w,h)
                if error:skips[error]+=1;continue
                quad=np.asarray(quad)/[w,h]
                native=quad*[1920,1080];edges=np.linalg.norm(native-np.roll(native,1,axis=0),axis=1)
                if q["vis"]<.95 or q["veil"]>.05 or quad.min()<.01 or quad.max()>.99 or edges.min()<40 or edges.max()/edges.min()>5:
                    skips["visibility_veil_geometry"]+=1;continue
                frame.append(dict(id=f'{r["n"]}-{fi}-{qi}',frame=r["n"],quad=quad.tolist(),expected=[q["s"],q["row"],bool(q["m"])],source=fire["src"],visibility=q["vis"],veil=q["veil"],split="validation"))
        if frame:
            # Largest minimum edge, not best image/model score. At most one per
            # 5 seconds; cap64 to make contact-sheet review tractable.
            frame.sort(key=lambda x:min(np.linalg.norm((np.array(x["quad"])-np.roll(x["quad"],1,axis=0))*[1920,1080],axis=1)),reverse=True)
            candidates.append(frame[0]);last=r["n"]
        if len(candidates)>=64:break
    return candidates,dict(skips)


def decode_frames(ffmpeg,video,frames,out):
    expression="+".join(f"eq(n\\,{n})" for n in frames)
    proc=subprocess.Popen([str(ffmpeg),"-v","error","-i",str(video),"-vf",f"select='{expression}'","-fps_mode","passthrough","-pix_fmt","rgb24","-f","rawvideo","pipe:1"],stdout=subprocess.PIPE)
    try:
        for n in frames:
            buf=bytearray()
            while len(buf)<1920*1080*3:
                chunk=proc.stdout.read(1920*1080*3-len(buf))
                if not chunk:raise RuntimeError(f"truncated frame {n}")
                buf.extend(chunk)
            (out/f"{n}.rgb").write_bytes(buf)
    finally:proc.stdout.close()
    if proc.wait()!=0:raise RuntimeError("frame decode failed")


def prepare(args):
    args.out.mkdir(parents=True,exist_ok=True);sprites=load_sprites()
    if args.dataset=="survival":
        cases,skips=survival_candidates();w,h=1920,1080
        decode_frames(args.ffmpeg,ROOT/"fire-detection/data/video/2026-10-16 18-23-42.mkv",sorted(set(c["frame"] for c in cases)),args.out)
        source=args.out
    else:
        source=ROOT/"FireCrackle/src-tauri/target/actual-quad1"
        manifest=json.loads((source/"manifest.json").read_text());w,h=manifest["width"],manifest["height"]
        cases=[c for c in manifest["samples"] if c["split"]=="validation"];skips={}
    xs,ys,kept=[],[],[];cache={}
    for c in cases:
        if c["frame"] not in cache:cache[c["frame"]]=np.fromfile(source/f'{c["frame"]}.rgb',np.uint8).reshape(h,w,3)
        crop=rectify(cache[c["frame"]],np.asarray(c["quad"])*[w,h])
        s,r,m=c["expected"];xs.append(crop);ys.append(s*64+r*2+int(m));kept.append(c)
    np.savez_compressed(args.out/"real.npz",x=np.stack(xs),y=np.array(ys))
    manifest=dict(dataset=args.dataset,width=w,height=h,samples=kept,skips=skips,screening="geometry-only, not visually certified")
    (args.out/"manifest.json").write_text(json.dumps(manifest))
    # Rectified observation beside exact reference over a neutral background.
    ims=[];captions=[]
    for c,crop,y in zip(kept,xs,ys):
        ref=sprites[y].copy();ref[ref[:,:,3]==0]=[30,30,30,255]
        reference=np.asarray(Image.fromarray(ref[:,:,:3]).resize((64,64),Image.Resampling.NEAREST))
        ims.append(np.concatenate([crop,reference],axis=1));captions.append(c["id"])
    # Preserve2:1aspect in custom paired sheet.
    canvas=Image.new("RGB",(4*256,((len(ims)+3)//4)*150),(20,24,31));draw=ImageDraw.Draw(canvas)
    for i,(im,caption) in enumerate(zip(ims,captions)):
        x,y=(i%4)*256,(i//4)*150;canvas.paste(Image.fromarray(im).resize((256,128),Image.Resampling.NEAREST),(x,y));draw.text((x+3,y+130),caption,fill="white")
    canvas.save(args.out/"audit.png")
    print(json.dumps(dict(dataset=args.dataset,candidates=len(kept),frames=len(cache),skips=skips)),flush=True)


if __name__=="__main__":
    ap=argparse.ArgumentParser();ap.add_argument("dataset",choices=["quad1","survival"]);ap.add_argument("out",type=Path);ap.add_argument("--ffmpeg",type=Path);prepare(ap.parse_args())
