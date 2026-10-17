"""Rasterize independently reviewed non-target polygons; never use sprite labels."""
import json,hashlib,sys
from pathlib import Path
from datetime import datetime,timezone
import numpy as np
from PIL import Image,ImageDraw,ImageFilter
from prepare import OUT


def raster(polygons,size=64):
    image=Image.new('L',(size,size));draw=ImageDraw.Draw(image)
    for polygon in polygons:
        if len(polygon)<3 or any(not 0<=p<=100 for point in polygon for p in point):raise ValueError('Invalid polygon')
        draw.polygon([(x/100*(size-1),y/100*(size-1)) for x,y in polygon],fill=255)
    return image


def fields(case):
    definite=raster(case['definite']);unknown=raster(case['uncertain'])
    masks={'definite':np.asarray(definite),'core':np.asarray(definite.filter(ImageFilter.MinFilter(3))),
           'expanded':np.asarray(definite.filter(ImageFilter.MaxFilter(3))),
           'uncertain':np.maximum(np.asarray(definite),np.asarray(unknown)),
           'control_shift':np.roll(np.roll(np.asarray(definite),17,axis=0),23,axis=1)}
    return {name:1-value.astype(np.float32)/255 for name,value in masks.items()}


def main():
    annotation=Path(__file__).with_name('annotations.json');review=json.loads(annotation.read_text());manifest=json.loads((OUT/'manifest.json').read_text())
    if (OUT/'mask-freeze.json').exists():raise RuntimeError('Freeze exists; refusing to modify mask fields or overwrite the prescoring freeze')
    assert len(review['cases'])==len(manifest['cases'])==50
    assert {c['code'] for c in review['cases']}=={c['code'] for c in manifest['cases']}
    fractions={};overlay=[]
    for c in review['cases']:
        masks=fields(c);fractions[c['code']]={name:float(1-value.mean()) for name,value in masks.items()}
        for name,value in masks.items():value.astype('<f4').tofile(OUT/f"{c['code']}.{name}")
        image=Image.open(OUT/f"{c['code']}.png").convert('RGB').resize((256,256),Image.Resampling.NEAREST)
        display=np.asarray(image).copy();d=np.asarray(raster(c['definite'],256))>0;u=np.asarray(raster(c['uncertain'],256))>0
        display[d]=np.uint8(display[d]*.45+np.array([255,0,0])*.55)
        display[u&~d]=np.uint8(display[u&~d]*.45+np.array([40,80,255])*.55)
        card=Image.new('RGB',(512,278),(16,22,30));card.paste(image,(0,0));card.paste(Image.fromarray(display),(256,0));ImageDraw.Draw(card).text((2,259),c['code']+' red=non-target; blue=uncertain',fill='white');overlay.append(card)
    for start in range(0,50,8):
        canvas=Image.new('RGB',(1024,((len(overlay[start:start+8])+1)//2)*278))
        for i,card in enumerate(overlay[start:start+8]):canvas.paste(card,(i%2*512,i//2*278))
        canvas.save(OUT/f'annotated-{start//8}.png')
    frozen=dict(created_utc=datetime.now(timezone.utc).isoformat(),annotation_sha256=hashlib.sha256(annotation.read_bytes()).hexdigest(),
                manifest_sha256=hashlib.sha256((OUT/'manifest.json').read_bytes()).hexdigest(),
                masks='definite/core1px/expanded1px/definite+uncertain/circularlyshifteddefinite17rows23cols; no expected sprite or ranking used',
                fractions=fractions,previous_results_not_used_for_annotation='Expected sprite and per-case predictions not displayed; some prior frame familiarity remains')
    (OUT/'mask-freeze.json').write_text(json.dumps(frozen,indent=2));print('Frozen50reviewed masks before scoring')


if __name__=='__main__':main()
