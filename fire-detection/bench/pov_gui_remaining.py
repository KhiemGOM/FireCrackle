"""Canonical probe cache and four remaining GUI-mask ablations."""
import argparse
import ctypes
import gzip
import hashlib
import itertools
import inspect
import json
import os
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')
import numpy as np

from pov_gui_stages import ROOT, SOURCES, truth_for, sha
from pov_gui_support import OUT as SUPPORT

OUT = ROOT / '.board/pov-gui-remaining'
RADII = [0, 2, 4, 8]
SOFT = [0., .25, .5, 1.]
MASKS = list(itertools.product(range(4), SOFT))
MODELS = list(itertools.product(range(16), range(2), range(2), range(2), range(2)))
METHODS = [{'radius': RADII[MASKS[m][0]], 'translucent_weight': MASKS[m][1],
            'pool': ['probes', 'cells'][p], 'ranking': ['sum', 'mean'][r],
            'silhouette': ['original', 'weighted'][s], 'fov': ['original', 'visible'][f],
            'gate': ['none', 'margin_0.5', 'margin_0.5_spread'][g]}
           for m,p,r,s,f in MODELS for g in range(3)]
CONFIGS = [{**method, 'cut_threshold': cut, 'temporal': temporal}
           for cut in [.15, .30] for temporal in ['none', 'one_1', 'both_1', 'one_2'] for method in METHODS]
NATIVE = None


def native_library():
    global NATIVE
    if NATIVE is None:
        source = Path(__file__).with_name('pov_probe_aggregate.rs')
        dll = OUT/f'probe-aggregate-{sha(source)[:12]}.dll'
        if not dll.exists():
            subprocess.run(['rustc','--crate-type','cdylib','--edition=2021','-O',str(source),'-o',str(dll)],check=True)
        NATIVE = ctypes.CDLL(str(dll))
        ptr = lambda dtype: np.ctypeslib.ndpointer(dtype=dtype,flags='C_CONTIGUOUS')
        NATIVE.aggregate.argtypes = [ctypes.c_size_t,ptr(np.float64),ptr(np.uint32),ptr(np.uintp),
                                    ptr(np.uintp),ptr(np.uint16),ctypes.c_size_t,ptr(np.float64)]
        NATIVE.aggregate.restype = ctypes.c_int
    return NATIVE


def stream_sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as file:
        for block in iter(lambda: file.read(8 * 1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def extract(name, limit=None):
    _, last, truth_hash = truth_for(name)
    stride = 5 if name in ('clip1', 'clip2') else 30
    total = min(last // stride + 1, limit) if limit else last // stride + 1
    suffix = f'-pilot{limit}' if limit else ''
    cache = OUT / f'{name}{suffix}.jsonl.gz'
    meta = cache.with_suffix('.meta.json')
    native = ROOT / 'fire-detection/core/target/release/examples/pov_gui_probes.exe'
    video = ROOT / 'fire-detection/data/video' / SOURCES[name]
    sources = [ROOT / f'fire-detection/core/src/{n}.rs' for n in
               ['overlay', 'gui_mask', 'veil', 'video']]
    sources += [ROOT / 'fire-detection/core/examples/pov_gui_probes.rs']
    assets = [ROOT / 'fire-detection/data/assets/fire_1.rgba',
              *sorted((ROOT / 'fire-detection/data/assets/gui').glob('*rgba'))]
    signature = {'native_sha256': sha(native), 'source_hashes': {str(p.relative_to(ROOT)): sha(p) for p in sources},
                 'assets': {str(p.relative_to(ROOT)): sha(p) for p in assets},
                 'video_sha256': stream_sha(video), 'video_bytes': video.stat().st_size,
                 'truth_sha256': truth_hash, 'stride': stride, 'total': total, 'width': 1920, 'height': 1080}
    if cache.exists() and meta.exists():
        assert json.loads(meta.read_text()) == signature, 'Stale probe cache; use a new cache/version explicitly'
        return cache
    print(f'{name}: extracting {total} canonical probe frames', flush=True)
    process = subprocess.Popen([str(native), str(video), '1920', '1080', str(stride), str(total),
                                str(ROOT / 'FireCrackle/src-tauri/runtime/ffmpeg.exe')], stdout=subprocess.PIPE)
    count = 0
    try:
        with gzip.open(cache, 'wb', compresslevel=1) as output:
            for line in process.stdout:
                output.write(line)
                count += 1
        assert process.wait() == 0 and count == total + 1, 'Incomplete probe extraction'
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
    meta.write_text(json.dumps(signature, indent=2))
    print(f'{name}: probe cache complete ({cache.stat().st_size} bytes)', flush=True)
    return cache


def weights(hard, trans):
    hard, trans = np.asarray(hard), np.asarray(trans)
    return np.stack([np.where(hard <= r, 0., np.where(trans <= r, soft, 1.))
                     for r, soft in MASKS])


def cell_pool(values, weight, cells):
    """Equal visible cells, each normalized by its own surviving weight mass."""
    mass = np.bincount(cells, weights=weight, minlength=512)
    sums = np.bincount(cells, weights=weight * values, minlength=512)
    valid = mass > 0
    means = np.divide(sums, mass, out=np.zeros_like(sums), where=valid)
    return means.sum(), int(valid.sum())


def cut_segments(frames, thumbs, fps, threshold):
    frames, thumbs = np.asarray(frames), np.asarray(thumbs, dtype=float)
    cuts = np.zeros(len(frames), dtype=bool)
    if len(frames):
        cuts[0] = True
    if len(frames) > 1:
        cuts[1:] = ((np.abs(np.diff(thumbs, axis=0)).mean(axis=1) / 255) > threshold) | (np.diff(frames) / fps > .75)
    return np.cumsum(cuts), cuts


def temporal_gate(frames, rows, accepted, segments, fps=60., tolerance=1., both=False, targets=None):
    """Support must come from an independently accepted neighboring observation."""
    frames, rows, accepted = np.asarray(frames), np.asarray(rows, dtype=float), np.asarray(accepted)
    before, after = np.zeros_like(accepted), np.zeros_like(accepted)
    for i in range(len(frames)):
        if not accepted[i].any() or (targets is not None and not targets[i]):
            continue
        j = i - 1
        while j >= 0 and (frames[i] - frames[j]) / fps <= .75:
            if segments[j] == segments[i]:
                error = (rows[i] - rows[j] - 20 * (frames[i] - frames[j]) / fps + 16) % 32 - 16
                before[i] |= accepted[j] & (np.abs(error) <= tolerance)
            j -= 1
        j = i + 1
        while j < len(frames) and (frames[j] - frames[i]) / fps <= .75:
            if segments[j] == segments[i]:
                error = (rows[j] - rows[i] - 20 * (frames[j] - frames[i]) / fps + 16) % 32 - 16
                after[i] |= accepted[j] & (np.abs(error) <= tolerance)
            j += 1
    return accepted & ((before & after) if both else (before | after))


def zscore(values, valid=None):
    values = np.asarray(values)
    if valid is None:
        valid = np.ones(values.shape, dtype=bool)
    count = valid.sum(axis=-1, keepdims=True)
    mean = np.divide(np.where(valid, values, 0).sum(axis=-1, keepdims=True), count,
                     out=np.zeros_like(count, dtype=float), where=count > 0)
    var = np.divide(np.where(valid, (values-mean)**2, 0).sum(axis=-1, keepdims=True), count,
                    out=np.zeros_like(mean), where=count > 0)
    sd = np.sqrt(var)
    return np.where(valid, (values-mean)/np.where(sd > 1e-12, sd, 1.), -9.)


def prepare(layout):
    offsets = np.array(layout['offsets'], dtype=np.int64)
    disc = np.array(layout['disc'], dtype=np.int64)
    pred = np.array(layout['pred'], dtype=np.float64)[:, disc]
    indices = [np.array(i, dtype=np.int64) for i in layout['indices']]
    groups, native_cells = [], []
    for ind, cells in zip(indices, layout['cells']):
        cells = np.array(cells)
        order = np.argsort(cells, kind='stable')
        starts = np.r_[0, np.flatnonzero(np.diff(cells[order])) + 1]
        groups.append((ind[order], starts))
        native_cells.append(cells[order].astype(np.uint16))
    bins = ((offsets//3//1920)*4//1080)*4 + ((offsets//3%1920)*4//1920)
    native_library()
    return {'offsets': offsets, 'disc': disc, 'sign': 2*pred-1, 'indices': indices,
            'groups': groups, 'bins': bins,
            'native_indices': np.concatenate([g[0] for g in groups]).astype(np.uintp),
            'native_cells': np.concatenate(native_cells),
            'native_starts': np.r_[0,np.cumsum([len(g[0]) for g in groups])].astype(np.uintp)}


def frame_features(record, layouts, expected=None, native=True):
    results = []
    for f, (obs, layout) in enumerate(zip(record['obs'], layouts)):
        warm, hitbits = np.array(obs['warm'], dtype=float), np.array(obs['hits'], dtype=np.uint32)
        weight = weights(obs['hard'], obs['trans'])
        disc = layout['disc']
        mass = weight[:, disc].sum(axis=1)
        agreement = np.divide(layout['sign'] @ (weight[:, disc]*(2*warm[disc]-1)).T,
                              mass[None,:], out=np.zeros((32,16)), where=mass[None,:] > 0).T
        agreement = np.where(mass[:,None] > 0, .5+.5*agreement, 0)
        sil_z = zscore(agreement)
        raw_agree = .5+.5*(layout['sign'] @ (2*warm[disc]-1))/len(disc)
        raw_sil_z = zscore(raw_agree)
        sums, denom, valid = np.zeros((16,2,32)), np.zeros((16,2,32)), np.zeros((16,2,32), dtype=bool)
        raw_sum, raw_used = np.zeros(32), np.zeros(32)
        if native:
            output = np.zeros(2624)
            error = native_library().aggregate(len(warm),weight,hitbits,layout['native_starts'],
                layout['native_indices'],layout['native_cells'],len(layout['native_cells']),output)
            assert error == 0, 'Invalid native aggregation input'
            sums[:,0,:], denom[:,0,:] = output[:512].reshape(16,32),output[512:1024].reshape(16,32)
            used = output[1024:1536].reshape(16,32)
            sums[:,1,:], denom[:,1,:] = output[1536:2048].reshape(16,32),output[2048:2560].reshape(16,32)
            valid[:,0,:] = (used>=5)&(denom[:,0,:]>=5)
            valid[:,1,:] = valid[:,0,:]&(denom[:,1,:]>=5)
            raw_sum,raw_used = output[2560:2592],output[2592:2624]
        for row, (indices, starts) in enumerate(layout['groups']) if not native else []:
            hits = ((hitbits[indices] >> row)&1).astype(float)
            signed = 2*hits-1
            selected = weight[:, indices]
            used = (selected > 0).sum(axis=1)
            weighted_mass = selected.sum(axis=1)
            weighted_sum = (selected*signed).sum(axis=1)
            sums[:,0,row], denom[:,0,row] = weighted_sum, weighted_mass
            valid[:,0,row] = (used >= 5)&(weighted_mass >= 5)
            cell_mass = np.add.reduceat(selected, starts, axis=1)
            cell_sum = np.add.reduceat(selected*signed, starts, axis=1)
            cell_means = np.divide(cell_sum, cell_mass, out=np.zeros_like(cell_sum), where=cell_mass > 0)
            cells = (cell_mass > 0).sum(axis=1)
            sums[:,1,row], denom[:,1,row] = cell_means.sum(axis=1), cells
            valid[:,1,row] = (used >= 5)&(weighted_mass >= 5)&(cells >= 5)
            raw_sum[row], raw_used[row] = signed.sum(), len(indices)
        sums = np.where(valid, sums, 0)
        evidence = np.divide(sums, denom, out=np.zeros_like(sums), where=valid)
        raw_col_z = zscore(raw_sum, raw_used >= 5)
        raw_scores = raw_sil_z + 2*raw_col_z
        raw_row = int(raw_scores.argmax())
        raw_ev = raw_sum[raw_row]/raw_used[raw_row]
        if expected is not None:
            for j, mask in enumerate([None, MASKS.index((0,1.)), MASKS.index((0,0.))]):
                ref = expected[j*2+f]
                got_sum = raw_sum if mask is None else sums[mask,0]
                got_used = raw_used if mask is None else denom[mask,0]
                got_sil = raw_sil_z if mask is None else sil_z[mask]
                assert np.allclose(got_sum, ref['sum'], atol=1e-8, rtol=0), (record['n'],f,j,'sum')
                assert np.allclose(got_used, ref['used'], atol=1e-8, rtol=0), (record['n'],f,j,'used')
                assert np.allclose(got_sil, ref['sz'], atol=1e-8, rtol=0), (record['n'],f,j,'silhouette')
        colour_z = np.stack([zscore(sums, valid), zscore(evidence, valid)], axis=2)
        # mask,pool,ranking,silhouette,row
        combined = np.stack([raw_sil_z[None,None,None,:]+2*colour_z,
                             sil_z[:,None,None,:]+2*colour_z], axis=3)
        candidates = combined.argmax(axis=-1)
        selected_ev = np.take_along_axis(evidence[:,:,None,None,:], candidates[...,None], axis=-1)[...,0]
        sorted_scores = np.sort(combined, axis=-1)
        margin = sorted_scores[...,-1]-sorted_scores[...,-2]
        results.append({'row': candidates, 'ev': selected_ev, 'margin': margin,
                        'raw_row': raw_row, 'raw_ev': raw_ev, 'weights': weight,
                        'hits': hitbits, 'layout': layout})
    original_fov = int(results[1]['raw_ev'] > results[0]['raw_ev'])
    rows, scores, margins, spans = [], [], [], []
    memo = {}
    for m,p,r,s,fov_mode in MODELS:
        f = original_fov if fov_mode == 0 else int(results[1]['ev'][m,p,r,s] > results[0]['ev'][m,p,r,s])
        result = results[f]
        row, ev, margin = int(result['row'][m,p,r,s]), result['ev'][m,p,r,s], result['margin'][m,p,r,s]
        span = 0
        key = (f,m,row)
        if ev >= .5 and margin >= .5:
            if key not in memo:
                indices = result['layout']['indices'][row]
                w = result['weights'][m,indices]
                hits = ((result['hits'][indices]>>row)&1)
                bins = result['layout']['bins'][indices]
                mass = np.bincount(bins, weights=w, minlength=16)
                positive = np.bincount(bins, weights=w*hits, minlength=16)
                support = (positive >= 5)&(2*positive-mass >= .5*mass)
                cols = np.flatnonzero(support.reshape(4,4).any(axis=0))
                memo[key] = int(cols[-1]-cols[0]+1) if len(cols) else 0
            span = memo[key]
        rows.append(row); scores.append(ev); margins.append(margin); spans.append(span)
    return (np.array(rows,dtype=np.int16), np.array(scores), np.array(margins), np.array(spans,dtype=np.uint8),
            results[original_fov]['raw_row'], results[original_fov]['raw_ev'])


def derive(name, cache, limit=None):
    suffix = f'-pilot{limit}' if limit else ''
    output = OUT/f'{name}{suffix}-features.npz'
    meta = output.with_suffix('.meta.json')
    feature_code=''.join(inspect.getsource(f) for f in [weights,zscore,prepare,frame_features,native_library,derive])
    feature_code+=repr((MASKS,MODELS))
    signature = {'feature_code_sha256':hashlib.sha256(feature_code.encode()).hexdigest(),
        'aggregation_sha256':sha(Path(__file__).with_name('pov_probe_aggregate.rs')),
        'cache_meta_sha256':sha(cache.with_suffix('.meta.json')),
        'parent_predictions_sha256':sha(SUPPORT/f'{name}.npz')}
    if output.exists() and meta.exists() and json.loads(meta.read_text()) == signature:
        return output
    old = {}
    parent_cache = ROOT/'.board/pov-gui-stages'/f'{name}.jsonl'
    for line in parent_cache.open():
        r = json.loads(line)
        if limit is None or r['n'] < limit*(5 if name in ('clip1','clip2') else 30):
            old[r['n']] = [r['stats'][i] for i in [0,1,4,5,6,7]]
    truth, _, truth_hash = truth_for(name)
    cache_meta=json.loads(cache.with_suffix('.meta.json').read_text())
    assert cache_meta['truth_sha256']==truth_hash,'Truth changed since probe capture'
    parent = np.load(SUPPORT/f'{name}.npz')
    protected = dict(zip(parent['frames'].tolist(), parent['opaque'].tolist()))
    original_rows = dict(zip(parent['frames'].tolist(), parent['rows'].tolist()))
    output_records = []
    with gzip.open(cache,'rt') as source:
        layouts = [prepare(l) for l in json.loads(source.readline())['layout']]
        def analyze(line):
            r = json.loads(line)
            result = frame_features(r, layouts, old[r['n']])
            return r['n'], result, np.array(r['thumb'],dtype=np.uint8)
        with ThreadPoolExecutor(max_workers=4) as pool:
            batch = []
            for line in source:
                batch.append(pool.submit(analyze,line))
                if len(batch) == 8:
                    for future in batch: output_records.append(future.result())
                    batch = []
                    if len(output_records)%200 == 0: print(f'{name}: {len(output_records)} weighted frames validated',flush=True)
            for future in batch: output_records.append(future.result())
    output_records.sort(key=lambda r:r[0])
    frames = np.array([r[0] for r in output_records])
    assert len(frames)==cache_meta['total'] and len(set(frames.tolist()))==len(frames)
    rows, scores, margins, spans, raw_rows, raw_evs = [np.stack([r[1][k] for r in output_records]) for k in range(6)]
    keep = np.array([protected[n] for n in frames])
    saved_rows = np.array([original_rows[n] for n in frames])
    assert np.array_equal(raw_rows, saved_rows)
    parent_scores = dict(zip(parent['frames'].tolist(), parent['base'].tolist()))
    assert np.array_equal(raw_evs>=.5,np.array([parent_scores[n] for n in frames]))
    labels = np.array([-1 if truth[n]['truth'] is None else truth[n]['truth'] for n in frames])
    np.savez_compressed(output, frames=frames, rows=rows, scores=scores, margins=margins, spans=spans,
                        thumbs=np.stack([r[2] for r in output_records]), protected=keep, saved_rows=saved_rows,
                        original_accept=raw_evs>=.5, truth=labels)
    meta.write_text(json.dumps(signature,indent=2))
    return output


def primary_predictions(data):
    rows = np.repeat(data['rows'],3,axis=1).copy()
    visible, margin, span = data['scores'],data['margins'],data['spans']
    accepted = np.stack([visible>=.5,(visible>=.5)&(margin>=.5),
                         (visible>=.5)&(margin>=.5)&(span>=2)],axis=-1).reshape(rows.shape)
    keep = data['protected']
    rows[keep] = data['saved_rows'][keep,None]
    accepted[keep] = True
    return rows,accepted


def measures(truth, rows, accepted, original_good):
    correct = (truth[:,None]>=0)&(rows==truth[:,None])
    good = accepted&correct
    return {'correct':good.sum(axis=0).tolist(),
            'false_positives':(accepted&(truth[:,None]<0)).sum(axis=0).tolist(),
            'wrong_rows':(accepted&(truth[:,None]>=0)&~correct).sum(axis=0).tolist(),
            'new_correct':(good&~original_good[:,None]).sum(axis=0).tolist(),
            'lost_correct':(~good&original_good[:,None]).sum(axis=0).tolist()}


def evaluate(data, fps, anchor_rows, anchor_accept):
    rows,accepted = primary_predictions(data)
    truth,frames = data['truth'],data['frames']
    original_good = data['original_accept']&(data['saved_rows']==truth)&(truth>=0)
    outputs=[]; unions=[]; hashes=[hashlib.sha256() for _ in CONFIGS]
    for cut_index,cut in enumerate([.15,.30]):
        segments,_=cut_segments(frames,data['thumbs'],fps,cut)
        for mode_index,mode in enumerate(['none','one_1','both_1','one_2']):
            final=accepted if mode=='none' else temporal_gate(frames,rows,accepted,segments,fps,
                tolerance=2. if mode=='one_2' else 1.,both=mode=='both_1',targets=~data['protected'])|data['protected'][:,None]
            outputs.append(measures(truth,rows,final,original_good))
            union_rows=np.where(anchor_accept[:,None],anchor_rows[:,None],rows)
            unions.append(measures(truth,union_rows,final|anchor_accept[:,None],original_good))
            for i in range(len(METHODS)):
                hashes[(cut_index*4+mode_index)*len(METHODS)+i].update(
                    np.where(final[:,i],rows[:,i]+1,0).astype('uint8').tobytes())
    return ({k:sum([o[k] for o in outputs],[]) for k in outputs[0]},
            [h.hexdigest() for h in hashes],
            {k:sum([o[k] for o in unions],[]) for k in unions[0]})


def select(sources, held_out=None):
    train=[m for name,m in sources.items() if name!=held_out]
    eligible=[i for i in range(len(CONFIGS)) if all(
        m['false_positives'][i]==m['wrong_rows'][i]==m['lost_correct'][i]==0 for m in train)]
    if not eligible:
        return None  # report failure, never quietly retune a threshold
    return min(eligible,key=lambda i:(-sum(m['correct'][i] for m in train),i))


def synthetic_order(count):
    a,b=int(.30*count),int(.65*count)
    return np.r_[np.arange(a),np.arange(int(.55*count),int(.55*count)+b-a),
                 np.arange(int(.10*count),int(.10*count)+count-b)], [a,b]


def temporal_control(data, fps, config_index):
    order,boundaries=synthetic_order(len(data['frames']))
    rows,accepted=primary_predictions(data)
    method=config_index%len(METHODS);config=CONFIGS[config_index]
    rows,accepted=rows[order,method:method+1],accepted[order,method:method+1]
    stride=int(np.median(np.diff(data['frames'])))
    frames=np.arange(len(order))*stride
    segments,cuts=cut_segments(frames,data['thumbs'][order],fps,config['cut_threshold'])
    mode=config['temporal']
    final=accepted if mode=='none' else temporal_gate(frames,rows,accepted,segments,fps,
        tolerance=2. if mode=='one_2' else 1.,both=mode=='both_1',targets=~data['protected'][order])
    final=final|data['protected'][order,None]
    original_good=data['original_accept'][order]&(data['saved_rows'][order]==data['truth'][order])&(data['truth'][order]>=0)
    # Audit matching links across authored boundaries without supplying them to
    # cut detection or temporal inference.
    authored=np.zeros(len(order),dtype=int)
    for boundary in boundaries: authored[boundary:]+=1
    crossing=0
    tolerance=2. if mode=='one_2' else 1.
    for boundary in boundaries:
        for i in range(max(0,boundary-12),boundary):
            for j in range(boundary,min(len(order),boundary+12)):
                dt=(frames[j]-frames[i])/fps
                if dt<=.75 and segments[i]==segments[j] and authored[i]!=authored[j]:
                    error=(float(rows[j,0])-float(rows[i,0])-20*dt+16)%32-16
                    crossing+=int(accepted[i,0] and accepted[j,0] and abs(error)<=tolerance)
    return {'authored_boundaries':boundaries,'detected_boundaries':[bool(cuts[b]) for b in boundaries],
            'shot_signals':int(cuts.sum())-1,'possible_cross_boundary_support_links':crossing,
            'metrics':{k:v[0] for k,v in measures(data['truth'][order],rows,final,original_good).items()}}


def fps_for(name):
    video=ROOT/'fire-detection/data/video'/SOURCES[name]
    probe=ROOT/'FireCrackle/src-tauri/runtime/ffprobe.exe'
    raw=subprocess.check_output([str(probe),'-v','error','-select_streams','v:0',
        '-show_entries','stream=r_frame_rate','-of','json',str(video)])
    rate=json.loads(raw)['streams'][0]['r_frame_rate'].split('/')
    return int(rate[0])/int(rate[1])


def report_results(feature_paths, limit=None):
    sources,hashes,baselines,union_sources={},{},{},{}
    for name,path in feature_paths.items():
        data=np.load(path)
        truth=data['truth'];saved=data['saved_rows'];original=data['original_accept']
        good=original&(saved==truth)&(truth>=0)
        prior=np.load(SUPPORT/f'{name}-spatial-predictions.npz')
        from pov_gui_spatial import RULES
        k=RULES.index([('x_span',2),('mask_margin',.5)])
        index={int(n):i for i,n in enumerate(prior['frames'])}
        order=np.array([index[int(n)] for n in data['frames']])
        sources[name],hashes[name],union_sources[name]=evaluate(data,fps_for(name),prior['rows'][order],prior['accepted'][order,k])
        baselines[name]={
            'original':{k:v[0] for k,v in measures(truth,saved[:,None],original[:,None],good).items()},
            'opaque':{k:v[0] for k,v in measures(truth,saved[:,None],data['protected'][:,None],good).items()},
            'previous_best':{k:v[0] for k,v in measures(truth,prior['rows'][order,None],prior['accepted'][order,k:k+1],good).items()}}
        print(f'{name}: all mask/cell/temporal combinations measured',flush=True)
    pooled={k:np.sum([m[k] for m in sources.values()],axis=0).tolist() for k in next(iter(sources.values()))}
    selected=select({'pooled':pooled})
    union_pooled={k:np.sum([m[k] for m in union_sources.values()],axis=0).tolist() for k in next(iter(union_sources.values()))}
    union_selected=select({'pooled':union_pooled})
    folds=[]
    for name in sources:
        choice=select(sources,name)
        folds.append({'held_out':name,'selected':choice,'config':CONFIGS[choice] if choice is not None else None,
            'test':{k:v[choice] for k,v in sources[name].items()} if choice is not None else None})
    union_folds=[]
    for name in union_sources:
        choice=select(union_sources,name)
        union_folds.append({'held_out':name,'selected':choice,'config':CONFIGS[choice] if choice is not None else None,
            'test':{k:v[choice] for k,v in union_sources[name].items()} if choice is not None else None})
    controls={}
    fixed_method=MODELS.index((MASKS.index((0,0.)),0,0,1,1))*3+2
    for name,path in feature_paths.items():
        data=np.load(path);fps=fps_for(name)
        methods={'fixed_mask':fixed_method}
        if selected is not None: methods['selected']=selected%len(METHODS)
        controls[name]={label:{f'{cut}:{mode}':temporal_control(data,fps,(ci*4+mi)*len(METHODS)+method)
                    for ci,cut in enumerate([.15,.30]) for mi,mode in enumerate(['none','one_1','both_1','one_2'])}
                        for label,method in methods.items()}
    signatures=[tuple(h[i] for h in hashes.values()) for i in range(len(CONFIGS))]
    result={'configs':CONFIGS,'sources':sources,'baselines':baselines,'pooled':pooled,'selected':selected,'folds':folds,
        'secondary_anchor_union':{'post_hoc':True,'sources':union_sources,'pooled':union_pooled,
                                 'selected':union_selected,'folds':union_folds},
        'distinct_accepted_outputs':len(set(signatures)),'synthetic_cut_controls':controls,
        'analysis_sha256':sha(Path(__file__)),
        'aggregation_sha256':sha(Path(__file__).with_name('pov_probe_aggregate.rs')),
        'feature_metadata_hashes':{name:sha(path.with_suffix('.meta.json')) for name,path in feature_paths.items()}}
    target=OUT/('pilot-report.json' if limit else 'report.json')
    target.write_text(json.dumps(result,indent=2))
    print(json.dumps({'selected':CONFIGS[selected] if selected is not None else None,
        'pooled':{k:v[selected] for k,v in pooled.items()} if selected is not None else None,
        'folds':folds,'secondary_union':{
            'config':CONFIGS[union_selected] if union_selected is not None else None,
            'metrics':{k:v[union_selected] for k,v in union_pooled.items()} if union_selected is not None else None},
        'authored_cut_detections':{name:c['fixed_mask']['0.15:one_1']['detected_boundaries'] for name,c in controls.items()}}),flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sources', nargs='+', default=list(SOURCES))
    parser.add_argument('--limit', type=int)
    parser.add_argument('--extract-only', action='store_true')
    parser.add_argument('--analyze-only', action='store_true')
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    feature_paths={}
    for name in args.sources:
        suffix=f'-pilot{args.limit}' if args.limit else ''
        cache = OUT/f'{name}{suffix}.jsonl.gz' if args.analyze_only else extract(name,args.limit)
        if not args.extract_only: feature_paths[name]=derive(name,cache,args.limit)
    if feature_paths: report_results(feature_paths,args.limit)


if __name__ == '__main__':
    main()
