"""Accuracy runs for the perf lab: production decisions at a stride over the labelled
1080p recordings, scored against the mod's ground truth (first-person rows) or the
width-24 no-fire targets. Truth loading reuses the frozen bench helpers from the main
checkout, which also holds the ignored recordings and labels.

  python eval.py pov    --tag baseline [--names clip1,clip2,quad1,survival1,early,later] [--decoder app]
  python eval.py nofire --tag baseline [--names clip2,clip1,quad1,survival1] [--stride 5]

Writes results/<tag>/<tool>-<name>.jsonl (decisions) and results/<tag>/<tool>-report.json.
"""
import argparse, json, os, subprocess, sys, time
from pathlib import Path

LAB = Path(__file__).resolve().parent
CHECKOUT = LAB.parents[1]
# .board/scan-perf-lab/checkout -> repository root with the ignored data
MAIN = CHECKOUT.parents[2] if (CHECKOUT.parents[2] / 'fire-detection/data/video').is_dir() else CHECKOUT
sys.path.insert(0, str(MAIN / 'fire-detection/bench'))
from pov_gui_ablation import SOURCES as DEV, truth_for  # noqa: E402
from pov_independent import OUT as SEPARATE, SOURCES as EXTRA, read_truth, summarize  # noqa: E402

VIDEOS = {**DEV, **EXTRA}
POV_STRIDE = {'clip1': 5, 'clip2': 5, 'quad1': 30, 'survival1': 30, 'early': 5, 'later': 5}
# Built with `cargo build --release --manifest-path fire-detection/perf-lab/Cargo.toml`; PERF_LAB_BIN overrides it.
BINARY = Path(os.environ.get('PERF_LAB_BIN', LAB / 'target/release/perf-lab.exe'))


def pov_truth(name):
    if name in DEV:
        labels, last, _ = truth_for(name)
        return {n: x['truth'] for n, x in labels.items()}, last + 1
    labels, _, _ = read_truth(SEPARATE / f'{name}.joined.jsonl')
    total = sum(1 for _ in (SEPARATE / f'{name}.joined.jsonl').open(encoding='utf8'))
    return {n: x['row'] for n, x in labels.items()}, total


def nofire_truth(name):
    rows = {}
    for line in (MAIN / '.board/no-fire-width24' / f'{name}-targets.jsonl').open(encoding='utf8'):
        r = json.loads(line)
        rows[r['frame']] = r
    return rows, max(rows) + 1


def run(tool, name, stride, total, out, args):
    video = MAIN / 'fire-detection/data/video' / VIDEOS[name]
    cmd = [str(BINARY), 'eval', f'tool={tool}', f'video={video}', 'w=1920', 'h=1080',
           f'stride={stride}', f'frames={total}', f'decoder={args.decoder}', f'out={out}', f'root={MAIN}']
    if args.workers:
        cmd.append(f'workers={args.workers}')
    if args.decoder == 'cuvid':
        cmd.append('cuvid=h264_cuvid')  # the labelled recordings are H.264
    cmd += args.extra
    started = time.monotonic()
    with (out.with_suffix('.log')).open('w', encoding='utf8') as log:
        text = subprocess.run(cmd, stderr=log, stdout=subprocess.PIPE, check=True, text=True).stdout
    summary = json.loads(text.strip().splitlines()[-1])
    summary['wall_seconds'] = time.monotonic() - started
    return summary


def score_pov(rows, truth):
    cases = [{'frame': r['n'], 'truth': truth[r['n']], 'row': r['row'], 'accepted': r['row'] is not None}
             for r in rows if r['n'] in truth]
    return summarize(cases)


def score_nofire(rows, truth):
    scored = [r for r in rows if r['n'] in truth]
    eligible = [r for r in scored if truth[r['n']]['clear_positive']]
    fire = [r for r in scored if truth[r['n']]['target'] == 'fire']
    tp = [r['n'] for r in eligible if r['clear']]
    fp = [r['n'] for r in fire if r['clear']]
    other = [r['n'] for r in scored if r['clear'] and not truth[r['n']]['clear_positive'] and truth[r['n']]['target'] != 'fire']
    return {'frames': len(scored), 'eligible': len(eligible), 'fire': len(fire), 'clears': sum(r['clear'] for r in scored),
            'tp': len(tp), 'fp': len(fp), 'other_clears': len(other),
            'tp_rate': len(tp) / len(eligible) if eligible else None,
            'fp_rate': len(fp) / len(fire) if fire else None, 'fp_frames': fp}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('tool', choices=['pov', 'nofire'])
    p.add_argument('--tag', required=True)
    p.add_argument('--names')
    p.add_argument('--decoder', default='app')
    p.add_argument('--stride', type=int)
    p.add_argument('--workers', type=int)
    p.add_argument('--extra', action='append', default=[], help='further key=value argument for perf-lab (repeatable)')
    args = p.parse_args()
    names = args.names.split(',') if args.names else (list(VIDEOS) if args.tool == 'pov' else ['clip2'])
    out_dir = LAB / 'results' / args.tag
    out_dir.mkdir(parents=True, exist_ok=True)
    report_path = out_dir / f'{args.tool}-report.json'
    report = json.loads(report_path.read_text(encoding='utf8')) if report_path.exists() else {}
    for name in names:
        truth, total = pov_truth(name) if args.tool == 'pov' else nofire_truth(name)
        stride = args.stride or (POV_STRIDE[name] if args.tool == 'pov' else 5)
        out = out_dir / f'{args.tool}-{name}.jsonl'
        summary = run(args.tool, name, stride, total, out, args)
        rows = [json.loads(s) for s in out.read_text(encoding='utf8').splitlines()]
        metrics = score_pov(rows, truth) if args.tool == 'pov' else score_nofire(rows, truth)
        report[name] = {'run': summary, 'metrics': metrics}
        report_path.write_text(json.dumps(report, indent=1), encoding='utf8')
        shown = {k: v for k, v in metrics.items() if not isinstance(v, list)}
        print(name, json.dumps(shown), f"{summary['fps']:.1f} fps", flush=True)


if __name__ == '__main__':
    main()
