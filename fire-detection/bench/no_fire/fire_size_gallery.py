"""Real recorded flames at native size, for human selection of a tiny-fire cutoff.

Logged visible boxes are NOT opaque fire-pixel masks. When quad geometry exists,
an alpha-projected union is also reported as an estimate, not exact occlusion truth.
"""
import argparse
import json
import math
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from colour_support import homography, project
from prepare import ROOT, SOURCES

TARGETS=[1,2,4,8,12,16,24,32,48,64,128,256,512,1024,4096,16384,65536,262144,1048576]


def scan():
    pools=[[] for _ in TARGETS];areas=[];sides=[];counts={}
    for name in SOURCES:
        count=0
        for line in (ROOT/f'fire-detection/data/joined/{name}.jsonl').open(encoding='utf8'):
            r=json.loads(line);label=r.get('label')
            if not r.get('tick_ok') or not label or not label.get('fire'):continue
            sources=[]
            for source in label.get('fires',[]):
                b=source.get('box')
                if not b:continue
                box=np.array(b)*[1920/label['w'],1080/label['h'],1920/label['w'],1080/label['h']]
                box[[0,2]]=np.clip(box[[0,2]],0,1920);box[[1,3]]=np.clip(box[[1,3]],0,1080)
                w,h=box[2]-box[0],box[3]-box[1]
                if w>0 and h>0:sources.append((min(w,h),w*h,box.tolist(),source))
            if not sources:continue
            # Same frame-level rule as the detector benchmark: any source >=4x4.
            side,area,box,source=max(sources,key=lambda q:q[0])
            areas.append(area);sides.append(side);count+=1
            if source.get('vis',0)<=0 or source.get('veil',0)>.05:continue
            if area<.5:continue
            case={'source':name,'frame':r['n'],'box':box,'width':box[2]-box[0],'height':box[3]-box[1],
                'box_area':area,'box_percent':100*area/(1920*1080),'shorter_side':side,
                'label_w':label['w'],'label_h':label['h'],'source_kind':source.get('src'),
                'visibility_fraction':source.get('vis'),'fire':source}
            for i,target in enumerate(TARGETS):
                distance=abs(math.log2(area/target))
                if distance>1.5:continue
                pool=pools[i]
                if any(c['source']==name and abs(c['frame']-r['n'])<90 for _,c in pool):continue
                pool.append((distance,case));pool.sort(key=lambda p:p[0]);del pool[3:]
        counts[name]=count
    a=np.array(areas);s=np.array(sides)
    distribution={'definition':'Area of the visible label box of the source with largest shorter side in each fire-labelled frame. NOT exact flame-pixel area.',
        'frames_by_source':counts,'frames':len(a),'area_quantiles':dict(zip(['min','1%','5%','10%','25%','50%','75%','90%','95%','99%','max'],np.quantile(a,[0,.01,.05,.1,.25,.5,.75,.9,.95,.99,1]).tolist())),
        'current_4px_negligible_frames':int((s<4).sum()),'current_4px_non_negligible_frames':int((s>=4).sum()),
        'shorter_side_cutoffs':{str(t):{'frames_below':int((s<t).sum()),'percent_of_fire_frames':float((s<t).mean()*100)} for t in [1,2,3,4,6,8,12,16,24,32,48,64,96,128,256,512]},
        'box_area_cutoffs':{str(t):{'frames_below':int((a<t).sum()),'percent_of_fire_frames':float((a<t).mean()*100),'percent_of_frame_area':t*100/(1920*1080)} for t in TARGETS}}
    return pools,distribution


def decode(name,n):
    raw=subprocess.check_output([str(ROOT/'FireCrackle/src-tauri/runtime/ffmpeg.exe'),'-v','error','-ss',f'{n/60:.9f}',
        '-i',str(ROOT/'fire-detection/data/video'/SOURCES[name]),'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'])
    return np.frombuffer(raw,np.uint8).reshape(1080,1920,3)


def opaque_area(case,sprites):
    if not case['fire'].get('quads'):return None
    mask=np.zeros((1080,1920),bool)
    for q in case['fire'].get('quads',[]):
        if not q.get('c') or q.get('vis',0)<.999:return None
        corners=np.asarray(q['c']).reshape(4,2)*[1920/case['label_w'],1080/case['label_h']]
        x0,y0=np.maximum(np.floor(corners.min(axis=0)).astype(int),0)
        x1,y1=np.minimum(np.ceil(corners.max(axis=0)).astype(int),[1920,1080])
        if x1<=x0 or y1<=y0:continue
        try:h=homography(np.asarray(q['uv']).reshape(4,2),corners)
        except np.linalg.LinAlgError:return None
        yy,xx=np.mgrid[y0:y1,x0:x1]
        uv=project(np.linalg.inv(h),np.c_[xx.ravel()+.5,yy.ravel()+.5])
        inside=((uv>=0)&(uv<1)).all(axis=1)
        ij=np.clip(np.floor(uv*16).astype(int),0,15)
        sprite=sprites[q['s']][q['row']*16:(q['row']+1)*16]
        hit=inside&(sprite[ij[:,1],ij[:,0],3]>=26)
        mask[y0:y1,x0:x1] |= hit.reshape(y1-y0,x1-x0)
    return int(mask.sum())


def draw_case(case,rgb,path):
    b=case['box'];cx=(b[0]+b[2])/2;cy=(b[1]+b[3])/2
    image=Image.fromarray(rgb);canvas=Image.new('RGB',(760,300),'#151a22');draw=ImageDraw.Draw(canvas)
    # Exact native-pixel crop; no resampling. Markers stay outside the flame box.
    native=image.crop((round(cx)-80,round(cy)-48,round(cx)+80,round(cy)+48))
    canvas.paste(native,(12,38));draw.text((12,15),'Native crop - unscaled',fill='white')
    # Native crop location is centred; white corner brackets locate tiny targets.
    if case['width']<=140 and case['height']<=80:
        x0=92-case['width']/2-3;y0=86-case['height']/2-3;x1=92+case['width']/2+3;y1=86+case['height']/2+3
        for x,y,sx,sy in [(x0,y0,1,1),(x1,y0,-1,1),(x0,y1,1,-1),(x1,y1,-1,-1)]:
            draw.line((x,y,x+3*sx,y),fill='#7fe2ff');draw.line((x,y,x,y+3*sy),fill='#7fe2ff')
    zoom=image.crop((round(cx)-16,round(cy)-16,round(cx)+16,round(cy)+16)).resize((256,256),Image.Resampling.NEAREST)
    canvas.paste(zoom,(195,32));draw.text((195,12),'8x nearest-pixel zoom (centre)',fill='white')
    context=image.resize((288,162),Image.Resampling.BOX);d=ImageDraw.Draw(context)
    d.rectangle(tuple(v*.15 for v in b),outline='#ffcf55',width=1)
    if max(case['width'],case['height'])<40:d.ellipse((cx*.15-5,cy*.15-5,cx*.15+5,cy*.15+5),outline='#ffcf55')
    canvas.paste(context,(465,38));draw.text((465,16),'Full-frame context',fill='white')
    draw.text((12,158),f"Visible box: {case['width']:.2f} x {case['height']:.2f}px",fill='white')
    draw.text((12,178),f"Box area: {case['box_area']:.2f}px",fill='white')
    draw.text((12,198),f"Frame area: {case['box_percent']:.6f}%",fill='white')
    draw.text((465,214),f"{case['source']} frame {case['frame']} ({case['frame']/60:.2f}s)",fill='white')
    draw.text((465,234),'Readability not established by box size',fill='#ffcf55')
    if case.get('opaque_estimate') is not None:
        draw.text((465,256),f"Projected opaque area ~{case['opaque_estimate']}px",fill='#a7b5ca')
    canvas.save(path)


def build_html(cases,distribution,out):
    payload=json.dumps(cases).replace('</','<\\/')
    dist=json.dumps(distribution,indent=2)
    html='''<!doctype html><meta charset="utf-8"><title>Real flame sizes</title>
<style>body{background:#0e131b;color:#e5edf8;font:15px system-ui;margin:24px;max-width:1600px}h1{margin-bottom:8px}.note{color:#b4c2d5;max-width:1000px;line-height:1.5}.controls{position:sticky;top:0;background:#18212ff2;padding:15px;border:1px solid #53647a;border-radius:10px;z-index:2}input,select,button{font:inherit;background:#243146;color:white;border:1px solid #7b90af;border-radius:5px;padding:6px}#cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(700px,1fr));gap:18px;margin-top:20px}.card{border:2px solid #526276;border-radius:9px;padding:8px}.card.small{border-color:#dfac45}.card.keep{border-color:#4aca91}.card h3{margin:3px 0 8px}.card img{width:760px;max-width:100%;image-rendering:auto}.badge{font-weight:bold}.alternate{margin-top:8px;color:#b4c2d5}pre{white-space:pre-wrap;font-size:12px}table{border-collapse:collapse}td,th{padding:6px 12px;text-align:left;border-bottom:1px solid #354256}</style>
<h1>Real recorded flames: small → large</h1>
<p class="note">Use the native crop to judge visibility, then use the 8× zoom to inspect the actual pixels. These are real video frames. Cyan brackets locate the flame without painting over it; yellow marks its position in the full frame. Large sources can extend beyond the native/zoom crops.</p>
<p class="note"><b>Size definitions:</b> box area is the logged visible-fire bounding box, not an exact count of flame pixels. Projected opaque area, where available, uses sprite alpha and recorded quads; it is an estimate because per-pixel occlusion masks were not saved. Examples use fully visible block/first-person sources; smoke/background can still affect individual pixels.</p>
<div class="controls"><b>Current detector rule:</b> less than 4px wide <em>or</em> tall is negligible. This checks the shorter side, not total area.<br>
<label>Proposed cutoff (preview): <select id="mode"><option value="side">Shorter side, px</option><option value="area">Visible box area, px²</option><option value="opaque">Projected opaque area, estimated px²</option></select> <input id="cutoff" type="number" min="0" step="0.5" value="4"></label> <span id="status"></span><br><small>A 4×4 box is 16px² = 0.000772% of a 1920×1080 frame. A long, thin box of the same area can fall below the current rule. Pick your preferred value; this page is a preview.</small></div>
<div id="cards"></div><h2>Logged size distribution, all four recordings</h2><p class="note">One source per fire-labelled frame: the source with the largest shorter side. Native frame size: 1920×1080. Gallery samples are a clean, inspectable subset from recordings that include quad geometry; this distribution includes all available labelled frames.</p><pre id="distribution"></pre>
<script>const cases=PAYLOAD;const distribution=DISTRIBUTION;const cards=document.getElementById('cards');
for(const c of cases){const e=document.createElement('article');e.className='card';e.dataset.id=c.id;e.innerHTML=`<h3>${c.id} · ${c.width.toFixed(2)} × ${c.height.toFixed(2)}px · ${c.box_percent.toFixed(6)}% of frame</h3><div class="badge"></div><img src="${c.image}" alt="Real flame at native size, enlarged crop, and frame context"><div class="alternate">${c.source} · frame ${c.frame} · visible box ${c.box_area.toFixed(2)}px²${c.opaque_estimate===null?'':` · opaque projection ≈${c.opaque_estimate}px² (${(c.opaque_estimate*100/2073600).toFixed(6)}%)`}</div>`;cards.append(e)}
function update(){const mode=document.getElementById('mode').value;const t=Number(document.getElementById('cutoff').value);let small=0;for(const c of cases){const e=cards.querySelector(`[data-id="${c.id}"]`);const v=mode==='side'?c.shorter_side:mode==='area'?c.box_area:c.opaque_estimate;const unknown=v===null;const tiny=!unknown&&v<t;e.className='card '+(unknown?'':tiny?'small':'keep');e.querySelector('.badge').textContent=unknown?'No opaque-area estimate':tiny?'Below your proposed cutoff':'At/above your proposed cutoff';small+=tiny}document.getElementById('status').textContent=`${small}/${cases.length} examples below proposed cutoff`;}
document.getElementById('cutoff').addEventListener('input',update);document.getElementById('mode').addEventListener('change',()=>{document.getElementById('cutoff').value=document.getElementById('mode').value==='side'?4:16;update()});document.getElementById('distribution').textContent=JSON.stringify(distribution,null,2);update();</script>'''
    html=html.replace('PAYLOAD',payload).replace('DISTRIBUTION',json.dumps(distribution))
    html=html.replace('Examples use fully visible block/first-person sources;',
        'Examples include block, entity and first-person sources, sometimes partly hidden;')
    html=html.replace('<div class="alternate">${c.source}',
        '<div class="alternate"><b>${c.visual_review||"Recorded example; inspect crop"}</b><br>${c.source}')
    html=html.replace('<div class="controls">',
        '<p class="note">The smallest subpixel/viewport-edge annotations cannot be confirmed visually; those are explicitly marked as ambiguous. Adjacent flames can visually merge beyond one logged source box. Judge the recorded crop, not just the number.</p>'
        '<h2>Sprite-column readability</h2><p><a href="controlled.html">Real flame at multiple resolutions and compression levels</a> | <a href="readability.html">32 unmodified recorded examples</a></p><div class="controls">')
    html=html.replace('Gallery samples are a clean, inspectable subset from recordings that include quad geometry; this distribution includes all available labelled frames.',
        'Gallery examples span all four recordings; opaque estimates are available only for suitable saved quads. The distribution includes all available labelled frames.')
    html=html.replace('<div id="cards"></div>',
        '<style>#cards{grid-template-columns:repeat(auto-fit,minmax(780px,1fr))}.card img{width:760px;max-width:none;height:300px}</style>'
        '<p><label><input id="alternatives" type="checkbox"> Show alternative real examples at each size</label></p><div id="cards"></div>')
    rows=''.join(f"<tr{' style=\"color:#ffcf55;font-weight:bold\"' if t=='4' else ''}><td>{t}px{' (CURRENT)' if t=='4' else ''}</td><td>{float(t)**2:g}px²</td><td>{float(t)**2*100/2073600:.6f}%</td><td>{v['frames_below']:,} ({v['percent_of_fire_frames']:.2f}%)</td></tr>" for t,v in distribution['shorter_side_cutoffs'].items())
    table='<h3>Cutoff reference</h3><p class="note">Square-box area is a reference only; the actual rule checks both dimensions.</p><table><tr><th>Shorter-side cutoff</th><th>Equivalent square box</th><th>Frame area</th><th>Fire-labelled frames below</th></tr>'+rows+'</table>'
    html=html.replace('<pre id="distribution"></pre>',table+'<details><summary>Measurement details</summary><pre id="distribution"></pre></details>')
    html+='''<script>function alternatives(){for(const c of cases){const e=cards.querySelector(`[data-id="${c.id}"]`);e.hidden=c.rank>0&&!document.getElementById('alternatives').checked}}document.getElementById('alternatives').addEventListener('change',alternatives);alternatives();</script>'''
    html=html.replace('<b>Current detector rule:</b> less than 4px wide <em>or</em> tall is negligible. This checks the shorter side, not total area.',
        '<b>No box-size cutoff selected.</b> The intended criterion is distinguishable sprite columns after scaling and compression: 8 proposed, 16 reference. Box dimensions below cannot establish that.')
    html=html.replace('Proposed cutoff (preview):','Exploratory box measurement (not readability):')
    html=html.replace('current rule','historical size-only rule').replace(' (CURRENT)',' (historical)').replace('the actual rule checks both dimensions','these historical counts check both dimensions; they do not measure readability')
    (out/'index.html').write_text(html,encoding='utf8')


def main():
    ap=argparse.ArgumentParser();ap.add_argument('out',type=Path);ap.add_argument('--render-only',action='store_true');args=ap.parse_args();args.out.mkdir(parents=True,exist_ok=True)
    if args.render_only:
        build_html(json.loads((args.out/'cases.json').read_text()),json.loads((args.out/'distribution.json').read_text()),args.out)
        return
    pools,distribution=scan();(args.out/'distribution.json').write_text(json.dumps(distribution,indent=2))
    sprites=[np.asarray(Image.open(ROOT/f'fire-detection/data/assets/fire_{s}.png').convert('RGBA')) for s in (0,1)]
    cases=[];cache={};counter=0
    for target,pool in zip(TARGETS,pools):
        for rank,(_,candidate) in enumerate(pool):
            case=dict(candidate);key=(case['source'],case['frame'])
            if key not in cache:cache[key]=decode(*key)
            case['id']=f'{counter+1:02d}';case['target_area']=target;case['rank']=rank
            case['opaque_estimate']=opaque_area(case,sprites)
            case['image']=f"case-{case['id']}.png"
            draw_case(case,cache[key],args.out/case['image'])
            # Keep geometry local, but omit bulky source objects from browser payload.
            del case['fire'];cases.append(case);counter+=1
        print(json.dumps({'target_box_area':target,'examples':len(pool),'done':counter}),flush=True)
    cases.sort(key=lambda c:c['box_area'])
    (args.out/'cases.json').write_text(json.dumps(cases,indent=2));build_html(cases,distribution,args.out)
    primary=[c for c in cases if c['rank']==0]
    for part in range((len(primary)+7)//8):
        subset=primary[part*8:(part+1)*8];sheet=Image.new('RGB',(1520,300*((len(subset)+1)//2)),'#0e131b')
        for j,c in enumerate(subset):sheet.paste(Image.open(args.out/c['image']),((j%2)*760,(j//2)*300))
        sheet.save(args.out/f'overview-{part+1}.png')


if __name__=='__main__':main()
