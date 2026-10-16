"""Apply frozen synthetic-selected checkpoint; never update weights on real data."""
import argparse
import json
import time
from pathlib import Path
import numpy as np
import torch
from train import make_model,inputs,evaluate
from render import contact_sheet


def main():
    ap=argparse.ArgumentParser();ap.add_argument("checkpoint",type=Path);ap.add_argument("data",type=Path);ap.add_argument("--names",nargs="+",default=["real"]);args=ap.parse_args()
    torch.set_num_threads(4);device=torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model=make_model().to(device);checkpoint=torch.load(args.checkpoint,map_location=device,weights_only=True);model.load_state_dict(checkpoint["state_dict"])
    result={"checkpoint_epoch":checkpoint["epoch"]}
    for name in args.names:
        data=np.load(args.data/f"{name}.npz");y=torch.tensor(data["y"],dtype=torch.long);start=time.perf_counter()
        xx=inputs(data["x"]);metrics,order,confidence=evaluate(model,xx,y,device);metrics["elapsed_seconds"]=time.perf_counter()-start
        result[name]=metrics
        np.savez(args.data/f"predictions-{name}.npz",order=order.numpy(),confidence=confidence.numpy(),truth=y.numpy())
        wrong=torch.where(order[:,0]!=y)[0].numpy()[:32]
        if len(wrong):contact_sheet(data["x"][wrong],[f"T{int(y[i])} P{int(order[i,0])} {confidence[i]:.2f}" for i in wrong],args.data/f"errors-{name}.png")
    (args.data/"model-results.json").write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2),flush=True)


if __name__=="__main__":main()
