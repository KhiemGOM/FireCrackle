"""Screen survival only; do not read quad1 images or model predictions.

Filtering is label-assisted image quality screening, not ground-truth proof.
It preferentially keeps easy/template-consistent examples and is reported as such.
"""
import argparse,collections,hashlib,json,subprocess
from pathlib import Path
import numpy as np
from PIL import Image
from prepare_real import geometry
from render import ROOT,load_sprites,rectify,contact_sheet


def quality(crop,sprite):
    # Use the inner2x2probes of every4x4rectified texel to reduce edge mixing.
    observed=crop.reshape(16,4,16,4,3)[:,1:3,:,1:3].mean(axis=(1,3)).reshape(-1,3)
    expected=sprite[:,:,:3].reshape(-1,3).astype(float)
    opaque=sprite[:,:,3].reshape(-1)>127
    r=np.maximum(observed[:,0],1);R=np.maximum(expected[:,0],1)
    chroma=(r>=20)&(np.abs(observed[:,1]/r-expected[:,1]/R)<=.08)&(np.abs(observed[:,2]/r-expected[:,2]/R)<=.12)&opaque
    if chroma.sum()<16:return dict(coverage=0.,gain=0.,opaque=int(opaque.sum()))
    gain=np.log2(r/R);centre=float(np.median(gain[chroma]))
    hit=chroma&(np.abs(gain-centre)<=.25)
    return dict(coverage=float(hit.sum()/max(opaque.sum(),1)),gain=float(2**centre),opaque=int(opaque.sum()))


def balanced_select(frames):
    if len(frames)==1:return f"eq(n\\,{frames[0]})"
    mid=len(frames)//2
    return f"({balanced_select(frames[:mid])}+{balanced_select(frames[mid:])})"


def main():
    ap=argparse.ArgumentParser();ap.add_argument("out",type=Path);ap.add_argument("--ffmpeg",type=Path,required=True);ap.add_argument("--stride",type=int,default=11);args=ap.parse_args()
    if args.stride<1:ap.error("stride must be positive")
    args.out.mkdir(parents=True,exist_ok=True);sprites=load_sprites();byframe={};counts=collections.Counter()
    joined=ROOT/"fire-detection/data/joined/survival1.jsonl"
    for line in joined.open(encoding="utf8"):
        r=json.loads(line);n=r["n"]
        if n>=54000:break
        if n%args.stride or not r["tick_ok"] or 42000<=n<45000:continue
        label=r["label"];w,h=label["w"],label["h"];items=[]
        for fi,fire in enumerate(label.get("fires",[])):
            if fire["src"]=="overlay":continue
            for qi,q in enumerate(fire.get("quads",[])):
                counts["considered"]+=1;points,error=geometry.canonical_quad(q,w,h)
                if error:counts[error]+=1;continue
                quad=np.asarray(points)/[w,h];native=quad*[1920,1080]
                edges=np.linalg.norm(native-np.roll(native,1,axis=0),axis=1)
                if q["vis"]<.95 or q["veil"]>.05 or quad.min()<.01 or quad.max()>.99 or edges.min()<40 or edges.max()/edges.min()>5:
                    counts["visibility_veil_geometry"]+=1;continue
                items.append(dict(id=f"{n}-{fi}-{qi}",frame=n,quad=quad.tolist(),label=q["s"]*64+q["row"]*2+int(q["m"]),source=fire["src"],split="train" if n<42000 else "val"))
        if items:byframe[n]=items
    frames=sorted(byframe);expression=balanced_select(frames)
    if len(expression)>26000:
        frames=list(range(0,54000,args.stride));expression=f"not(mod(n\\,{args.stride}))"
    command=[str(args.ffmpeg),"-v","error","-i",str(ROOT/"fire-detection/data/video/2026-10-16 18-23-42.mkv"),"-vf",f"select='{expression}'","-frames:v",str(len(frames)),"-fps_mode","passthrough","-pix_fmt","rgb24","-f","rawvideo","pipe:1"]
    proc=subprocess.Popen(command,stdout=subprocess.PIPE);xs=[];ys=[];cases=[]
    for frame in frames:
        buf=bytearray()
        while len(buf)<1920*1080*3:
            chunk=proc.stdout.read(1920*1080*3-len(buf))
            if not chunk:raise RuntimeError(f"truncated native frame {frame}")
            buf.extend(chunk)
        if frame not in byframe:continue
        im=np.frombuffer(buf,np.uint8).reshape(1080,1920,3)
        for c in byframe[frame]:
            crop=rectify(im,np.array(c["quad"])*[1920,1080]);q=quality(crop,sprites[c["label"]]);counts["screened_crops"]+=1
            if q["coverage"]<.70 or not .2<=q["gain"]<=1.3:
                counts["colour_coverage_reject"]+=1;continue
            xs.append(crop);ys.append(c["label"]);cases.append({**c,"quality":q,"crop_sha256":hashlib.sha256(crop.tobytes()).hexdigest()})
        if frame%3300==0:print(frame,"kept",len(cases),flush=True)
    proc.stdout.close()
    if proc.wait()!=0:raise RuntimeError("FFmpeg failed")
    # Conflicting appearances on identical crops are ambiguous; drop all of them.
    labels=collections.defaultdict(set)
    for c in cases:labels[c["crop_sha256"]].add(c["label"])
    seen=set();keep=[]
    for i,c in enumerate(cases):
        key=c["crop_sha256"]
        if len(labels[key])>1:counts["conflicting_exact_crop"]+=1;continue
        if key in seen:counts["duplicate_exact_crop"]+=1;continue
        seen.add(key);keep.append(i)
    summary={"screening":dict(min_vis=.95,max_veil=.05,min_native_edge=40,min_colour_coverage=.70,gain_stop_tolerance=.25,chroma_tolerance=[.08,.12]),"counts":dict(counts),"command":command,"joined_sha256":hashlib.sha256(joined.read_bytes()).hexdigest(),"samples":[cases[i] for i in keep],"splits":{}}
    for split in ["train","val"]:
        ids=[i for i in keep if cases[i]["split"]==split];xx=np.stack([xs[i] for i in ids]);yy=np.array([ys[i] for i in ids])
        np.savez_compressed(args.out/f"{split}.npz",x=xx,y=yy)
        selected=np.random.default_rng(19).choice(len(ids),min(64,len(ids)),replace=False)
        contact_sheet(xx[selected],[cases[ids[i]]["id"] for i in selected],args.out/f"audit-{split}.png")
        summary["splits"][split]=dict(n=len(ids),frames=len(set(cases[i]["frame"] for i in ids)),classes=len(set(yy.tolist())),class_counts=dict(collections.Counter(yy.tolist())),sources=dict(collections.Counter(cases[i]["source"] for i in ids)))
    (args.out/"manifest.json").write_text(json.dumps(summary,indent=2));print(json.dumps({k:v for k,v in summary.items() if k in ["counts","splits"]}),flush=True)


if __name__=="__main__":main()
