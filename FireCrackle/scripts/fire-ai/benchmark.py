"""Local model and crop-to-result timings; no promised application latency."""
import argparse,json,time
from pathlib import Path
import numpy as np
import torch
from render import rectify
from train import checkpoint_model,inputs


def stats(times):return dict(median_ms=float(np.median(times)),p95_ms=float(np.quantile(times,.95)))


def main():
    ap=argparse.ArgumentParser();ap.add_argument("checkpoint",type=Path);ap.add_argument("real",type=Path);args=ap.parse_args()
    torch.set_num_threads(4);model=checkpoint_model(torch.load(args.checkpoint,map_location="cpu",weights_only=True)).eval()
    manifest=json.loads((args.real/"manifest.json").read_text());c=manifest["samples"][1];w,h=manifest["width"],manifest["height"]
    image=np.fromfile(args.real/f'{c["frame"]}.rgb',np.uint8).reshape(h,w,3);quad=np.array(c["quad"])*[w,h]
    one=inputs(np.array([rectify(image,quad)]));out={"torch":torch.__version__,"cpu_threads":4,"includes":"rectification, rough mask, normalization, model forward and argmax; decoded native frame already in RAM"}
    with torch.inference_mode():
        for _ in range(20):model(one)
        times=[]
        for _ in range(200):
            start=time.perf_counter();xx=inputs(np.array([rectify(image,quad)]));model(xx).argmax(1);times.append((time.perf_counter()-start)*1000)
        out["cpu_end_to_end"]=stats(times)
        if torch.cuda.is_available():
            model.cuda();gpu=one.cuda()
            for _ in range(30):model(gpu)
            torch.cuda.synchronize();times=[]
            for _ in range(200):
                start=time.perf_counter();xx=inputs(np.array([rectify(image,quad)])).cuda();model(xx).argmax(1).cpu();torch.cuda.synchronize();times.append((time.perf_counter()-start)*1000)
            out["cuda_batch1_end_to_end"]=stats(times)
            gpu=one.expand(256,-1,-1,-1).contiguous().cuda()
            for _ in range(20):model(gpu)
            torch.cuda.synchronize();times=[]
            for _ in range(50):
                start=time.perf_counter();model(gpu);torch.cuda.synchronize();times.append((time.perf_counter()-start)*1000)
            out["cuda_batch256_model_only"]=stats(times);out["gpu"]=torch.cuda.get_device_name()
    (args.checkpoint.parent/"timings.json").write_text(json.dumps(out,indent=2));print(json.dumps(out,indent=2))


if __name__=="__main__":main()
