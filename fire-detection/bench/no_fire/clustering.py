"""Learn RGB clusters on training frames only; compare clustering with native evidence."""
import argparse,json
from pathlib import Path
import numpy as np
from features import unveil
from train import fit,threshold_zero_false_clear,metrics
from model import export_model,predict
from PIL import Image,ImageDraw

def indices(rgb):
 q=(rgb.astype(np.int32)//16);return q[:,:,0]*256+q[:,:,1]*16+q[:,:,2]

def fit_clusters(images,k=16):
 hist=np.zeros(4096)
 for rgb in images:hist+=np.bincount(indices(rgb).ravel(),minlength=4096)
 values=np.indices((16,16,16)).reshape(3,-1).T*16+7.5;rng=np.random.default_rng(912);centres=values[rng.choice(4096,k,replace=False,p=hist/hist.sum())].copy()
 for _ in range(40):
  assignment=((values[:,None]-centres[None])**2).sum(2).argmin(1)
  for j in range(k):
   mask=assignment==j
   if hist[mask].sum():centres[j]=np.average(values[mask],axis=0,weights=hist[mask])
 return centres,((values[:,None]-centres[None])**2).sum(2).argmin(1)

def clustered(rgb,lut):
 rgb=rgb[max(2,int(rgb.shape[0]*.012)):];assigned=lut[indices(rgb)];h,w=assigned.shape;out=[]
 out.extend(np.bincount(assigned.ravel(),minlength=16)/assigned.size)
 cells=[]
 for y in np.array_split(assigned,4):
  for patch in np.array_split(y,4,axis=1):cells.append(np.bincount(patch.ravel(),minlength=16)/patch.size)
 cells=np.asarray(cells);out.extend(cells.max(0));out.extend(np.quantile(cells,.75,axis=0));out.extend(np.bincount(assigned[h//2:].ravel(),minlength=16)/assigned[h//2:].size)
 return np.asarray(out,np.float32)

def main():
 ap=argparse.ArgumentParser();ap.add_argument('data',type=Path);args=ap.parse_args();data={n:np.load(args.data/f'{n}.npz') for n in ['clip1','clip2','quad1','survival1']};split=int(len(data['clip1']['x'])*.7)-4
 centres,lut=fit_clusters(data['clip1']['thumbs'][:split]);np.savez(args.data/'color-clusters.npz',centres=centres,lut=lut);features={}
 for n,d in data.items():
  raw=[];auto=[]
  for image in d['thumbs']:
   raw.append(clustered(image,lut));corrected,_,_=unveil(image);auto.append(clustered(corrected,lut))
  features[n]={'cluster_raw':np.stack(raw),'cluster_auto':np.concatenate([raw,auto],axis=1)}
  features[n]['cluster_plus_native_unveil']=np.concatenate([d['x'],features[n]['cluster_auto']],axis=1)
 report={'scope':'RGB k-means16 trained only on clip1 fit frames. Clustering sees 256x144 thumbnails (tiny fire can disappear); native combined variant also sees original-pixel evidence. Neither uses truth geometry/rows. No retuning from test outcomes.','models':{}}
 for variant in ['cluster_raw','cluster_auto','cluster_plus_native_unveil']:
  x={n:f[variant] for n,f in features.items()};model,mean,scale,training=fit(x['clip1'],data['clip1']['truth'][:,0]);portable=export_model(model,mean,scale,0,args.data/f'{variant}.json');scores={n:predict(portable,v) for n,v in x.items()};threshold=threshold_zero_false_clear(scores['clip2'],data['clip2']['truth'][:,0]);portable['threshold']=threshold;(args.data/f'{variant}.json').write_text(json.dumps(portable));report['models'][variant]={'training':training,'datasets':{n:metrics(scores[n],d['truth'],threshold) for n,d in data.items()}}
  for n,d in data.items():
   np.save(args.data/f'{variant}-{n}-scores.npy',scores[n]);bad=np.flatnonzero((scores[n]<threshold)&(d['truth'][:,0]>0))[:32]
   if len(bad):
    canvas=Image.new('RGB',(4*256,((len(bad)+3)//4)*166));draw=ImageDraw.Draw(canvas)
    for j,i in enumerate(bad):
     xx,yy=j%4*256,j//4*166;canvas.paste(Image.fromarray(d['thumbs'][i]),(xx,yy));draw.text((xx+2,yy+145),f"frame {d['frames'][i]} score {scores[n][i]:.4f}",fill='white')
    canvas.save(args.data/f'{variant}-{n}-false-clears.png')
 (args.data/'clustering-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
if __name__=='__main__':main()
