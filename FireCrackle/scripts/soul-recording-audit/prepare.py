"""Geometry/provenance audit only; no model fitting, scoring or split selection."""
import collections,hashlib,importlib.util,json,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'.board/soul-12m'
spec=importlib.util.spec_from_file_location('geometry',ROOT/'FireCrackle/scripts/prepare-actual-quad-eval.py');geometry=importlib.util.module_from_spec(spec);spec.loader.exec_module(geometry)
def sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for b in iter(lambda:f.read(8*1024*1024),b''):h.update(b)
    return h.hexdigest()
def main():
    counts=collections.Counter();per_minute={};seen=set();candidates=[];last_render=None
    with (OUT/'joined.jsonl').open() as f:
        for line in f:
            r=json.loads(line);counts['video_frames']+=1
            if r.get('f') is None:counts['strip_undecodable']+=1;continue
            if not r.get('tick_ok') or not r.get('label'):counts['unmatched_or_bad_tick']+=1;continue
            counts['matched_video_frames']+=1;lab=r['label']
            if r['f']==last_render:counts['repeated_video_renderer_frames']+=1
            if last_render is not None and r['f']<last_render:counts['renderer_frame_decreases']+=1
            last_render=r['f']
            if 'soul_fires' not in lab:counts['unsupported_soul_schema']+=1;continue
            if lab.get('soul'):counts['video_frames_with_soul']+=1
            if lab.get('fire'):counts['video_frames_with_normal']+=1
            if r['n']%11:continue
            if r['f'] in seen:counts['duplicate_renderer_samples']+=1;continue
            seen.add(r['f']);counts['sampled_unique_frames']+=1
            minute=str(r['n']//3600);per_minute.setdefault(minute,dict(sampled_frames=0,soul_frames=0));per_minute[minute]['sampled_frames']+=1
            if lab.get('soul'):per_minute[minute]['soul_frames']+=1
            for material,key in [('soul','soul_fires'),('normal','fires')]:
                for fi,fire in enumerate(lab.get(key,[])):
                    counts[material+'_sources']+=1
                    for qi,q in enumerate(fire.get('quads',[])):
                        counts[material+'_quads_before_gate']+=1
                        if q.get('vis',0)<.95:counts[material+'_low_visibility']+=1;continue
                        points,error=geometry.canonical_quad(q,lab['w'],lab['h'])
                        if error:counts[material+'_'+error]+=1;continue
                        normalized=[[x/lab['w'],y/lab['h']] for x,y in points]
                        row=dict(id=f'{material}-{r["n"]}-{fi}-{qi}',material=material,frame=r['n'],render_frame=r['f'],quad=normalized,width=1920,height=1080,phase=(q['row']+(16 if q['s']==0 else 0))%32,source=fire['src'],visibility=q['vis'],veil=q.get('veil'),sheet=q['s'],mirrored=bool(q['m']))
                        candidates.append(row)
    video=ROOT/'fire-detection/data/video/2026-10-19 22-59-52.mkv'
    media=json.loads(subprocess.check_output([str(ROOT/'FireCrackle/src-tauri/runtime/ffprobe.exe'),'-v','error','-select_streams','v:0','-show_entries','format=duration:stream=width,height,avg_frame_rate','-of','json',str(video)]))
    report=dict(media=media,counts=dict(counts),per_minute=per_minute,video=str(video.relative_to(ROOT)),video_sha256=sha(video),snapshot=json.loads((OUT/'snapshot.json').read_text()),joined_sha256=sha(OUT/'joined.jsonl'),selection='same geometry-only gate as normal-fire corpus;stride11unique rendered frames,visibility>=.95; no fitting/scoring/split',candidates=candidates)
    (OUT/'candidates.json').write_text(json.dumps(report));print(json.dumps({k:v for k,v in report.items() if k!='candidates'}),flush=True)
if __name__=='__main__':main()
