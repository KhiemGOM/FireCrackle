"""Prepare a local, reproducible real-video Jolt benchmark without altering recordings.

Requires the official Jolt 2.3 executable and FFmpeg/ffprobe. Raw outputs stay in
ignored .board/jolt-bench. Only observations explicitly read from a hunger/heart
bar are scored: creative sections never become missing/damaged clock evidence.
Run from repository root; use --cuts to encode and scan nine lossless cut windows.
"""
import argparse, bisect, concurrent.futures, hashlib, json, os, pathlib, random, subprocess

ROOT=pathlib.Path(__file__).resolve().parents[2]
WORK=ROOT/'.board/jolt-bench'
VIDEOS=ROOT/'fire-detection/data/video'
JOINED=ROOT/'fire-detection/data/joined'
CLIPS=[('clip1','2026-10-15 14-48-36.mkv','clip1'),('clip2','2026-10-15 18-18-16.mkv','clip2'),('clip3','2026-10-16 00-40-22.mkv','quad1')]

def read(path):return json.loads(path.read_text(encoding='utf-8'))
def save(path,obj):path.write_text(json.dumps(obj,separators=(',',':')),encoding='utf-8')
def probe(tool,path):
    # H.264 recordings have one video packet per displayed frame; sort presentation
    # timestamps (packet storage may be in B-frame decode order). Count is checked
    # against joined labels or the exact kept-frame mapping below.
    packets=json.loads(subprocess.check_output([str(tool),'-v','error','-select_streams','v:0','-show_packets','-show_entries','packet=pts_time','-of','json',str(path)]))['packets']
    pts=sorted(float(p['pts_time']) for p in packets)
    assert all(b>a for a,b in zip(pts,pts[1:])),"Non-unique presentation timestamps"
    return pts
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def points(report,labels,pts,mapping=None):
    out=[]
    # Jolt's accepted run indices, not unaccepted raw candidate ticks.
    for section,run in enumerate(report['runs']):
        for time,tick,j in run['points']:
            n=report['jolts'][j]['frame'];source=mapping[n] if mapping else n
            row=labels[source]
            if row.get('label') is None:continue
            out.append(dict(frame=n,source_frame=source,pts=pts[n],step=row['label']['f1'],phase=(20*pts[n]-row['label']['f1'])%32,fire=row['label']['fire'],truth_tick=row['tick'],gui_tick=tick,section=section,game=run['game']))
    return out
def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--ffmpeg',required=True,type=pathlib.Path);ap.add_argument('--jolt',required=True,type=pathlib.Path);ap.add_argument('--cuts',action='store_true')
    args=ap.parse_args();args.ffmpeg=args.ffmpeg.resolve();args.jolt=args.jolt.resolve()
    ffprobe=args.ffmpeg.with_name('ffprobe.exe' if os.name=='nt' else 'ffprobe')
    env=dict(os.environ,PATH=str(args.ffmpeg.parent)+os.pathsep+os.environ.get('PATH',''))
    cases=[];tasks=[]
    rng=random.Random(20261016)
    for clip,filename,joined in CLIPS:
        video=VIDEOS/filename;report=read(WORK/(clip+'.json'))
        labels=[json.loads(l) for l in (JOINED/(joined+'.jsonl')).open(encoding='utf-8')]
        assert all(r['n']==i for i,r in enumerate(labels)),"Joined labels are not in video-frame order"
        cache=WORK/(clip+'-pts.json')
        if not cache.exists():
            indexed=pathlib.Path(str(video)+'.firecrackle')/'project.json'
            if indexed.exists():save(cache,[f['pts'] for f in read(indexed)['frames']])
            else:save(cache,probe(ffprobe,video))
        pts=read(cache);assert len(pts)==len(labels),(clip,len(pts),len(labels))
        case=dict(name=clip,video=filename,report=report,points=points(report,labels,pts),frames=len(pts),fire_frames=sum(bool(r['label']['fire']) for r in labels),duration=pts[-1],joined_sha256=sha(JOINED/(joined+'.jsonl')),kind='original')
        cases.append(case)
        if not args.cuts:continue
        # Randomise within the longest measured run, leaving two anchor readings on each side.
        run=max(report['runs'],key=lambda r:len(r['points']))
        anchors=run['points']
        for trial,seconds in enumerate([0.15,0.65,1.6]):
            low=anchors[1][0]+.2;high=anchors[-2][0]-seconds-.2
            at=rng.uniform(low,high)
            a=bisect.bisect_left(pts,at);b=bisect.bisect_left(pts,pts[a]+seconds)
            w0=max(0,bisect.bisect_left(pts,pts[a]-40));w1=min(len(pts),bisect.bisect_left(pts,pts[b]+40))
            # Preserve the complete six-reading section in the shorter quad clip.
            if clip=='clip3':w0=bisect.bisect_left(pts,96);w1=len(pts)
            mapping=[n for n in range(w0,w1) if n<a or n>=b]
            name=f'{clip}-cut{trial+1}';out=WORK/(name+'.mkv');removed=pts[b]-pts[a]
            meta=dict(name=name,clip=clip,kind='cut',requested_seconds=seconds,removed_seconds=removed,cut_source_start=pts[a],cut_source_end=pts[b],cut_time=pts[a]-pts[w0],window_source_start=pts[w0],mapping=mapping)
            tasks.append((meta,out,video,labels,pts,w0,w1,a,b,removed))
    def run_cut(task):
        meta,out,video,labels,pts,w0,w1,a,b,removed=task;name=meta['name']
        reportfile=WORK/(name+'.json')
        if not out.exists():
            select=f"select='between(n,{w0},{w1-1})*not(between(n,{a},{b-1}))'"
            setpts=f"setpts='PTS-{pts[w0]:.9f}/TB-if(gte(PTS*TB,{pts[b]-.000001:.9f}),{removed:.9f}/TB,0)'"
            temporary=out.with_suffix('.partial.mkv')
            cmd=[str(args.ffmpeg),'-v','error','-y','-i',str(video),'-map','0:v:0','-an','-vf',select+','+setpts,'-frames:v',str(len(meta['mapping'])),'-c:v','libx264','-preset','ultrafast','-crf','0','-threads','4','-fps_mode','vfr','-enc_time_base','1:60000',str(temporary)]
            subprocess.run(cmd,check=True)
            temporary.replace(out)
        if not reportfile.exists():
            with (WORK/(name+'.log')).open('w') as log:
                subprocess.run([str(args.jolt),str(out),'--jobs','4','--gpu','off','--json',str(reportfile),'--html',str(WORK/(name+'.html'))],env=env,stdout=log,stderr=subprocess.STDOUT,check=True)
        cutpts=probe(ffprobe,out);assert len(cutpts)==len(meta['mapping']),(name,len(cutpts),len(meta['mapping']))
        expected=[pts[n]-pts[w0]-(removed if n>=b else 0) for n in meta['mapping']]
        timing_error=max(abs(x-y) for x,y in zip(cutpts,expected));assert timing_error<.002,(name,timing_error)
        report=read(reportfile);observations=points(report,labels,cutpts,meta['mapping'])
        save(WORK/(name+'-mapping.json'),meta)
        meta={k:v for k,v in meta.items() if k!='mapping'}
        print(name,'frames',len(cutpts),'anchors',len(observations),'breaks',[{k:v for k,v in b.items() if k not in ('frames','frame_positions')} for b in report['breaks']],flush=True)
        return dict(meta,video=out.name,report=report,points=observations,frames=len(cutpts),duration=cutpts[-1],max_pts_error=timing_error)
    save(WORK/'inputs-original.json',dict(seed=20261016,jolt_sha256=sha(args.jolt),cases=cases))
    if tasks:
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:cases.extend(pool.map(run_cut,tasks))
    save(WORK/'inputs.json',dict(seed=20261016,jolt_sha256=sha(args.jolt),cases=cases))
    print('Prepared',len(cases),'cases; observed hunger/heart bar anchors only. Raw reports remain local.')

if __name__=='__main__':main()
