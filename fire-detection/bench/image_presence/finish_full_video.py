"""Resume CPU verification from complete frozen full-frame scores, streaming video.

Preserves existing verified candidates. No score or policy changes; native pixel
and view hashes must match the original pass for every new verification.
"""
import argparse,json,time
from concurrent.futures import ProcessPoolExecutor
from collections import deque
from pathlib import Path
import full_video as fv

def stream_gate(task):return fv.gate_rgb(*task)

def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('run',type=Path);ap.add_argument('--data-root',type=Path,required=True)
    ap.add_argument('--workers',type=int,default=6);args=ap.parse_args();run=args.run.resolve();root=args.data_root.resolve()
    protocol=fv.read(run/'protocol.json');source=protocol['source']
    rows=[json.loads(s) for s in (run/'scores.jsonl').read_text().splitlines()]
    assert len(rows)==protocol['target_info']['total_frames']==19553
    assert [r['frame'] for r in rows]==list(range(len(rows)))
    assert fv.digest_source(run/'full_video.executed.py')==protocol['source_sha256']
    before=fv.read(run/'gate-source-before.json')
    assert all(fv.digest_source(root/name)==expected for name,expected in before.items())
    # Only complete newline-terminated records are durable after interruption.
    saved=[json.loads(s) for s in (run/'gates.jsonl').read_bytes().split(b'\n')[:-1]]
    assert len({r['frame'] for r in saved})==len(saved)
    completed={r['frame'] for r in saved}
    candidates={r['frame']:r for r in rows if r['cnn_candidate'] or r['orange_area']<2198}
    assert completed<=set(candidates)
    for r in saved:rows[r['frame']]=r
    (run/'gates-seek-preserved.json').write_text(json.dumps(saved))
    resume={'strategy':'Second full sequential decode; score/native view hashes unchanged; complete seek-verified records preserved',
        'preserved':len(saved),'remaining':len(candidates)-len(saved),'runner_sha256':fv.digest_source(__file__),
        'shared_runner_sha256':fv.digest_source(Path(fv.__file__))}
    (run/'resume-protocol.json').write_text(json.dumps(resume,indent=2))
    base=fv.load_base(Path(fv.__file__).with_name('pipeline.py'),root);start=time.time();nseen=0;pending=deque();count=len(saved)
    with ProcessPoolExecutor(max_workers=args.workers,initializer=fv.init,initargs=(root,run/'rules.dll',source,run)) as pool:
        with (run/'gates.jsonl').open('w') as stream:
            for r in saved:stream.write(json.dumps(r)+'\n')
            def accept(future):
                nonlocal count
                r=future.result();rows[r['frame']]=r;stream.write(json.dumps(r)+'\n');count+=1
                if count%50==0:
                    stream.flush();progress={'stage':'streaming-gates','checked':count,'candidates':len(candidates),'decoded':nseen,'seconds_since_resume':round(time.time()-start)}
                    (run/'progress.json').write_text(json.dumps(progress));print(json.dumps(progress),flush=True)
            for n,rgb in fv.decode_all(base,source):
                nseen=n+1
                if n not in candidates or n in completed:continue
                pending.append(pool.submit(stream_gate,(candidates[n],rgb)))
                if len(pending)>=args.workers*2:accept(pending.popleft())
            while pending:accept(pending.popleft())
    assert nseen==len(rows) and count==len(candidates)
    groups=fv.intervals(rows);failures=[r for r in rows if r['union'] and r['fire'] is True]
    report={'protocol':protocol,'resume':resume,'decoded_frames':len(rows),'valid_labels':sum(r['fire'] is not None for r in rows),'unknown_labels':sum(r['fire'] is None for r in rows),
        'sampled_parity_count':len(fv.read(run/'sampled-parity.json')),'gated_candidates':len(candidates),
        'methods':{k:fv.metrics(rows,k) for k in ['cnn','rules','union']},'clear_intervals':groups,
        'FP_frames':[r['frame'] for r in failures],'seconds_since_resume':time.time()-start,
        'caveat':'Correlated frame-level diagnostic; clip2 supplied calibration. Width24 source-box proxy, not readability oracle. Heuristic guards.'}
    (run/'predictions.json').write_text(json.dumps(rows));(run/'report.json').write_text(json.dumps(report,indent=2))
    fv.sheets(failures,run,'false-clears')
    reps=[rows[(g['start']+g['end'])//2] for g in groups if rows[(g['start']+g['end'])//2]['fire'] is False]
    fv.sheets(reps,run,'correct-clear-intervals')
    print(json.dumps({k:v for k,v in report.items() if k not in ['protocol','clear_intervals']}),flush=True)

if __name__=='__main__':main()
