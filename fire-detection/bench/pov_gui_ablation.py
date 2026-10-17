"""Paired fixed-threshold first-person GUI exclusion ablation. No truth enters inference."""
import argparse,csv,hashlib,json,statistics,subprocess,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
SOURCES={'clip1':'2026-10-15 14-48-36.mkv','clip2':'2026-10-15 18-18-16.mkv','quad1':'2026-10-16 00-40-22.mkv','survival1':'2026-10-16 18-23-42.mkv'}
OUT=ROOT/'.board/pov-gui-ablation'
PY=Path(__file__)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def truth_for(name):
    rows={};last=-1
    p=ROOT/'fire-detection/data/joined'/f'{name}.jsonl'
    for line in p.open(encoding='utf8'):
        r=json.loads(line);n=r['n'];last=max(last,n);lab=r.get('label')
        if not isinstance(lab,dict) or not isinstance(lab.get('fire'),bool) or not r.get('tick_ok'):continue
        overlays=[f for f in lab.get('fires',[]) if f['src']=='overlay']
        if len(overlays)>1:raise ValueError('Multiple overlay sources')
        f=overlays[0] if overlays else None
        row=f['parts'][0]['row'] if f and f.get('parts') else None
        if f and (not isinstance(row,int) or not 0<=row<32):continue
        rows[n]={'truth':row,'vis':f.get('vis',0) if f else 0,'veil':f.get('veil',0) if f else 0}
    return rows,last,sha(p)
def metrics(rows,prefix):
    accepted=[r for r in rows if float(r[prefix+'_ev'])>=.5]
    positives=sum(r['truth'] is not None for r in rows)
    good=sum(r['truth'] is not None and int(r[prefix+'_row'])==r['truth'] for r in accepted)
    return {'frames':len(rows),'overlay_frames':positives,'accepted':len(accepted),'correct':good,
        'false_positives':sum(r['truth'] is None for r in accepted),
        'wrong_rows':sum(r['truth'] is not None and int(r[prefix+'_row'])!=r['truth'] for r in accepted),
        'correct_acceptance_rate':good/positives if positives else None}
def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--sources',nargs='+',default=list(SOURCES));ap.add_argument('--limit',type=int);ap.add_argument('--reuse',action='store_true');args=ap.parse_args()
    OUT.mkdir(parents=True,exist_ok=True);reports={}
    exe=ROOT/'fire-detection/core/target/release/examples/pov_gui_ablation.exe'
    ffmpeg=ROOT/'FireCrackle/src-tauri/runtime/ffmpeg.exe';probe=ffmpeg.with_name('ffprobe.exe')
    hashes={str(p.relative_to(ROOT)):sha(p) for p in [ROOT/'fire-detection/core/src/overlay.rs',ROOT/'fire-detection/core/src/gui_mask.rs',ROOT/'fire-detection/core/examples/pov_gui_ablation.rs',PY,ROOT/'fire-detection/data/assets/fire_1.rgba',*sorted((ROOT/'fire-detection/data/assets/gui').glob('*rgba'))]}
    for name in args.sources:
        truth,last,truth_hash=truth_for(name);stride=5 if name in ('clip1','clip2') else 30
        total=last//stride+1
        if args.limit:total=min(total,args.limit)
        video=ROOT/'fire-detection/data/video'/SOURCES[name]
        stream=json.loads(subprocess.check_output([str(probe),'-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','json',str(video)]))['streams'][0]
        w,h=stream['width'],stream['height'];suffix=f'-pilot{args.limit}' if args.limit else ''
        out=OUT/f'{name}{suffix}.csv';meta=out.with_suffix('.meta.json')
        signature={'source_hashes':hashes,'truth_sha256':truth_hash,'stride':stride,'total':total,'width':w,'height':h,'threshold':.5,'video':str(video),'video_bytes':video.stat().st_size}
        if args.reuse:
            old=json.loads(meta.read_text());assert all(old[k]==v for k,v in signature.items()),'Stale cache'
            seconds=old['seconds']
        else:
            start=time.perf_counter();subprocess.run([str(exe),str(video),str(out),str(w),str(h),str(stride),str(total),str(ffmpeg)],check=True)
            seconds=time.perf_counter()-start;meta.write_text(json.dumps({**signature,'seconds':seconds},indent=2))
        raw=list(csv.DictReader(out.open()));assert len(raw)==total
        assert len({int(r['n']) for r in raw})==total
        rows=[{**r,**truth[int(r['n'])]} for r in raw if int(r['n']) in truth]
        def good(r,p):return r['truth'] is not None and float(r[p+'_ev'])>=.5 and int(r[p+'_row'])==r['truth']
        def brief(r):return {k:r[k] for k in ('n','truth','vis','veil','base_row','base_ev','mask_row','mask_ev','gui_reliable','gui_fraction')}
        errors=[brief(r) for r in rows if float(r['mask_ev'])>=.5 and (r['truth'] is None or int(r['mask_row'])!=r['truth'])]
        old_csv=ROOT/'fire-detection/data/joined'/f'overlay5_{name}_h.csv';parity=None
        if old_csv.exists():
            old={int(r['n']):r for r in csv.DictReader(old_csv.open())};pairs=[(r,old[int(r['n'])]) for r in rows if int(r['n']) in old]
            parity={'compared':len(pairs),'candidate_differences':sum(int(r['base_row'])!=int(o['fin_row']) for r,o in pairs),'evidence_differences_over_rounding':sum(abs(float(r['base_ev'])-float(o['fin_ev']))>.000051 for r,o in pairs)}
        reports[name]={'baseline':metrics(rows,'base'),'gui_neutral':metrics(rows,'mask'),'baseline_csv_parity':parity,'new_correct':[brief(r) for r in rows if good(r,'mask') and not good(r,'base')],
         'lost_correct':[brief(r) for r in rows if good(r,'base') and not good(r,'mask')],'masked_errors':errors,
         'subgroups':{k:{p:metrics(group,p) for p in ('base','mask')} for k,group in {'low_visibility':[r for r in rows if r['truth'] is not None and r['vis']<.15],'veiled':[r for r in rows if r['truth'] is not None and r['veil']>=.6]}.items()},
         'gui_reliable_frames':sum(r['gui_reliable']=='true' for r in rows),'mean_gui_fraction':statistics.mean(float(r['gui_fraction']) for r in rows),
         'mean_ms':{p:statistics.mean(float(r[p+'_ms']) for r in raw) for p in ('base','gui','mask')},'seconds':seconds,'scored_frames':len(rows),'excluded_unjoined_or_invalid':total-len(rows)}
        (OUT/f'{name}{suffix}-report.json').write_text(json.dumps(reports[name],indent=2))
        print(json.dumps({'source':name,**{k:reports[name][k] for k in ('baseline','gui_neutral','mean_ms','seconds','baseline_csv_parity')}}),flush=True)
    (OUT/('pilot-report.json' if args.limit else 'report.json')).write_text(json.dumps({'threshold':.5,'protocol':'fixed stride5 clip1/clip2 and stride30 quad1/survival1; independent tick-valid joined truth only; actual reliable canonical GUI mask, no guessed rectangles; paired same-frame FOV60/70, unchanged veil and threshold; no temporal fill or threshold fit','sources':reports},indent=2))
if __name__=='__main__':main()
