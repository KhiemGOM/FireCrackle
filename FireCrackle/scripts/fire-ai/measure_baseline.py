"""Measure production fixed-quad matcher on the exact reviewed AI cases.

Research adapter only: native frames, unchanged supplied geometry, no label writes.
"""
import hashlib
import json
import subprocess
from pathlib import Path
import numpy as np
from render import rectify

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / ".board/fire-ai/baseline-reviewed"


def read(path):
    return json.loads(path.read_text(encoding="utf8"))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    review = read(Path(__file__).with_name("survival-review.json"))
    dense = read(ROOT / ".board/fire-ai/survival-train-dense/manifest.json")
    by_id = {s["id"]: s for s in dense["samples"]}
    cases = []
    for ident in review["val"]:
        s = by_id[ident]
        label = s["label"]
        cases.append(dict(id=ident, frame=s["frame"], quad=s["quad"],
                          expected=[label // 64, label % 64 // 2, bool(label % 2)],
                          source=s["source"], split="validation"))
    assert len(cases) == 15 and len({s["id"] for s in cases}) == 15
    frames = sorted({s["frame"] for s in cases})
    wanted = {s["frame"]: [] for s in cases}
    for s in cases:
        wanted[s["frame"]].append(s)
    joined = ROOT / "fire-detection/data/joined/survival1.jsonl"
    digest = hashlib.sha256()
    with joined.open("rb") as stream:
        for line in stream:
            digest.update(line)
            row = json.loads(line)
            for s in wanted.get(row["n"], []):
                _, fi, qi = map(int, s["id"].split("-"))
                q = row["label"]["fires"][fi]["quads"][qi]
                assert s["expected"] == [q["s"], q["row"], bool(q["m"])]
                s.update(visibility=q["vis"], veil=q["veil"])
    assert digest.hexdigest() == review["source_joined_sha256"] == dense["joined_sha256"]
    assert all("visibility" in s for s in cases)
    manifest = dict(width=1920, height=1080, joined_sha256=digest.hexdigest(), samples=cases)
    (OUT / "manifest.json").write_text(json.dumps(manifest), encoding="utf8")
    missing = [n for n in frames if not (OUT / f"{n}.rgb").exists()]
    if missing:
        expression = "+".join(f"eq(n\\,{n})" for n in missing)
        command = [str(ROOT / "FireCrackle/src-tauri/runtime/ffmpeg.exe"), "-v", "error",
                   "-i", str(ROOT / "fire-detection/data/video/2026-10-16 18-23-42.mkv"),
                   "-vf", f"select='{expression}'", "-frames:v", str(len(missing)),
                   "-fps_mode", "passthrough", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"]
        proc = subprocess.Popen(command, stdout=subprocess.PIPE)
        try:
            for n in missing:
                buf = bytearray()
                while len(buf) < 1920 * 1080 * 3:
                    chunk = proc.stdout.read(1920 * 1080 * 3 - len(buf))
                    if not chunk:
                        raise RuntimeError(f"Truncated native frame {n}")
                    buf.extend(chunk)
                (OUT / f"{n}.rgb").write_bytes(buf)
        finally:
            proc.stdout.close()
        if proc.wait():
            raise RuntimeError("Native frame decode failed")
    curated = read(ROOT / ".board/fire-ai/survival-curated/review.json")
    assert curated["val"] == review["val"]
    with np.load(ROOT / ".board/fire-ai/survival-curated/val.npz") as data:
        for i, s in enumerate(cases):
            frame = np.fromfile(OUT / f'{s["frame"]}.rgb', np.uint8).reshape(1080, 1920, 3)
            crop = rectify(frame, np.asarray(s["quad"]) * [1920, 1080])
            assert np.array_equal(crop, data["x"][i]), f'AI crop differs: {s["id"]}'
            a, b, c = s["expected"]
            assert data["y"][i] == a * 64 + b * 2 + int(c)
    subprocess.run(["node", str(ROOT / "FireCrackle/scripts/actual-quad-eval.mjs"),
                    str(OUT), "validation", "reviewed-baseline", "fixed", "1"], check=True)
    survival = read(OUT / "reviewed-baseline-fixed-validation.json")
    quad_manifest = read(ROOT / ".board/fire-ai/quad1/manifest.json")
    subset = read(ROOT / ".board/fire-ai/quad1/quality-subset.json")
    ids = [quad_manifest["samples"][i]["id"] for i in subset["indices"]]
    prior = read(ROOT / "FireCrackle/src-tauri/target/actual-quad1/coherent-gain-fixed-validation.json")
    assert prior["hashes"] == survival["hashes"], "Prior baseline source differs"
    rows = {r["id"]: r for r in prior["rows"]}
    selected = [rows[i] for i in ids]
    for i, r in zip(subset["indices"], selected):
        original = quad_manifest["samples"][i]
        assert original["quad"] == r["quad"] and original["expected"] == r["expected"]
    summary = dict(quads=len(selected), top1=sum(r["correct"] for r in selected),
                   top3=sum(r["top3"] for r in selected),
                   accepted=sum(r["status"] == "clear" for r in selected),
                   accepted_wrong=sum(r["status"] == "clear" and not r["correct"] for r in selected))
    result = dict(survival=survival["summary"], survival_seconds=survival["elapsed_seconds"],
                  quad1_subset=summary, hashes=survival["hashes"], quad1_rows=selected,
                  quad1_evidence="Exact IDs, geometry, labels and source hashes verified against prior full310 run")
    (OUT / "summary.json").write_text(json.dumps(result, indent=2), encoding="utf8")
    print(json.dumps({k: v for k, v in result.items() if k != "quad1_rows"}), flush=True)


if __name__ == "__main__":
    main()
