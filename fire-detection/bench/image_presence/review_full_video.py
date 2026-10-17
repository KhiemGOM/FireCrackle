"""Build an owner-review gallery; never change benchmark truth or model decisions."""
import argparse,json
from pathlib import Path
import numpy as np
from PIL import Image
from crop_v2 import load_base

def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('run',type=Path);ap.add_argument('--data-root',type=Path,required=True);args=ap.parse_args()
    run=args.run.resolve();root=args.data_root.resolve();out=run/'review';out.mkdir(exist_ok=True);(out/'auto').mkdir(exist_ok=True)
    report=json.loads((run/'report.json').read_text());rows=json.loads((run/'predictions.json').read_text())
    flagged=[r for r in rows if r['union'] and r['fire'] is True]
    assert [r['frame'] for r in flagged]==report['FP_frames'] and len(flagged)==95
    base=load_base(Path(__file__).with_name('pipeline.py'),root)
    for name,expected in json.loads((run/'gate-source-before.json').read_text()).items():
        if base.sha(root/name)!=expected:raise ValueError('Original preprocessing/GUI assets changed')
    labels={}
    for line in (root/f"fire-detection/data/joined/{report['protocol']['source']}.jsonl").open():
        r=json.loads(line)
        if r['n'] in report['FP_frames']:labels[r['n']]=r['label']
    frames=[];moments=[]
    for r in flagged:
        n=r['frame'];label=labels[n];image=run/'failures'/f'{n}.png'
        rgb=np.asarray(Image.open(image).convert('RGB'));assert rgb.shape==(1080,1920,3)
        fixed,used,share=base.unveil(rgb,y0=12)
        arr=np.concatenate([base.views(rgb),base.views(fixed)]) if used else base.views(rgb)
        import hashlib
        assert hashlib.sha256(arr.tobytes()).hexdigest()==r['views_sha256'] and used==r['unveiled']
        raw=f'../failures/{n}.png';auto=raw
        if used:
            auto=f'auto/{n}.png';Image.fromarray(fixed).save(out/auto)
        boxes=[]
        for fire in label['fires']:
            if not fire.get('box'):continue
            b=(np.array(fire['box'])*np.array([1920/label['w'],1080/label['h']]*2)).tolist()
            boxes.append({'xyxy':b,'width':b[2]-b[0],'height':b[3]-b[1],'visibility':fire.get('vis'),
                'source':fire.get('src'),'distance':fire.get('dist'),'above_cutoff':b[2]-b[0]>=24})
        if not moments or n-moments[-1]['end']>60:moments.append({'start':n,'end':n,'count':1})
        else:moments[-1]['end']=n;moments[-1]['count']+=1
        frames.append({'frame':n,'seconds':n/60,'raw':raw,'auto':auto,'thumbnail':f'../clears/{n}.jpg',
            'unveiled':used,'boxes':boxes,'cnn':r['cnn'],'rules':r['rules'],'score':r['score'],'orange_area':r['orange_area']})
    for frame in frames:
        frame['moment']=next(i for i,m in enumerate(moments) if m['start']<=frame['frame']<=m['end'])
    data={'frames':frames,'moments':moments,'source':report['protocol']['source'],'fps':60,
        'provenance':{'report_sha256':base.sha(run/'report.json'),'joined_sha256':report['protocol']['target_info']['joined_sha256'],
            'weights_sha256':report['protocol']['weights_sha256']},
        'scope':'All95benchmark flagged clears. Human acceptability review is separate; no labels/metrics/model/policy edits.'}
    (out/'manifest.json').write_text(json.dumps(data,indent=2))
    template=Path(__file__).with_suffix('.html').read_text(encoding='utf8')
    (out/'index.html').write_text(template.replace('/*DATA*/null',json.dumps(data).replace('<','\\u003c')),encoding='utf8')
    assert len({f['frame'] for f in frames})==95
    for f in frames:
        assert all((out/f[k]).exists() for k in ['raw','auto','thumbnail'])
    print(json.dumps({'gallery':str(out/'index.html'),'frames':len(frames),'moments':len(moments),'all_view_hashes_match':True}))

if __name__=='__main__':main()
