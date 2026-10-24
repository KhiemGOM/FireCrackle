"""Per-case click / held-out max error vs the case pixels (validation of the adapter's conventions)."""
import json, math, sys
cs = {c['id']: c for c in json.load(open(sys.argv[1]))['cases']}
only = sys.argv[3] if len(sys.argv) > 3 else ''
worst0 = 0.0
for a in json.load(open(sys.argv[2]))['answers']:
    c = cs[a['id']]
    if only and not a['id'].startswith(only): continue
    if not a['ok']:
        print(f"{a['id']:24s} FAIL {a['note']}"); continue
    e = max(math.hypot(p[0]-q['px'][0], p[1]-q['px'][1]) for p, q in zip(a['clicks_px'], c['clicks']))
    he = max(math.hypot(p[0]-q['px'][0], p[1]-q['px'][1]) for p, q in zip(a['heldout_px'], c['heldout']))
    if c['noise'] == 0 and c['kind'] == 'synthetic': worst0 = max(worst0, e)
    t, k = c['truth'], a['camera']
    print(f"{a['id']:24s} click {e:9.5f} held {he:8.3f} fov {k['fov']:8.3f}/{t['fov']:7.2f} dyaw {k['yaw']-t['yaw']:+8.4f} dpitch {k['pitch']-t['pitch']:+8.4f} roll {k['roll']-t['roll']:+8.4f} {a['ms']:6.0f}ms | {a['note']}")
print('worst noise-free synthetic click error (answered):', worst0)
