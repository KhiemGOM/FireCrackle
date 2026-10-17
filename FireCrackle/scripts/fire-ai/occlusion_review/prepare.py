"""Prepare a sprite/ranking-hidden real occluder review, selected by geometry."""
import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import numpy as np
from PIL import Image,ImageDraw
from render import ROOT,rectify

OUT=ROOT/'.board/occlusion-review'


def main():
    OUT.mkdir(parents=True,exist_ok=True);pool=[]
    for dataset in ['survival-exact','additional-exact']:
        source=ROOT/'.board/occlusion-mask/survival'/dataset
        manifest=json.loads((source/'manifest.json').read_text())
        for sample in manifest['samples']:
            q=np.asarray(sample['quad']);edge=np.linalg.norm((q-np.roll(q,1,axis=0))*[manifest['width'],manifest['height']],axis=1)
            pool.append(dict(sample=sample,width=manifest['width'],height=manifest['height'],native_source=manifest['native_source'],min_edge=float(edge.min()),dataset=dataset))
    # One largest-min-edge quad per frame, evenly spread over the unique frames.
    byframe={}
    for row in sorted(pool,key=lambda r:(-r['min_edge'],r['sample']['id'])):byframe.setdefault(row['sample']['frame'],row)
    frames=sorted(byframe);chosen=[byframe[frames[i]] for i in np.linspace(0,len(frames)-1,50).round().astype(int)]
    assert len(chosen)==50 and len({s['sample']['frame'] for s in chosen})==50
    np.random.default_rng(1702).shuffle(chosen)
    records=[];cards=[]
    for i,row in enumerate(chosen):
        s=row['sample'];w,h=row['width'],row['height'];q=np.asarray(s['quad'])*[w,h]
        image=np.fromfile(Path(row['native_source'])/f"{s['frame']}.rgb",np.uint8).reshape(h,w,3)
        crop=rectify(image,q)
        code=f'r{i:02d}';Image.fromarray(crop).save(OUT/f'{code}.png')
        lo=q.min(0);hi=q.max(0);extent=hi-lo;lo=np.maximum(0,lo-.5*extent);hi=np.minimum([w,h],hi+.5*extent)
        context=Image.fromarray(image).crop((*lo,*hi));draw=ImageDraw.Draw(context)
        points=[tuple(p-lo) for p in q];draw.line(points+[points[0]],fill=(0,255,255),width=2)
        context=context.resize((256,256),Image.Resampling.NEAREST)
        enlarged=Image.fromarray(crop).resize((256,256),Image.Resampling.NEAREST)
        # Coordinate grid for reproducible hand polygons, no sprite/rank display.
        draw=ImageDraw.Draw(enlarged)
        for t in [.25,.5,.75]:
            v=int(t*256);draw.line((v,0,v,255),fill=(55,110,140));draw.line((0,v,255,v),fill=(55,110,140))
        card=Image.new('RGB',(512,280),(16,22,30));card.paste(context,(0,0));card.paste(enlarged,(256,0));draw=ImageDraw.Draw(card)
        draw.text((4,260),f'{code}: context | rectified coordinates 0..100; no sprite/rank',fill='white');cards.append(card)
        records.append(dict(code=code,**row,crop_sha256=hashlib.sha256(crop.tobytes()).hexdigest()))
    for start in range(0,50,8):
        canvas=Image.new('RGB',(1024,((len(cards[start:start+8])+1)//2)*280))
        for j,card in enumerate(cards[start:start+8]):canvas.paste(card,(j%2*512,j//2*280))
        canvas.save(OUT/f'blind-{start//8}.png')
    protocol=dict(selection='One largest-min-edge quad per frame from separated survival36/additional38,50 evenly spaced of unique frames,shuffle seed1702; no ranking or truth filtering',
                  annotation='Assistant visual judgments of explicit occluders and uncertainty, not dense oracle target ownership. Expected sprite and matcher predictions hidden in contact sheets; prior familiarity with some frames exists.',
                  cases=records,prepared_source_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
    (OUT/'manifest.json').write_text(json.dumps(protocol,indent=2));print('Prepared50cases from',len(frames),'frames,7blind contact sheets')


if __name__=='__main__':main()
