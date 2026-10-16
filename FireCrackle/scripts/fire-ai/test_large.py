"""Fresh held-out real-background synthetic test; never updates model weights."""
import argparse,json
from pathlib import Path
import numpy as np
import torch
from torch.nn import functional as F
from train import checkpoint_model,evaluate
from gpu_render import Renderer,homography,projected,mask_input
from train_large import frozen_samples
from render import contact_sheet


def save_result(model,x,y,directory,name,device):
    metrics,order,confidence=evaluate(model,x,y,device)
    np.savez(directory/f'predictions-{name}.npz',order=order.numpy(),confidence=confidence.numpy(),truth=y.numpy())
    wrong=torch.where(order[:,0]!=y)[0].numpy()[:32]
    if len(wrong):contact_sheet(np.uint8(((x[wrong,:3]+1)/2*255).numpy().transpose(0,2,3,1)),[f'T{int(y[i])} P{int(order[i,0])}' for i in wrong],directory/f'errors-{name}.png')
    return metrics


def main():
    ap=argparse.ArgumentParser();ap.add_argument('checkpoint',type=Path);ap.add_argument('backgrounds',type=Path);ap.add_argument('out',type=Path);args=ap.parse_args()
    args.out.mkdir(parents=True,exist_ok=True);torch.set_num_threads(4);device=torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    renderer=Renderer(np.load(args.backgrounds/'val.npz')['x'],device)
    model=checkpoint_model(torch.load(args.checkpoint,map_location='cpu',weights_only=True)).to(device)
    xx,y=frozen_samples(renderer,4096,30000000)
    result={'synthetic_real_backgrounds':save_result(model,xx,y,args.out,'real-bg',device)}
    # Ordinary real-background patches with no synthetic foreground. The model
    # has no explicit no-fire class; softmax gates are diagnostic only.
    with torch.inference_mode():
        generator=torch.Generator(device=device).manual_seed(40000000)
        rand=lambda *s:torch.rand(*s,device=device,generator=generator)
        q=renderer.quads(256,rand);xy=projected(homography(q),renderer.uv).reshape(256,64,64,2)
        ids=torch.randint(len(renderer.backgrounds),(256,),device=device,generator=generator)
        image=renderer.backgrounds[ids].float()/255
        crop=F.grid_sample(image,xy/80-1,align_corners=False)
        negatives=mask_input((crop*255).floor()/255).cpu()
    result['no_fire_real_backgrounds']=save_result(model,negatives,torch.full((256,),-1,dtype=torch.long),args.out,'negative-bg',device)
    (args.out/'results.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2),flush=True)


if __name__=='__main__':main()
