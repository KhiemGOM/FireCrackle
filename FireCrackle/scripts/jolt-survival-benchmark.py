"""Prepare held-out survival1 truth/PTS for the production Jolt clock benchmark.
Run from repository root; the original video and labels are read-only.
"""
import argparse, collections, hashlib, json, pathlib, subprocess

ROOT=pathlib.Path(__file__).resolve().parents[2]
WORK=ROOT/'.board/jolt-survival'
VIDEO=ROOT/'fire-detection/data/video/2026-10-16 18-23-42.mkv'
LABELS=ROOT/'fire-detection/data/joined/survival1.jsonl'

def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(4*1024*1024),b''):h.update(chunk)
    return h.hexdigest()

def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--ffprobe',required=True,type=pathlib.Path);args=ap.parse_args()
    WORK.mkdir(parents=True,exist_ok=True)
    cache=WORK/'pts.json'
    if not cache.exists():
        packets=json.loads(subprocess.check_output([str(args.ffprobe),'-v','error','-select_streams','v:0','-show_packets','-show_entries','packet=pts_time','-of','json',str(VIDEO)]))['packets']
        cache.write_text(json.dumps(sorted(float(p['pts_time']) for p in packets)))
    pts=json.loads(cache.read_text());assert all(b>a for a,b in zip(pts,pts[1:]))
    points=[];phase_counts=collections.Counter();bad=0
    with LABELS.open(encoding='utf8') as lines:
        for i,line in enumerate(lines):
            r=json.loads(line);assert r['n']==i and r['label'] is not None
            bad+=not r['tick_ok'];s=r['label']['f1']
            assert (r['label']['f0']-s)%32==16
            phase_counts[(r['tick']-s)%32]+=1
            points.append(dict(frame=i,pts=pts[i],step=s,phase=(20*pts[i]-s)%32,fire=r['label']['fire'],truth_tick=r['tick'],game_frame=r['f']))
    assert len(points)==len(pts) and bad==0
    holds=[];start=0
    for end in range(1,len(points)+1):
        if end<len(points) and points[end]['game_frame']==points[start]['game_frame']:continue
        if pts[end-1]-pts[start]>=.25:
            holds.append(dict(first_frame=start,last_frame=end-1,start=pts[start],end=pts[end-1],seconds=pts[end-1]-pts[start],client_ticks_before=points[start]['truth_tick'],client_tick_jump_after=None if end==len(points) else points[end]['truth_tick']-points[start]['truth_tick'],fire_frames=sum(p['fire'] for p in points[start:end])))
        start=end
    meta=dict(video=VIDEO.name,video_sha256=digest(VIDEO),joined_sha256=digest(LABELS),frames=len(points),duration=pts[-1],tick_mismatches=bad,fire_frames=sum(p['fire'] for p in points),truth_phase_histogram=dict(phase_counts),capture_holds=sorted(holds,key=lambda h:-h['seconds']),nominal_tick_drift=(points[-1]['truth_tick']-points[0]['truth_tick'])-20*(pts[-1]-pts[0]))
    (WORK/'input.json').write_text(json.dumps(dict(meta=meta,points=points),separators=(',',':')))
    print(json.dumps(meta,indent=2))

if __name__=='__main__':main()
