"""Real-video orange-only no-fire pilot. No white pixels or learned model.

Primary: largest orange connected component. Ablations: local orange count and
orange-to-orange contrast in overlapping 24/48/96px windows. All are calibrated
on clip2 before evaluation; HUD-excluded variants remain explicitly diagnostic.
"""
import argparse
import hashlib
import json
import subprocess
import time
from pathlib import Path
from blob_pilot import truth_rows
from blob_calibration import meaningful
from colour_support import frames
from temporal_presence import calibrate, metrics

FIELDS=['pixels','single','local24','local48','local96','texture24','texture48','texture96']


def scores(evidence):
    return {f'{scope}:{f}':max(evidence[a][f],evidence[b][f])
        for scope,a,b in [('all','raw','auto'),('nohud','raw_nohud','auto_nohud')] for f in FIELDS}


def main():
    ap=argparse.ArgumentParser();ap.add_argument('out',type=Path);ap.add_argument('--stride',type=int,default=90)
    ap.add_argument('--threads',type=int,default=6);ap.add_argument('--rescore',action='store_true')
    ap.add_argument('--patch-auto-from',type=Path);ap.add_argument('--thresholds-from',type=Path)
    ap.add_argument('--patch-detector',choices=['original','narrow'],default='original');args=ap.parse_args()
    if args.patch_auto_from and (args.rescore or args.patch_auto_from.resolve()==args.out.resolve()):ap.error('Auto patch needs a separate output directory and pixel decoding')
    if args.stride<1:ap.error('Stride must be positive')
    args.out.mkdir(parents=True,exist_ok=True);source=Path(__file__).with_name('orange_only.rs');binary=args.out/'orange_only.exe'
    protocol={'objective':'Positive=clear no-fire/negligible; FP=meaningful fire cleared.',
        'minimum_horizontal_native_width':24,'stride':args.stride,'calibration':'clip2','evaluation':['clip1','quad1','survival1'],
        'orange_rule':'R>=64;0.23R<=G<=0.88R;B<=0.5R;R-B>=24. No pale/white evidence or requirement.',
        'primary':'all:single','local_ablation':'overlapping24/48/96pixel squares,half-size stride,includes right/bottom boundary',
        'texture_ablation':'count orange pixels touching another orange pixel with red-channel delta>=24; white ignored',
        'combination':'max raw and conditionally unveiled scores; either branch can keep review',
        'auto_unveil':'Original20% OR10% strips; additionally treat known GUI neutral greys/tooltip fill as abstaining pixels, require >=50% judged background and90% legal veil-range pixels. GUI colours never count as orange/fire.',
        'patch_auto_from':str(args.patch_auto_from) if args.patch_auto_from else None,
        'thresholds_from':str(args.thresholds_from) if args.thresholds_from else None,
        'hud':'diagnostic excluded areas only; all realfire remains truth',
        'limits':'Familiar recordings, sampled full-duration videos; not blind validation or every-frame deployment.',
        'rust_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),
        'python_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    (args.out/'protocol.json').write_text(json.dumps(protocol,indent=2));data={};report={'protocol':protocol,'sources':{}}
    helper=None
    if not args.rescore:
        subprocess.run(['rustc','--edition','2021','-O',str(source),'-o',str(binary)],check=True)
        mode='--gui-auto-only' if args.patch_detector=='narrow' else '--new-auto-only'
        helper=subprocess.Popen([str(binary.resolve()),'1920','1080']+([mode] if args.patch_auto_from else []),stdin=subprocess.PIPE,stdout=subprocess.PIPE)
    fixed_thresholds=json.loads(args.thresholds_from.read_text()) if args.thresholds_from else None
    try:
        for name in ['clip2','clip1','quad1','survival1']:
            start=time.time();path=args.out/f'{name}.json'
            if args.rescore:rows=json.loads(path.read_text())
            else:
                truth=truth_rows(name,args.stride,0);rows=[]
                cached={r['frame']:r for r in json.loads((args.patch_auto_from/f'{name}.json').read_text())} if args.patch_auto_from else None
                for n,rgb in frames(name,args.stride,args.threads):
                    if n not in truth:continue
                    truth[n]['substantial']=meaningful(truth[n]['boxes'],24)
                    helper.stdin.write(rgb.tobytes());helper.stdin.flush();answer=helper.stdout.readline()
                    if not answer:raise RuntimeError('Orange helper exited')
                    answer=json.loads(answer)
                    if cached is not None:
                        row=cached[n]
                        if answer['extra']:
                            if row['evidence']['unveiled']:raise ValueError('Cached auto detector does not match original20% rule')
                            row['evidence']['auto']=answer['auto'];row['evidence']['auto_nohud']=answer['auto_nohud'];row['evidence']['unveiled']=True;row['extra_auto']=True
                    else:row={'source':name,'frame':n,'truth':truth[n],'evidence':answer}
                    row['scores']=scores(row['evidence']);rows.append(row)
                    if len(rows)%100==0:print(json.dumps({'source':name,'frames':len(rows),'seconds':round(time.time()-start)}),flush=True)
                path.write_text(json.dumps(rows))
            data[name]=rows
            if name=='clip2':
                thresholds=fixed_thresholds or {key:calibrate(rows,key,0) for key in rows[0]['scores']}
                (args.out/'frozen-thresholds.json').write_text(json.dumps(thresholds,indent=2))
            report['sources'][name]={'frames':len(rows),'meaningful_fire':sum(r['truth']['substantial'] for r in rows),
                'variants':{key:metrics(rows,key,t) for key,t in thresholds.items()},'seconds':round(time.time()-start,2)}
            (args.out/'report.json').write_text(json.dumps(report,indent=2))
            print(json.dumps({name:report['sources'][name]}),flush=True)
        evaluation=sum((data[n] for n in protocol['evaluation']),[])
        report['evaluation']={key:metrics(evaluation,key,t) for key,t in thresholds.items()}
        report['thresholds']=thresholds
        report['false_clears']={key:[{'source':r['source'],'frame':r['frame'],'boxes':r['truth']['boxes']}
            for r in evaluation if r['truth']['substantial'] and r['scores'][key]<t] for key,t in thresholds.items()}
        (args.out/'report.json').write_text(json.dumps(report,indent=2))
        print(json.dumps({'evaluation':report['evaluation']}),flush=True)
    finally:
        if helper:
            helper.stdin.close();helper.stdout.close()
            if helper.wait()!=0:raise RuntimeError('Orange helper failed')


if __name__=='__main__':main()
