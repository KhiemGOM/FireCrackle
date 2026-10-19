"""Recount held-recording phase predictions, inspect splits and export evidence."""
import csv,hashlib,json
from collections import Counter,defaultdict
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw

def main(out):
    rows=json.loads((out/'selected.json').read_text());results=json.loads((out/'results.json').read_text());data=np.load(out/'real.npz');records=[]
    assert len(rows)==len(data['y'])==456
    assert all(r['phase']==int(y) for r,y in zip(rows,data['y']))
    for kind in ['orange','soul']:
        a={r['frame'] for r in rows if r['kind']==kind and r['split']=='tune'};b={r['frame'] for r in rows if r['kind']==kind and r['split']=='validation'}
        assert not a&b and min(b)-max(a)>=240
    background=json.loads(Path(results['config']['backgrounds'],'manifest.json').read_text())
    target_videos={Path(r['dir'],'manifest.json') for r in rows};target_names={Path(json.loads(p.read_text())['video']).name for p in target_videos}
    assert not target_names&{s['video'] for s in background['sources'].values()}
    details={}
    for name,fold in results['results'].items():
        kind=fold['test_kind'];pred=np.load(out/f'predictions-{kind}.npz');ids=pred['indices'];logits=pred['logits'];prob=np.exp(logits-logits.max(1,keepdims=True));prob/=prob.sum(1,keepdims=True);order=np.argsort(-logits,axis=1);correct=order[:,0]==pred['truth'];confidence=prob.max(1);threshold=fold['adapted']['threshold'];accept=confidence>=threshold
        assert all(rows[i]['kind']!=fold['train_kind'] and rows[i]['split']=='validation' for i in ids)
        assert int(correct.sum())==fold['adapted']['correct'];assert int((accept&~correct).sum())==fold['adapted']['accepted_wrong']
        frames=defaultdict(list);pairs=Counter()
        for j,i in enumerate(ids):
            row=rows[int(i)];frames[row['frame']].append(bool(correct[j]));pairs[int(pred['truth'][j]),int(order[j,0])]+=int(not correct[j])
            records.append(dict(test_video=kind,id=row['id'],frame=row['frame'],source=row['source'],phase=int(pred['truth'][j]),prediction=int(order[j,0]),top3=' '.join(map(str,order[j,:3])),confidence=float(confidence[j]),correct=int(correct[j]),accepted=int(accept[j]),deterministic_phase=row['baselinePhase'],deterministic_correct=int(row['baselinePhase']==row['phase'])))
        details[kind]=dict(frames=len(frames),observed_phases=len(set(pred['truth'].tolist())),mean_frame_accuracy=float(np.mean([np.mean(v) for v in frames.values()])),confusions=[dict(truth=a,prediction=b,n=n) for (a,b),n in pairs.most_common(8) if n])
        wrong=np.where(~correct)[0][:24];canvas=Image.new('RGB',(6*160,((len(wrong)+5)//6)*190),(20,24,31));draw=ImageDraw.Draw(canvas)
        for index,j in enumerate(wrong):
            i=int(ids[j]);x=(index%6)*160;y=(index//6)*190;canvas.paste(Image.fromarray(data['x'][i]).resize((160,160),Image.Resampling.NEAREST),(x,y));draw.text((x+3,y+162),f"{rows[i]['id']}\nphase {pred['truth'][j]} -> {order[j,0]}",fill='white')
        if len(wrong):canvas.save(out/f'errors-{kind}.png')
    with (Path(__file__).parent/'predictions.csv').open('w',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=records[0]);writer.writeheader();writer.writerows(records)
    details['n']=len(records);details['source_hashes']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in Path(__file__).parent.iterdir() if p.suffix in ['.py','.mjs']};(out/'audit.json').write_text(json.dumps(details,indent=2));print(json.dumps(details,indent=2))

if __name__=='__main__':
    import sys
    main(Path(sys.argv[1]))
