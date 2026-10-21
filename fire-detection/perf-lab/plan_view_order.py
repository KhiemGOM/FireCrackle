"""Choose a no-fire view order from `perf-lab views` samples.

Only frames the policy would actually send to the model count (cnn_needed). Every
order gives the same frame decisions; the greedy choice maximises, step by step, the
number of still-unrejected frames the next view rejects per unit of cost. Cost is 1 per
view by default (the GPU session is the bottleneck and every view is 224×224); pass
--full-cost to weight the full-frame view by its larger CPU resize instead.

  python plan_view_order.py results/micro/views-*.jsonl [--full-cost 2.6]
"""
import argparse, json
from pathlib import Path

NAMES = ['full', 't0_0', 't427_0', 't853_0', 't1280_0', 't0_428', 't427_428', 't853_428', 't1280_428']
p = argparse.ArgumentParser()
p.add_argument('files', nargs='+')
p.add_argument('--full-cost', type=float, default=1.0)
a = p.parse_args()
cost = {'full': a.full_cost}
sets = {Path(f).stem: [json.loads(l) for l in open(f)] for f in a.files}
used = {k: [r for r in rows if r.get('cnn_needed') is True] for k, rows in sets.items()}
for k, rows in sets.items():
    print(f"{k}: frames {len(rows)}, model consulted {len(used[k])}, of those rejected {sum(any(r['rejects']) for r in used[k])}")
rows_all = [r for rows in used.values() for r in rows]
views = [(p, i) for p in (0, 9) for i in range(9)]


def hits(r, v):
    return v[0] + v[1] < len(r['rejects']) and r['rejects'][v[0] + v[1]]


def plan(rows):
    remaining = [r for r in rows if any(r['rejects'])]
    order, left = [], list(views)
    while remaining and left:
        best = max(left, key=lambda v: sum(hits(r, v) for r in remaining) / cost.get(NAMES[v[1]], 1.0))
        if not any(hits(r, best) for r in remaining):
            break
        order.append(best)
        left.remove(best)
        remaining = [r for r in remaining if not hits(r, best)]
    return order + [v for v in views if v not in order]


def expected(rows, order):
    total = 0.0
    for r in rows:
        for v in order:
            if v[0] + v[1] >= len(r['rejects']):
                continue
            total += cost.get(NAMES[v[1]], 1.0)
            if hits(r, v):
                break
    return total / max(len(rows), 1)


order = plan(rows_all)
label = lambda v: ('raw' if v[0] == 0 else 'unv') + ':' + NAMES[v[1]]
print('order:', ' '.join(label(v) for v in order))
for k, rows in used.items():
    print(f"  {k}: expected views per consulted frame {expected(rows, views):.2f} -> {expected(rows, order):.2f}")
print('view_order=' + ','.join(f"{0 if v[0] == 0 else 1}:{v[1]}" for v in order))
