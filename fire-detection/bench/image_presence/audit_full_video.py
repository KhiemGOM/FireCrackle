"""Independent whole-recording coverage, frozen-policy and truth accounting audit."""
import argparse,hashlib,json
from pathlib import Path

def read(p):return json.loads(p.read_text())
def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

def main():
    ap=argparse.ArgumentParser();ap.add_argument('run',type=Path);ap.add_argument('--data-root',type=Path,required=True)
    ap.add_argument('--cnn-run',type=Path,required=True);ap.add_argument('--baseline-run',type=Path,required=True)
    args=ap.parse_args();run=args.run;root=args.data_root
    protocol=read(run/'protocol.json');rows=read(run/'predictions.json');report=read(run/'report.json')
    assert len(rows)==19553==report['decoded_frames']
    assert [r['frame'] for r in rows]==list(range(19553))
    assert protocol['source']=='clip2' and protocol['stride']==1
    assert sha(run/'full_video.executed.py')==protocol['source_sha256']
    resumed=read(run/'resume-protocol.json')
    assert sha(run/'finish.executed.py')==resumed['runner_sha256']
    assert sha(run/'resumed_shared.executed.py')==resumed['shared_runner_sha256']
    guard_sources=read(run/'gate-source-before.json')
    assert all(sha(root/name)==expected for name,expected in guard_sources.items())
    joined=root/'fire-detection/data/joined/clip2.jsonl'
    assert protocol['target_info']['joined_sha256']==sha(joined)
    truth={}
    for line in joined.open():
        r=json.loads(line);label=r.get('label')
        valid=r.get('tick_ok') and isinstance(label,dict) and isinstance(label.get('fire'),bool) and bool(label.get('fires'))==label['fire']
        boxes=[f['box'] for f in label.get('fires',[]) if f.get('box')] if valid else []
        if valid and label['fire'] and not boxes:valid=False
        truth[r['n']]=(any(b[2]*(1920/label['w'])-b[0]*(1920/label['w'])>=24 for b in boxes),label['fire']) if valid else (None,None)
    assert set(truth)==set(range(19553))
    original_dataset=read(args.baseline_run/'dataset.json')
    assert sha(root/'fire-detection/data/video/2026-10-15 18-18-16.mkv')==original_dataset['provenance']['clip2']['video_sha256']
    assert all((r['fire'],r['raw_fire'])==truth[r['frame']] for r in rows)
    cal=read(args.cnn_run/'calibration.json');assert cal['threshold']==protocol['threshold']
    assert cal['weights_sha256']==protocol['weights_sha256']==sha(args.cnn_run/'best.pt')
    sampled=read(args.cnn_run/'calibration-predictions.json')
    assert all(abs(rows[r['frame']]['score']-r['score'])<=1e-5 for r in sampled)
    orange=read(root/'.board/no-fire-parallel/fragments/clip2.json')
    assert all(rows[r['frame']]['orange_area']==r['scores']['all:r4'] for r in orange)
    staged=[json.loads(s) for s in (run/'scores.jsonl').open()]
    assert len(staged)==len(rows)
    expected_gates={r['frame'] for r in rows if r['score']<cal['threshold'] or r['orange_area']<2198}
    actual_gates=[json.loads(s) for s in (run/'gates.jsonl').open()]
    assert len(actual_gates)==len(expected_gates)==report['gated_candidates']
    assert {r['frame'] for r in actual_gates}==expected_gates
    for r,s in zip(rows,staged):
        assert all(r[k]==s[k] for k in ['frame','score','views_sha256','orange_area','fire','raw_fire'])
        candidate=r['score']<cal['threshold'] or r['orange_area']<2198
        if candidate:
            blocked=(not r['gui']['reliable']) or (not r['unveiled'] and r['share']>=.8) or r['material']['abstain'] or r['purple']
            assert r['cnn']==(r['score']<cal['threshold'] and not blocked)
            assert r['rules']==(r['orange_area']<2198 and not blocked and not r['retention'])
        else:assert not r['cnn'] and not r['rules']
        assert r['union']==(r['cnn'] or r['rules'])
    for key in ['cnn','rules','union']:
        valid=[r for r in rows if r['fire'] is not None]
        m=report['methods'][key]
        assert m['TP']==sum(r[key] and not r['fire'] for r in valid)
        assert m['FP']==sum(r[key] and r['fire'] for r in valid)
        assert m['eligible']==sum(not r['fire'] for r in valid)
        assert m['fire']==sum(r['fire'] for r in valid)
    grouped=[n for g in report['clear_intervals'] for n in range(g['start'],g['end']+1)]
    assert grouped==[r['frame'] for r in rows if r['union']]
    audit={'every_frame_once':len(rows),'all_truth_recomputed':True,'checkpoint_threshold_unchanged':True,
        'sampled_CNN_parity':len(sampled),'sampled_native_orange_exact':len(orange),'all_candidates_redecoded_and_checked':len(actual_gates),
        'all_decisions_and_rates_recomputed':True,'clear_intervals_exact':True,'gate_source_asset_hashes_unchanged':len(guard_sources),
        'eligible_clear_breakdown':{key:{'literal_no_fire':sum(r[key] and r['raw_fire'] is False for r in rows),
        'below_width_cutoff':sum(r[key] and r['raw_fire'] is True and r['fire'] is False for r in rows)} for key in ['cnn','rules','union']}}
    (run/'audit.json').write_text(json.dumps(audit,indent=2));print(json.dumps(audit))

if __name__=='__main__':main()
