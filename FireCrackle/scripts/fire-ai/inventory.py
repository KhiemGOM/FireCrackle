"""Count recorded quad fields, not boxes; do not infer visual cleanliness."""
import collections
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]


def inventory(path):
    counts=collections.Counter();example=None
    for line in path.open(encoding="utf8"):
        r=json.loads(line);label=r.get("label") or {}
        counts["frames"]+=1
        for fire in label.get("fires",[]):
            quads=fire.get("quads",[])
            counts["source_frames_"+fire["src"]]+=1
            counts["quads_"+fire["src"]]+=len(quads)
            for q in quads:
                counts["with_corners"]+=q.get("c") is not None
                counts["vis_ge_095"]+=q.get("vis",0)>=.95
            if quads and example is None:example=dict(frame=r["n"],source=fire)
    return dict(counts=counts,example=example)


if __name__=="__main__":
    import argparse
    ap=argparse.ArgumentParser();ap.add_argument("out",type=Path);args=ap.parse_args()
    result={name:inventory(ROOT/f"fire-detection/data/joined/{name}.jsonl") for name in ["quad1","survival1"]}
    args.out.write_text(json.dumps(result,indent=2));print(json.dumps({k:v["counts"] for k,v in result.items()},indent=2))
