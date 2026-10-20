"""Masked OpenCV ECC; real unmodified RGB. No learning or independent unveil."""
import concurrent.futures, json, time, sys
from pathlib import Path
import cv2
import numpy as np

ROOT=Path(__file__).resolve().parents[4]; OUT=ROOT/'.board/ecc-align'
N=128
UNIT=np.float32([[0,0],[1,0],[1,1],[0,1]])
cv2.setNumThreads(1)

def canvas_h(quad):
    # Pixel centres: common canvas spans UV [-.1,1.1].
    corners=(UNIT+.1)/1.2*N-.5
    return cv2.getPerspectiveTransform(corners,np.float32(quad))

def validate_result(result, origin):
    """Check actual returned geometry too: OpenCV can return zero at a projective pole."""
    inv=cv2.getPerspectiveTransform(np.float32(origin),UNIT)
    homogeneous=np.column_stack([result,np.ones(4)])@inv.T
    denominator=homogeneous[:,2]
    if np.any(np.abs(denominator)<1e-9) or not (np.all(denominator>0) or np.all(denominator<0)):
        raise ValueError('projective pole in returned geometry')
    uv=homogeneous[:,:2]/denominator[:,None]
    if not np.isfinite(uv).all() or uv.min()<-.1001 or uv.max()>1.1001:
        raise ValueError('returned geometry outside bounded outline')

def fit(image, mask, models, quad, only_phase=None, bounded=False, only_model=None):
    # Match production sampleFrame: image fractions refer to texel edges;
    # OpenCV coordinates refer to pixel centres.
    hp=canvas_h(np.asarray(quad)*[image.shape[1],image.shape[0]]-.5)
    patch=cv2.warpPerspective(image,np.linalg.inv(hp),(N,N),flags=cv2.INTER_LINEAR)
    valid=cv2.warpPerspective(mask,np.linalg.inv(hp),(N,N),flags=cv2.INTER_NEAREST)
    gray=cv2.cvtColor(patch,cv2.COLOR_RGB2GRAY).astype(np.float32)/255
    candidates=[]; failures=0; started=time.perf_counter()
    for i,(template,alpha,phase) in enumerate(models):
        if only_phase is not None and phase!=only_phase:continue
        if only_model is not None and i!=only_model:continue
        warp=np.eye(3,dtype=np.float32);reason=None;cc=None
        try:
            if np.count_nonzero((alpha>0)&(valid>0))<64:raise ValueError('insufficient support')
            coords=(UNIT+.1)/1.2*N-.5
            if bounded:
                best=None;best_cc=-np.inf
                for iteration in range(30):
                    old=warp.copy()
                    try:
                        value,next_warp=cv2.findTransformECCWithMask(template,gray,alpha,valid,warp.copy(),cv2.MOTION_HOMOGRAPHY,(cv2.TERM_CRITERIA_COUNT,1,0),3)
                    except cv2.error:
                        if best is None:raise
                        break
                    if np.isfinite(value) and value>best_cc:best_cc=value;best=old
                    uv=(cv2.perspectiveTransform(coords[None],next_warp)[0]+.5)/N*1.2-.1
                    if not np.isfinite(uv).all():break
                    projected=(np.clip(uv,-.1,1.1)+.1)/1.2*N-.5
                    warp=cv2.getPerspectiveTransform(coords,projected.astype(np.float32)).astype(np.float32)
                    if np.max(np.abs(cv2.perspectiveTransform(coords[None],old)[0]-projected))<.03:break
                warp=best if best is not None else np.eye(3,dtype=np.float32);cc=float(best_cc)
            else:
                cc,warp=cv2.findTransformECCWithMask(template,gray,alpha,valid,warp,cv2.MOTION_HOMOGRAPHY,(cv2.TERM_CRITERIA_COUNT|cv2.TERM_CRITERIA_EPS,60,1e-5),3)
            uv=(cv2.perspectiveTransform(coords[None],warp)[0]+.5)/N*1.2-.1
            if not np.isfinite(uv).all() or np.any(uv<-.10001) or np.any(uv>1.10001):raise ValueError('outside bounded outline')
            result=(cv2.perspectiveTransform(coords[None],hp@warp)[0]+.5)/[image.shape[1],image.shape[0]]
            validate_result(result,quad)
            edges=np.roll(result,-1,axis=0)-result
            cross=edges[:,0]*np.roll(edges,-1,axis=0)[:,1]-edges[:,1]*np.roll(edges,-1,axis=0)[:,0]
            if not (np.all(cross>1e-10) or np.all(cross< -1e-10)):raise ValueError('folded quad')
        except (cv2.error,ValueError) as e:
            failures+=1;result=quad;reason=str(e).split('\n')[0]
        candidates.append(dict(model=i,quad=np.asarray(result).tolist(),correlation=cc,reason=reason))
    return dict(candidates=candidates,failures=failures,ms=(time.perf_counter()-started)*1000)

def templates(material):
    result=[];xy=np.arange(N,dtype=np.float32);u=((xy+.5)/N*1.2-.1)*16-.5
    mx,my=np.meshgrid(u,u)
    for sheet in [0,1]:
        raw=np.fromfile(OUT/f'{material}-{sheet}.rgba',np.uint8).reshape(32,16,16,4)
        for row in range(32):
            for mirror in [False,True]:
                tex=raw[row,:,::-1] if mirror else raw[row]
                expanded=cv2.remap(tex,mx,my,cv2.INTER_NEAREST,borderMode=cv2.BORDER_CONSTANT)
                # Only opaque sprite texels are reference evidence, never transparent black.
                alpha=np.uint8(expanded[:,:,3]>127)*255
                gray=cv2.cvtColor(expanded[:,:,:3],cv2.COLOR_RGB2GRAY).astype(np.float32)/255
                result.append((gray,alpha,row))
    return result

def main():
    bounded='--bounded' in sys.argv
    limit=next((int(a) for a in sys.argv[1:] if a.isdigit()),128)
    rows=json.loads((OUT/'cases.json').read_text())[:limit];bank={m:templates(m) for m in ['normal','soul']}
    def work(pair):
        i,r=pair;image=np.fromfile(ROOT/r['pixels'],np.uint8).reshape(r['height'],r['width'],3)
        mask=np.fromfile(OUT/f'{i}.mask',np.uint8).reshape(r['height'],r['width'])*255
        exact_mask=np.fromfile(OUT/f'{i}.exact.mask',np.uint8).reshape(r['height'],r['width'])*255
        return dict(id=r['id'],rough=fit(image,mask,bank[r['material']],r['rough'],bounded=bounded),exact=fit(image,exact_mask,bank[r['material']],r['quad'],r['phase'],bounded))
    results=[];start=time.perf_counter()
    # Independent cases, fixed four workers, one OpenCV thread each.
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for result in pool.map(work,enumerate(rows)):
            results.append(result)
            (OUT/('ecc-bounded.json' if bounded else 'ecc.json')).write_text(json.dumps(results))
            print(json.dumps(dict(done=len(results),total=len(rows),seconds=round(time.perf_counter()-start))),flush=True)

if __name__=='__main__':main()
