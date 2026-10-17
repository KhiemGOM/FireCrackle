"""Fixed 360-way stage ablation, from cached canonical Rust diagnostics. No threshold fitting."""
import argparse,csv,hashlib,itertools,json,subprocess,time
from pathlib import Path
import numpy as np
from pov_gui_ablation import ROOT,SOURCES,truth_for
OUT=ROOT/'.board/pov-gui-stages'
COLOURS=['raw_sum','raw_mean','mask_sum','mask_mean','mask_neutral']
COVERAGES=['opaque','opaque_items','all_gui'];GATES=['frozen','raw','neutral','visible'];FOVS=['frozen','visible','neutral']
CONFIGS=[{'coverage':p,'silhouette':s,'colour':c,'gate':g,'fov':f} for p,s,c,g,f in itertools.product(COVERAGES,[0,1],COLOURS,GATES,FOVS)]
P=np.array([COVERAGES.index(c['coverage'])+1 for c in CONFIGS]);S=np.array([c['silhouette'] for c in CONFIGS]);C=np.array([COLOURS.index(c['colour']) for c in CONFIGS]);G=np.array([GATES.index(c['gate']) for c in CONFIGS]);F=np.array([FOVS.index(c['fov']) for c in CONFIGS]);I=np.arange(len(CONFIGS));J=np.arange(2)
FULL=CONFIGS.index({'coverage':'all_gui','silhouette':1,'colour':'mask_sum','gate':'visible','fov':'visible'})
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def combine(record):
    stats=record['stats'];sz=np.array([r['sz'] for r in stats]);cz=np.array([r['cz'] for r in stats]);sums=np.array([r['sum'] for r in stats]);used=np.array([r['used'] for r in stats]);tot=np.array([r['total'] for r in stats]);weight=stats[0]['weight']
    valid=used>=5
    visible=np.divide(sums,used,out=np.zeros_like(sums),where=valid)
    neutral=np.divide(sums,tot,out=np.zeros_like(sums),where=valid)
    base_rows=(sz[:2]+weight*cz[:2]).argmax(axis=1);base_evs=visible[J,base_rows];base_fov=int(base_evs[1]>base_evs[0]);base_row=int(base_rows[base_fov]);base_ev=float(base_evs[base_fov])
    def standardised(values):
        count=valid.sum(axis=1,keepdims=True)
        mean=np.divide(np.where(valid,values,0).sum(axis=1,keepdims=True),count,out=np.zeros((8,1)),where=count>0)
        variance=np.divide(np.where(valid,(values-mean)**2,0).sum(axis=1,keepdims=True),count,out=np.zeros((8,1)),where=count>0)
        sd=np.sqrt(variance);sd=np.where(sd>1e-12,sd,1.)
        return np.where(valid,(values-mean)/sd,-9.)
    zv=standardised(visible);zn=standardised(neutral)
    maskidx=2*P[:,None]+J
    si=np.where(S[:,None]!=0,maskidx,J);ci=np.where(C[:,None]>=2,maskidx,J)
    colour=np.where(((C==0)|(C==2))[:,None,None],cz[ci],np.where((C==4)[:,None,None],zn[ci],zv[ci]))
    rows=(sz[si]+weight*colour).argmax(axis=2)
    raw=visible[J,rows];v=visible[maskidx,rows];n=neutral[maskidx,rows]
    fov=np.where(F==0,base_fov,np.where(F==1,(v[:,1]>v[:,0]).astype(int),(n[:,1]>n[:,0]).astype(int)))
    row=rows[I,fov]
    scores=np.where(G==0,base_ev,np.where(G==1,raw[I,fov],np.where(G==2,n[I,fov],v[I,fov])))
    return row,scores,(base_row,base_ev)
def summarize(frames,truth,rows,scores,base_rows,base_scores):
    truth=np.asarray(truth);positive=truth>=0;accept=scores>=.5;good=accept&(rows==truth[:,None])&positive[:,None];badrow=accept&(rows!=truth[:,None])&positive[:,None];fp=accept&~positive[:,None]
    basegood=(base_scores>=.5)&(base_rows==truth)&positive
    return [{'config':c,'frames':len(frames),'overlay':int(positive.sum()),'correct':int(good[:,k].sum()),'false_positives':int(fp[:,k].sum()),'wrong_rows':int(badrow[:,k].sum()),'candidate_correct':int(((rows[:,k]==truth)&positive).sum()),'new_correct':int((good[:,k]&~basegood).sum()),'lost_correct':int((~good[:,k]&basegood).sum()),'fp_frames':frames[fp[:,k]].tolist(),'wrong_row_frames':frames[badrow[:,k]].tolist()} for k,c in enumerate(CONFIGS)]
def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--sources',nargs='+',default=list(SOURCES));ap.add_argument('--limit',type=int);ap.add_argument('--reuse',action='store_true');args=ap.parse_args();OUT.mkdir(parents=True,exist_ok=True)
    exe=ROOT/'fire-detection/core/target/release/examples/pov_gui_stages.exe';ffmpeg=ROOT/'FireCrackle/src-tauri/runtime/ffmpeg.exe';probe=ffmpeg.with_name('ffprobe.exe')
    files=[ROOT/'fire-detection/core/src/overlay.rs',ROOT/'fire-detection/core/src/gui_mask.rs',ROOT/'fire-detection/core/examples/pov_gui_stages.rs',ROOT/'fire-detection/data/assets/fire_1.rgba',*sorted((ROOT/'fire-detection/data/assets/gui').glob('*rgba'))]
    hashes={str(p.relative_to(ROOT)):sha(p) for p in files};all_results={}
    for name in args.sources:
        truth,last,truth_hash=truth_for(name);stride=5 if name in ['clip1','clip2'] else 30;total=last//stride+1
        if args.limit:total=min(total,args.limit)
        suffix=f'-pilot{args.limit}' if args.limit else '';cache=OUT/f'{name}{suffix}.jsonl';meta=cache.with_suffix('.meta.json')
        video=ROOT/'fire-detection/data/video'/SOURCES[name];stream=json.loads(subprocess.check_output([str(probe),'-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','json',str(video)]))['streams'][0];w,h=stream['width'],stream['height']
        signature={'sources':hashes,'truth_sha256':truth_hash,'stride':stride,'total':total,'threshold':.5,'video':str(video),'video_bytes':video.stat().st_size}
        if args.reuse:
            old=json.loads(meta.read_text())
            assert all(old.get(k)==v for k,v in signature.items() if k!='sources'),'Stale feature cache'
            assert all(old.get('sources',{}).get(k)==v for k,v in hashes.items()),'Stale inference source/assets'
            seconds=old['seconds']
        else:
            start=time.perf_counter();subprocess.run([str(exe),str(video),str(cache),str(w),str(h),str(stride),str(total),str(ffmpeg)],check=True);seconds=time.perf_counter()-start;meta.write_text(json.dumps({**signature,'seconds':seconds},indent=2))
        frames=[];tr=[];rows=[];scores=[];br=[];bs=[];count=0;parity=0
        oldcsv=ROOT/'.board/pov-gui-ablation'/f'{name}.csv';previous={int(r['n']):r for r in csv.DictReader(oldcsv.open())} if oldcsv.exists() else {}
        for line in cache.open():
            r=json.loads(line);count+=1;n=r['n'];rr,ss,(brow,bev)=combine(r)
            if n in previous:
                o=previous[n];assert brow==int(o['base_row']) and abs(bev-float(o['base_ev']))<1e-8
                assert rr[FULL]==int(o['mask_row']) and abs(ss[FULL]-float(o['mask_ev']))<1e-8
                parity+=1
            if n not in truth:continue
            frames.append(n);tr.append(-1 if truth[n]['truth'] is None else truth[n]['truth']);rows.append(rr.astype(np.uint8));scores.append(ss);br.append(brow);bs.append(bev)
        assert count==total and len(set(frames))==len(frames)
        frames=np.array(frames);rows=np.stack(rows);scores=np.stack(scores);tr=np.array(tr);br=np.array(br);bs=np.array(bs)
        results=summarize(frames,tr,rows,scores,br,bs);baseline={'correct':int(((bs>=.5)&(br==tr)&(tr>=0)).sum()),'false_positives':int(((bs>=.5)&(tr<0)).sum()),'wrong_rows':int(((bs>=.5)&(br!=tr)&(tr>=0)).sum())}
        all_results[name]={'baseline':baseline,'results':results,'parity_frames':parity,'seconds':seconds}
        np.savez_compressed(OUT/f'{name}{suffix}-predictions.npz',frames=frames,truth=tr,rows=rows,scores=scores,base_rows=br,base_scores=bs)
        (OUT/f'{name}{suffix}-report.json').write_text(json.dumps(all_results[name],indent=2))
        best=sorted(results,key=lambda r:(r['false_positives']+r['wrong_rows']>0,-r['correct'],r['false_positives']+r['wrong_rows']))[:4]
        print(json.dumps({'source':name,'baseline':baseline,'parity_frames':parity,'best':[{k:r[k] for k in ['config','correct','false_positives','wrong_rows','new_correct','lost_correct']} for r in best]}),flush=True)
    pooled=[]
    for i,c in enumerate(CONFIGS):
        pooled.append({'config':c,**{k:sum(r['results'][i][k] for r in all_results.values()) for k in ['frames','overlay','correct','false_positives','wrong_rows','candidate_correct','new_correct','lost_correct']}})
    report={'threshold':.5,'configs':len(CONFIGS),'analysis_sha256':sha(Path(__file__)),'protocol':'360 fixed combinations; three GUI coverages, raw/masked silhouette, five colour ranking rules including unmasked normalized control, four acceptance rules, three FOV rules; no fitted thresholds; same previous samples and truth','sources':all_results,'pooled':pooled}
    (OUT/('pilot-report.json' if args.limit else 'report.json')).write_text(json.dumps(report,indent=2))
if __name__=='__main__':main()
