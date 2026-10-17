"""Validate every saved comparison, retain paired changes, and render audit cases."""
import json,hashlib
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
from core import torch
from render import ROOT,rectify,load_sprites

OUT=ROOT/'.board/occlusion-mask'
RUNS=['survival','synthetic','mixed']
DATASETS=['quad1-exact','quad1-rough','survival-exact','survival-rough','reviewed-exact','reviewed-rough','additional-exact','additional-rough','synthetic','codec-uncompressed','codec-h264-crf24','codec-h264-crf32']


def read(path):return json.loads(path.read_text())


def main():
    reports={};intervals={};changed={}
    for run in RUNS:
        frozen=read(OUT/run/'freeze.json')
        assert hashlib.sha256((OUT/run/'best.pt').read_bytes()).hexdigest()==frozen['checkpoint_sha256']
        used=[int(s.split('-')[0]) for s in frozen['real_train_ids']+frozen['real_selection_ids']]
        for dataset in DATASETS:
            r=read(OUT/run/'scores'/dataset/'results.json');reports[run,dataset]=r
            assert r['n']==len(r['rows'])
            for name,v in r['summary'].items():
                for row in r['rows']:
                    t=row['expected'][0]*64+row['expected'][1]*2+int(row['expected'][2])
                    assert row['methods'][name]['correct']==(row['has_target'] and row['methods'][name]['top']==t)
                assert v['top1']==sum(row['methods'][name]['correct'] for row in r['rows'])
                assert v['wrongClear']==sum(row['methods'][name]['clear'] and not row['methods'][name]['correct'] for row in r['rows'])
            if dataset.startswith(('survival-','additional-')):assert all(abs(s['frame']-f)>60 for s in r['rows'] for f in used)
            for name,digest in r['hashes'].items():assert hashlib.sha256((ROOT/f'FireCrackle/src/lib/{name}.ts').read_bytes()).hexdigest()==digest
            if run!=RUNS[0]:
                base=reports[RUNS[0],dataset];assert base['hashes']==r['hashes']
                assert [(x['id'],x['expected'],x['frame']) for x in r['rows']]==[(x['id'],x['expected'],x['frame']) for x in base['rows']]
                assert r['summary']['colour']==base['summary']['colour']
            if not dataset.startswith(('codec-','reviewed-')) and dataset!='synthetic':
                frames=sorted({s['frame'] for s in r['rows']});groups=[[s for s in r['rows'] if s['frame']==frame] for frame in frames]
                rng=np.random.default_rng(1701);draws=rng.integers(0,len(groups),(10000,len(groups)));sizes=np.array([len(g) for g in groups])
                delta=np.array([sum(int(x['methods']['learned_soft']['correct'])-int(x['methods']['colour']['correct']) for x in g) for g in groups])
                lo,hi=np.quantile(100*delta[draws].sum(1)/sizes[draws].sum(1),[.025,.975])
                intervals[f'{run}/{dataset}']=dict(net=int(delta.sum()),frames=len(frames),percentage_point_interval=[float(lo),float(hi)])
                changed[f'{run}/{dataset}']=[s for s in r['rows'] if s['methods']['colour']['correct']!=s['methods']['learned_soft']['correct']]
    # Existing baseline reproduces the prior untouched diagnostic exactly.
    assert reports['survival','quad1-exact']['summary']['colour']['top1']==87
    assert reports['survival','quad1-rough']['summary']['colour']['top1']==59
    result=dict(cases_per_run=sum(reports[RUNS[0],d]['n'] for d in DATASETS),runs=RUNS,
                primary_mask='learned_soft',paired_frame_intervals=intervals,
                summaries={f'{run}/{dataset}':dict(n=r['n'],targetCases=r['targetCases'],summary=r['summary']) for (run,dataset),r in reports.items()})
    result['method_predictions']=sum(r['n']*len(r['summary']) for r in reports.values())
    (OUT/'summary.json').write_text(json.dumps(result,indent=2));(OUT/'paired-changes.json').write_text(json.dumps(changed,indent=2))
    def table(columns,rows):return '\n'.join(['| '+' | '.join(columns)+' |','|'+'---|'*len(columns)]+['| '+' | '.join(map(str,row))+' |' for row in rows])
    real=DATASETS[:8]
    rows=[['Current colour']+[reports['survival',d]['summary']['colour']['top1'] for d in real]]
    for run in RUNS:
        for mask in ['learned_soft','learned_half','learned_hard']:
            rows.append([run+'/'+mask]+[reports[run,d]['summary'][mask]['top1'] for d in real])
    for mask in ['opening','majority']:rows.append([mask]+[reports['survival',d]['summary'][mask]['top1'] for d in real])
    (OUT/'table-real.md').write_text(table(['Method']+real,rows))
    cols=DATASETS[9:];rows=[['Current colour']+[reports['survival',d]['summary']['colour']['top1'] for d in cols]]
    for run in RUNS:
        for mask in ['learned_soft','learned_half','learned_hard']:rows.append([run+'/'+mask]+[reports[run,d]['summary'][mask]['top1'] for d in cols])
    for mask in ['opening','majority']:rows.append([mask]+[reports['survival',d]['summary'][mask]['top1'] for d in cols])
    (OUT/'table-codec.md').write_text(table(['Method']+cols,rows))
    rows=[]
    for kind in ['clean','background_patch','rod','white_ui','smoke','other_fire','aligned_fire','no_target']:
        samples=[s for s in reports['survival','synthetic']['rows'] if s['source']==kind]
        row=[kind,sum(s['methods']['colour']['correct'] for s in samples)]
        for run in RUNS:row.append(sum(s['methods']['learned_soft']['correct'] for s in reports[run,'synthetic']['rows'] if s['source']==kind))
        row.append(sum(s['methods']['oracle']['correct'] for s in samples));rows.append(row)
    (OUT/'table-synthetic.md').write_text(table(['Condition','Colour','Survival soft','Synthetic soft','Mixed soft','Oracle'],rows))
    rows=[]
    for run in RUNS:
        for mask in ['colour','learned_soft','learned_half','learned_hard','oracle']:
            empty=[s for s in reports[run,'synthetic']['rows'] if not s['has_target']]
            rows.append([run,mask,len(empty),sum(s['methods'][mask]['clear'] for s in empty)])
    (OUT/'table-no-target.md').write_text(table(['Training','Mask','No-target scenes','False clear'],rows))
    rows=[]
    for run in RUNS:
        pixels=read(OUT/run/'synthetic-pixels.json')
        for kind in ['other_fire','aligned_fire','white_ui','smoke']:
            for mask in ['colour','learned_soft']:
                m=pixels[kind][mask];rows.append([run,kind,mask,f"{m['recall']:.3f}",f"{m['foreign_retention']:.3f}",f"{m['iou']:.3f}"])
    (OUT/'table-pixels.md').write_text(table(['Training','Condition','Mask','Target recall','Foreign retained','IoU'],rows))
    rows=[]
    for run in RUNS:
        for dataset in DATASETS:
            r=reports[run,dataset]
            for mask in ['colour','learned_soft']:
                m=r['summary'][mask];rows.append([run,dataset,mask,m['clear'],m['wrongClear']])
    (OUT/'table-clear.md').write_text(table(['Training','Dataset','Mask','Clear','Wrong clear'],rows))
    audit(reports,changed)
    print(json.dumps(dict(cases_per_run=result['cases_per_run'],method_predictions=result['method_predictions'],verified=True)))


def audit(reports,changed):
    sprites=load_sprites();records=[];cards=[]
    for run in ['survival','mixed']:
        for dataset in ['quad1-exact','quad1-rough','additional-exact','additional-rough']:
            changes=changed[f'{run}/{dataset}']
            for lost in [True,False]:
                subset=[x for x in changes if x['methods']['colour']['correct']==lost][:3]
                manifest=read(OUT/run/dataset/'manifest.json');byid={x['id']:(i,x) for i,x in enumerate(manifest['samples'])}
                for row in subset:
                    index,s=byid[row['id']];w,h=manifest['width'],manifest['height'];native=Path(manifest['native_source'])
                    rgb=np.fromfile(native/f"{s['frame']}.rgb",np.uint8).reshape(h,w,3)
                    crop=rectify(rgb,np.asarray(s['quad'])*[w,h]);prob=np.fromfile(OUT/run/dataset/f'{index}.learned_soft','<f4').reshape(64,64)
                    t=s['expected'][0]*64+s['expected'][1]*2+int(s['expected'][2]);ref=sprites[t].copy();ref[ref[:,:,3]<128]=[25,20,28,255]
                    images=[crop,np.repeat(np.uint8(prob[:,:,None]*255),3,2),np.uint8(crop*prob[:,:,None]),np.asarray(Image.fromarray(ref[:,:,:3]).resize((64,64),Image.Resampling.NEAREST))]
                    card=Image.new('RGB',(512,150),(20,24,31));draw=ImageDraw.Draw(card)
                    for j,im in enumerate(images):card.paste(Image.fromarray(im).resize((128,128),Image.Resampling.NEAREST),(j*128,0))
                    draw.text((2,130),f"{run} {dataset} {row['id']} {'LOSS' if lost else 'RESCUE'}",fill='white');cards.append(card);records.append(dict(run=run,dataset=dataset,id=row['id'],loss=lost))
    for start in range(0,len(cards),8):
        canvas=Image.new('RGB',(1024,((len(cards[start:start+8])+1)//2)*150))
        for i,card in enumerate(cards[start:start+8]):canvas.paste(card,(i%2*512,i//2*150))
        canvas.save(OUT/f'real-mask-audit-{start//8}.png')
    (OUT/'audit-selection.json').write_text(json.dumps(records,indent=2))


if __name__=='__main__':main()
