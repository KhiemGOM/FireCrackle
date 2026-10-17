"""Audit and rectify PARTIAL recorded ownership supervision, never global oracle masks.

Missing VBO metadata does not erase already mapped plane IDs. Unmapped fragments
are already unknown in the exported PNG. Only locally consistent, mapped IDs are
used, and warning-bearing frames keep their provenance. This experiment must not
be mistaken for certification of the recorder.
"""
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / 'fire-detection/bench/no_fire'))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from veil_native import apply as unveil
from render import load_sprites

OUT = ROOT / '.board/occlusion-recorded'
SESSION = ROOT / 'fire-detection/mod/run/firelabel/ownership-ebe022b2-f48a-456d-8c2c-169aedede5f9'
UNKNOWN = 0xffffff
UV = np.array([[0, 0], [1, 0], [1, 1], [0, 1]], float)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def map_uv(uv, xy):
    """Fit the submitted UV correspondence, including reversed vertex winding."""
    a = []; b = []
    for (u, v), (x, y) in zip(uv, xy):
        a.extend([[u, v, 1, 0, 0, 0, -x*u, -x*v], [0, 0, 0, u, v, 1, -y*u, -y*v]])
        b.extend([x, y])
    return np.append(np.linalg.solve(a, b), 1).reshape(3, 3)


def project(matrix, uv):
    p = np.concatenate([uv, np.ones((*uv.shape[:-1], 1))], -1) @ matrix.T
    return p[..., :2] / p[..., 2:]


def rectify(rgb, ids, matrix, size=64):
    t = (np.arange(size)+.5)/size
    u, v = np.meshgrid(t, t)
    xy = project(matrix, np.stack([u, v], -1))
    h, w = ids.shape
    inside = (xy[..., 0] >= 1) & (xy[..., 0] < w-1) & (xy[..., 1] >= 1) & (xy[..., 1] < h-1)
    ix = np.clip(np.floor(xy[..., 0]).astype(int), 1, w-2)
    iy = np.clip(np.floor(xy[..., 1]).astype(int), 1, h-2)
    label = ids[iy, ix]
    # Remove source-pixel boundary ambiguity and all unknown regions.
    valid = inside & (label != UNKNOWN)
    for dx, dy in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
        valid &= ids[iy+dy, ix+dx] == label
    x = np.clip(xy[..., 0]-.5, 0, w-1); y = np.clip(xy[..., 1]-.5, 0, h-1)
    x0 = x.astype(int); y0 = y.astype(int); x1 = np.minimum(x0+1, w-1); y1 = np.minimum(y0+1, h-1)
    fx = (x-x0)[..., None]; fy = (y-y0)[..., None]
    crop = rgb[y0, x0]*(1-fx)*(1-fy)+rgb[y0, x1]*fx*(1-fy)+rgb[y1, x0]*(1-fx)*fy+rgb[y1, x1]*fx*fy
    return np.uint8(np.clip(crop, 0, 255).round()), label, valid


def split_frame(frame):
    # Entire ~600-render-frame blocks share a split. Purge boundary neighbours.
    block, offset = divmod(frame, 600)
    if offset < 100 or offset >= 500:
        return None
    return ['train', 'train', 'validation', 'train', 'test'][block % 5]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    sprites = load_sprites(); rows = []; xs = []; ys = []; vs = []; fs = []; rejects = Counter(); sources = []
    sync = [json.loads(x) for x in (ROOT/'.board/ownership-review/sync.jsonl').read_text().splitlines()]
    first = min(x['f'] for x in sync); last = max(x['f'] for x in sync)
    for path in sorted(SESSION.glob('frame-*.json')):
        frame = int(path.stem.split('-')[1]); split = split_frame(frame)
        if frame < first or frame > last or split is None:
            continue
        d = json.loads(path.read_text())
        issues = d['issues']
        if any(not (x.startswith('missing_source_vertices_') or x.startswith('unmapped_fire_fragments_')) for x in issues):
            rejects['unsupported_frame_issue'] += 1; continue
        if d['known_fire_pixels'] < 100:
            continue
        if any(digest(SESSION/d[k]) != d[k+'_sha256'] for k in ['rgb', 'ids']):
            raise ValueError('Image hash mismatch: '+path.name)
        rgb = np.array(Image.open(SESSION/d['rgb']).convert('RGB'))
        rgb, applied, _ = unveil(rgb)
        encoded = np.array(Image.open(SESSION/d['ids']).convert('RGBA')).astype(np.uint32)
        ids = encoded[..., 0]+256*encoded[..., 1]+65536*encoded[..., 2]
        values, counts = np.unique(ids[(ids > 0) & (ids < UNKNOWN)], return_counts=True)
        visible = dict(zip(values.tolist(), counts.tolist()))
        selected = sorted((q for q in d['quads'] if visible.get(q['id'], 0) >= 100), key=lambda q: visible[q['id']], reverse=True)[:24]
        accepted = 0
        for q in selected:
            if not 0 <= q['row'] < 32:
                rejects['invalid_row'] += 1; continue
            clip = np.asarray(q['clip_corners'], float)
            if np.any(clip[:, 3] <= 0):
                rejects['near_plane'] += 1; continue
            xy = (clip[:, :2]/clip[:, 3:]+1)*np.array([rgb.shape[1], rgb.shape[0]])/2
            xy[:, 1] = rgb.shape[0]-xy[:, 1]
            try:
                matrix = map_uv(np.array(q['uv']), xy); quad = project(matrix, UV)
            except np.linalg.LinAlgError:
                rejects['degenerate_quad'] += 1; continue
            if not np.isfinite(quad).all() or np.linalg.norm(quad-np.roll(quad, 1, axis=0), axis=1).min() < 16:
                rejects['too_small_or_nonfinite'] += 1; continue
            crop, label, valid = rectify(rgb, ids, matrix)
            target = label == q['id']; expected = sprites[q['sheet']*64+q['row']*2, :, :, 3] >= 26
            expected = np.repeat(np.repeat(expected, 4, 0), 4, 1)
            consistency = float((target & valid & ~expected).sum())/max(1, int((target & valid).sum()))
            if consistency > .03:
                rejects['ownership_sprite_disagreement'] += 1; continue
            # Texture-boundary probes can cross a filtered alpha edge. Ignore them.
            inner = (np.arange(64) % 4 == 1) | (np.arange(64) % 4 == 2)
            valid &= inner[:, None] & inner[None, :]
            if (target & valid).sum() < 24 or valid.sum() < 128:
                rejects['too_little_evidence'] += 1; continue
            foreign = (label > 0) & (label != q['id']) & (label != UNKNOWN)
            index = len(rows)
            rows.append(dict(id=f'{frame}-{q["id"]}', frame=frame, split=split, sheet=q['sheet'], row=q['row'],
                             expected=[q['sheet'], q['row'], False], quad=(quad/[rgb.shape[1], rgb.shape[0]]).tolist(),
                             source_json=path.name, warning_count=len(issues), issue_free=not issues, global_ground_truth=False,
                             positive_pixels=int((target & valid).sum()), valid_pixels=int(valid.sum()), foreign_pixels=int((foreign & valid).sum()),
                             sprite_disagreement=consistency, unveil_applied=applied, crop=index))
            xs.append(crop); ys.append(target); vs.append(valid); fs.append(foreign); accepted += 1
        sources.append(dict(frame=frame, json_sha256=digest(path), rgb_sha256=d['rgb_sha256'], ids_sha256=d['ids_sha256'],
                            issues=issues, accepted_planes=accepted))
        print(json.dumps(dict(frame=frame, accepted=accepted, total=len(rows))), flush=True)
    if not rows:
        raise RuntimeError('No locally consistent recorded planes survived audit')
    np.savez_compressed(OUT/'recorded.npz', rgb=np.stack(xs), target=np.stack(ys), valid=np.stack(vs), foreign=np.stack(fs))
    manifest = dict(session=str(SESSION), video='2026-10-17 18-28-42.mkv', samples=rows, source_frames=sources,
                    rejects=dict(rejects), counts=dict(Counter(r['split'] for r in rows)), seed=19017,
                    supervision='Partial renderer-derived ownership, not certified oracle. Global frame warnings preserved; unknown pixels ignored.',
                    audit='hashes; mapped IDs; positive clip W; >=16px edges; >=100 native positive pixels; <=3% alpha disagreement; 1px stable-ID border; inner texel probes',
                    split='600 render-frame blocks, 100-frame boundary purge on each side; split by block modulo5; no frame crosses splits',
                    preprocessing_sha256=digest(ROOT/'fire-detection/core/src/veil.rs'), script_sha256=digest(Path(__file__)))
    (OUT/'manifest.json').write_text(json.dumps(manifest, indent=2))
    print(json.dumps(dict(samples=len(rows), counts=manifest['counts'], rejects=dict(rejects))))


if __name__ == '__main__':
    main()
