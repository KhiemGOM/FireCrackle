"""Reapply final geometric validation to saved warps; does not optimize or tune."""
import json
from align import OUT,validate_result
def main():
    cases=json.loads((OUT/'cases.json').read_text())
    for name in ['ecc','ecc-bounded']:
        p=OUT/f'{name}.json';rows=json.loads(p.read_text());rejected=0
        for r,c in zip(rows,cases):
            for shape in ['rough','exact']:
                origin=c['rough'] if shape=='rough' else c['quad']
                for fit in r[shape]['candidates']:
                    if fit['reason'] is not None:continue
                    try:validate_result(fit['quad'],origin)
                    except ValueError as exc:
                        fit['quad']=origin;fit['reason']=str(exc);r[shape]['failures']+=1;rejected+=1
        p.write_text(json.dumps(rows));print(name,'additional invalid geometry rejected',rejected)
if __name__=='__main__':main()
