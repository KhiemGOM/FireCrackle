"""Re-score historical detector outputs for no-fire triage; never drop small-fire truth."""
import argparse,csv,json
from pathlib import Path
import numpy as np
from train import threshold_zero_false_clear
ROOT=Path(__file__).resolve().parents[3]
DATA=ROOT/'fire-detection/data/joined'

def rows(name):
 with (DATA/name).open() as f:return [{k:float(v) if v not in ('','nan') else np.nan for k,v in r.items()} for r in csv.DictReader(f)]

def report(scores,fire,cal,test):
 scores=np.asarray(scores);fire=np.asarray(fire,bool);t=threshold_zero_false_clear(scores[cal],fire[cal]);clear=scores<t
 return {'threshold':t,'calibration_fire':int((fire&cal).sum()),'calibration_false_clears':int((clear&fire&cal).sum()),'calibration_no_fire':int((~fire&cal).sum()),'calibration_cleared_no_fire':int((clear&~fire&cal).sum()),'test_fire':int((fire&test).sum()),'false_clear_fire':int((clear&fire&test).sum()),'test_no_fire':int((~fire&test).sum()),'cleared_no_fire':int((clear&~fire&test).sum()),'no_fire_coverage':float((clear&~fire&test).sum()/max(1,(~fire&test).sum()))}

def stump_tree(x,y,depth=3):
 # Tiny, deterministic, balanced tree; keep legacy blob families without a new dependency.
 rng=np.random.default_rng(71)
 if len(x)>50000:ids=rng.choice(len(x),50000,replace=False);x=x[ids];y=y[ids]
 weights=np.where(y, .5/max(1,y.sum()),.5/max(1,(~y).sum()))
 def node(ids,d):
  total=weights[ids].sum();p=float(weights[ids][y[ids]].sum()/max(total,1e-12))
  if not d or len(ids)<40:return {'p':p}
  best=None;loss=float('inf')
  for j in range(x.shape[1]):
   for cut in np.unique(np.quantile(x[ids,j],np.linspace(.05,.95,15))):
    left=x[ids,j]<=cut
    if min(left.sum(),(~left).sum())<20:continue
    cost=0
    for mask in (left,~left):
     w=weights[ids[mask]];v=float(w[y[ids[mask]]].sum()/w.sum());cost+=float(w.sum())*v*(1-v)
    if cost<loss:loss=cost;best=(j,float(cut),ids[left],ids[~left])
  if best is None:return {'p':p}
  j,t,l,r=best;return {'f':j,'t':t,'l':node(l,d-1),'r':node(r,d-1)}
 return node(np.arange(len(x)),depth)

def tree_predict(tree,x):
 out=np.empty(len(x))
 def visit(n,ids):
  if 'p'in n:out[ids]=n['p'];return
  left=x[ids,n['f']]<=n['t'];visit(n['l'],ids[left]);visit(n['r'],ids[~left])
 visit(tree,np.arange(len(x)));return out

def main():
 ap=argparse.ArgumentParser();ap.add_argument('out',type=Path);args=ap.parse_args();result={'caveat':'Historical features and predictions are re-used, not regenerated. These clips informed original detector development. Only the acceptance objective is new; this is not independent validation. All labelled fire remains positive, including tiny/far.','methods':{}}
 for filename,cols in [('features10.csv',['r_cnt','r_strict','r_bright','r_blobs20','r_largest','r_inbig50','r_rough','u_cnt','u_largest']),('colorfilter10.csv',None),('flicker5.csv',['t30_tot','t30_in6','t30_big','t60_tot','t60_in6','t60_big']),('frames3.csv',['positives','largest','max_p'])]:
  rr=rows(filename);n=np.array([r['n'] for r in rr]);fire=[r['fire'] for r in rr];cut=np.quantile(n,.6);cal=n<=cut;test=n>cut
  if cols is None:cols=[k for k in rr[0] if k.startswith('c')]
  for col in cols:result['methods'][filename+':'+col]=report([r[col] for r in rr],fire,cal,test)
 # First-person acceptance cannot justify whole-frame absence; join whole-frame truth explicitly.
 for key in ['fin_ev','fin_pres']:
  rr=rows('overlay5_clip1_h.csv');truth={int(r['n']):r['fire'] for r in rows('frames5_A.csv')};rr=[r for r in rr if int(r['n']) in truth];n=np.array([r['n'] for r in rr]);cut=np.quantile(n,.6)
  result['methods']['overlay:'+key]=report([r[key] for r in rr],[truth[int(r['n'])] for r in rr],n<=cut,n>cut)
 # Refit legacy blob-shape families, with disjoint temporal fit/calibration/test sections.
 for config in ['A','B','C']:
  d=np.loadtxt(DATA/f'blobs5_{config}.csv',delimiter=',',skiprows=1);rr=rows(f'frames5_{config}.csv');n=np.array([r['n'] for r in rr]);cut=np.quantile(n,.6);calcut=np.quantile(n,.8);ids=(d[:,0]<=cut)&(d[:,-1]>=0);tree=stump_tree(d[ids,1:11],d[ids,-1]>0);scores=tree_predict(tree,d[:,1:11]);pooled=np.zeros(int(n.max())+1);np.maximum.at(pooled,d[:,0].astype(int),scores)
  result['methods']['learned_blob_'+config]=report(pooled[n.astype(int)],[r['fire'] for r in rr],(n>cut)&(n<=calcut),n>calcut)
 args.out.mkdir(parents=True,exist_ok=True);(args.out/'legacy-report.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
if __name__=='__main__':main()
