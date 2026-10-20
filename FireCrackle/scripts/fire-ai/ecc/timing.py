"""Serial selected-sprite timing on sixteen real cases; excludes frame decode/masking."""
import json
import numpy as np
from align import OUT,ROOT,fit,templates

def main():
    rows=json.loads((OUT/'cases.json').read_text());locked=json.loads((OUT/'selected.json').read_text())['rows'];bank={m:templates(m) for m in ['normal','soul']}
    result=[]
    for i in list(range(8))+list(range(64,72)):
        r=rows[i];image=np.fromfile(ROOT/r['pixels'],np.uint8).reshape(r['height'],r['width'],3);mask=np.fromfile(OUT/f'{i}.mask',np.uint8).reshape(r['height'],r['width'])*255
        sample=dict(id=r['id'],material=r['material'],current_ms=locked[i]['selected']['rough']['ms'])
        for name,bounded in [('ecc',False),('bounded_ecc',True)]:
            values=[fit(image,mask,bank[r['material']],r['rough'],bounded=bounded,only_model=locked[i]['selected']['rough']['model'])['ms'] for _ in range(3)]
            sample[name+'_ms']=float(np.median(values))
        result.append(sample)
    (OUT/'timing.json').write_text(json.dumps(result,indent=2))
    for material in ['normal','soul']:
        rr=[r for r in result if r['material']==material]
        print(material,{k:float(np.median([r[k] for r in rr])) for k in ['current_ms','ecc_ms','bounded_ecc_ms']})

if __name__=='__main__':main()
