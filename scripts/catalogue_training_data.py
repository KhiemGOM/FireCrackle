"""Inventory local video research data without loading tensors or copying private samples.

Run from any directory: python scripts/catalogue_training_data.py --write
Only the marked appendix in the catalogue is regenerated; maintain the source register above it.
"""
from __future__ import annotations

import argparse
import ast
from collections import Counter
import csv
import hashlib
import json
import mmap
import os
from pathlib import Path
import struct
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs/TRAINING_DATA_INVENTORY.json"
DOC = ROOT / "docs/TRAINING_DATA_CATALOGUE.md"
MARKER = "<!-- GENERATED INVENTORY: run scripts/catalogue_training_data.py --write -->"
SKIP = {".git", "node_modules", ".venv", "venv", "deps", "site-packages", "__pycache__", ".pytest_cache", ".release-worktrees", "releases", ".release-cache", "release", "incremental", "gen"}
VIDEO_EXT = {".mkv", ".mp4", ".webm", ".mov", ".avi"}


def relative(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def schema(value, depth=0):
    if depth > 4:
        return type(value).__name__
    if isinstance(value, dict):
        return {k: schema(v, depth + 1) for k, v in value.items()}
    if isinstance(value, list):
        return {"type": "array", "example_length": len(value), "item": schema(value[0], depth + 1) if value else "not observed"}
    return "null" if value is None else type(value).__name__


def npy_header(f):
    if f.read(6) != b"\x93NUMPY":
        raise ValueError("Invalid NPY magic")
    major, _minor = f.read(2)
    if major not in (1, 2, 3):
        raise ValueError("Unsupported NPY version")
    size = struct.unpack("<H" if major == 1 else "<I", f.read(2 if major == 1 else 4))[0]
    if size > 1024 * 1024:
        raise ValueError("Oversized NPY header")
    h = ast.literal_eval(f.read(size).decode("utf-8" if major == 3 else "latin1").strip())
    return {"shape": list(h["shape"]), "dtype": h["descr"], "fortran_order": h["fortran_order"]}


def npz_headers(path: Path):
    """Read only NPY headers inside ZIP members, never deserialize object arrays."""
    out = {}
    with zipfile.ZipFile(path) as z:
        for name in z.namelist():
            if name.endswith(".npy"):
                with z.open(name) as f:
                    out[name[:-4]] = npy_header(f)
    return out


def line_count(path):
    count, last = 0, b""
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(4 * 1024 * 1024), b""):
            count += chunk.count(b"\n")
            last = chunk[-1:]
    return count + int(bool(last) and last != b"\n")


def inspect_jsonl(path, count=False):
    records = []
    with path.open(encoding="utf-8-sig") as f:
        for _ in range(12):
            line = f.readline()
            if not line:
                break
            if line.strip():
                records.append(json.loads(line))
    # Find representative optional structures without decoding millions of duplicate frames.
    # These are observed examples, not a full-record schema validation.
    if count and path.stat().st_size:
        with path.open("rb") as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as mm:
            for token in (b'"quads":', b'"quads":[{', b'"quads": [{', b'"soul_fires":', b'"soul_fires":[{', b'"soul_fires": [{', b'"src":"entity"', b'"src": "entity"', b'"src":"overlay"', b'"src": "overlay"'):
                at = mm.find(token)
                if at >= 0:
                    start = mm.rfind(b"\n", 0, at) + 1
                    end = mm.find(b"\n", at)
                    records.append(json.loads(mm[start:end if end >= 0 else len(mm)]))
    out = {"observed_schemas": []}
    for record in records:
        shape = schema(record)
        if shape not in out["observed_schemas"]:
            out["observed_schemas"].append(shape)
    if count:
        out["lines"] = line_count(path)
    return out


def inspect_manifest(path):
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    out = {"sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "schema": schema(data)}
    if isinstance(data, list):
        out["records_count"] = len(data)
        if data:
            out["records_schema"] = schema(data[0])
        if data and isinstance(data[0], dict):
            out["records_splits"] = dict(Counter(str(r.get("split", "unspecified")) for r in data))
            out["records_sources"] = dict(Counter(str(r.get("video", r.get("kind", r.get("source", "unspecified")))) for r in data))
    if isinstance(data, dict):
        for key in ("dataset", "kind", "video", "session", "width", "height", "stride", "tune_end", "validation_start", "counts", "split", "supervision", "audit", "screening", "selection", "real_use", "training_source", "preprocessing_sha256", "joined_sha256"):
            if key in data:
                out[key] = data[key]
        for key in (k for k, v in data.items() if isinstance(v, list)):
            if isinstance(data.get(key), list):
                rows = data[key]
                out[key + "_count"] = len(rows)
                if rows:
                    out[key + "_schema"] = schema(rows[0])
                if rows and isinstance(rows[0], dict):
                    out[key + "_splits"] = dict(Counter(str(r.get("split", "unspecified")) for r in rows))
                    out[key + "_sources"] = dict(Counter(str(r.get("dataset", r.get("source", "unspecified"))) for r in rows))
                    frames = {r["frame"] for r in rows if "frame" in r}
                    out[key + "_unique_frames"] = len(frames)
    return out


def scan(probe: Path | None = None):
    result = {"version": 1, "scope": "Project-local research roots; no unrelated personal video library", "videos": [], "raw_labels": [], "joined": [], "sync_maps": [], "ownership": [], "manifests": [], "arrays": [], "npy": [], "csv": [], "project_files": [], "other_jsonl": [], "errors": []}
    roots = [ROOT / "fire-detection/data", ROOT / "fire-detection/mod/run/firelabel", ROOT / ".board", ROOT / "FireCrackle/src-tauri/target"]
    gui_labels = ROOT / "fire-detection/mod-gui/run/guilabel"
    if gui_labels.exists():
        roots.append(gui_labels)
    for base in roots:
        if not base.exists():
            result["errors"].append({"path": relative(base), "error": "missing root"})
            continue
        for folder, dirs, files in os.walk(base):
            dirs[:] = sorted(d for d in dirs if d not in SKIP and not d.endswith("venv") and not (Path(folder) == ROOT / "FireCrackle/src-tauri/target" and d == "debug"))
            directory = Path(folder)
            if directory.parent == ROOT / "fire-detection/mod/run/firelabel" and directory.name.startswith("ownership-"):
                sidecars = sorted(directory.glob("frame-*.json"))
                record = {"path": relative(directory), "json_frames": len(sidecars), "rgb_images": sum(f.endswith("-rgb.png") for f in files), "id_images": sum(f.endswith("-ids.png") for f in files)}
                if sidecars:
                    try:
                        first = json.loads(sidecars[0].read_text(encoding="utf-8"))
                        record["schema"] = schema(first)
                        record["first_sidecar"] = sidecars[0].name
                        summaries = [json.loads(p.read_text(encoding="utf-8")) for p in sidecars]
                        record["statuses"] = dict(Counter(str(d.get("status", "unspecified")) for d in summaries))
                        record["ground_truth_flags"] = dict(Counter(str(d.get("ground_truth", "unspecified")) for d in summaries))
                        record["frames_with_issues"] = sum(bool(d.get("issues")) for d in summaries)
                        record["frames_with_known_fire_pixels"] = sum(d.get("known_fire_pixels", 0) > 0 for d in summaries)
                    except Exception as e:
                        record["error"] = str(e)
                result["ownership"].append(record)
                # PNG pixels are deliberately not opened here.
            for filename in sorted(files):
                p = directory / filename
                ext = p.suffix.lower()
                if ext not in VIDEO_EXT | {".json", ".jsonl", ".npz", ".npy", ".csv"}:
                    continue
                rec = {"path": relative(p), "bytes": p.stat().st_size}
                try:
                    if ext in VIDEO_EXT:
                        rec["role"] = "original" if p.parent == ROOT / "fire-detection/data/video" else "derived_or_fixture"
                        if p.is_symlink():
                            rec["symlink_target"] = str(p.resolve())
                        if probe and rec["role"] == "original":
                            command = [str(probe), "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate,avg_frame_rate,nb_frames:format=duration", "-of", "json", str(p)]
                            rec["media"] = json.loads(subprocess.check_output(command, timeout=60))
                        result["videos"].append(rec)
                    elif ext == ".npz":
                        rec["arrays"] = npz_headers(p)
                        result["arrays"].append(rec)
                    elif ext == ".npy":
                        with p.open("rb") as f:
                            rec["array"] = npy_header(f)
                        result["npy"].append(rec)
                    elif ext == ".jsonl":
                        if p.parent == gui_labels:
                            rec["role"] = "gui_renderer_screen_state_and_geometry_not_pixel_mask"
                        raw = filename.startswith("labels-") or filename.endswith("raw-labels.jsonl")
                        joined = p.parent == ROOT / "fire-detection/data/joined" and not raw or filename.endswith(".joined.jsonl")
                        preview = inspect_jsonl(p)
                        keys = set(preview["observed_schemas"][0]) if preview["observed_schemas"] else set()
                        joined = joined or {"n", "f", "tick_ok", "label"} <= keys
                        raw = raw or {"f", "tick", "fires", "w", "h"} <= keys
                        sync = {"n", "f", "tick"} <= keys and not joined and "label" not in keys and filename == "sync.jsonl"
                        rec.update(inspect_jsonl(p, True) if raw or joined or sync else preview)
                        result["raw_labels" if raw else "joined" if joined else "sync_maps" if sync else "other_jsonl"].append(rec)
                    elif ext == ".csv" and p.parent == ROOT / "fire-detection/data/joined":
                        with p.open(encoding="utf-8-sig", newline="") as f:
                            rec["columns"] = next(csv.reader(f), [])
                        result["csv"].append(rec)
                    elif ext == ".json" and (filename in {"manifest.json", "freeze.json", "review.json", "dataset.json", "train-manifest.json", "survival-review.json", "metadata.json", "meta.json", "cases.json", "samples.json", "targets.json", "audit-cases.json", "inventory.json", "selected.json", "candidates.json", "examples.json", "extra-eligible.json"} or filename.endswith(".meta.json")) and ".firecrackle" not in str(p):
                        rec.update(inspect_manifest(p))
                        result["manifests"].append(rec)
                    elif ".firecrackle" in str(p) and ext == ".json":
                        rec["schema"] = schema(json.loads(p.read_text(encoding="utf-8-sig")))
                        result["project_files"].append(rec)
                except Exception as e:
                    result["errors"].append({**rec, "error": str(e)})
    for key, rows in result.items():
        if isinstance(rows, list):
            rows.sort(key=lambda r: r.get("path", ""))
    return result


def compact(value):
    return json.dumps(value, ensure_ascii=True, separators=(",", ":")).replace("|", "\\|")


def serialize_inventory(data):
    """One file record per line keeps inventory diffs compact as the register grows."""
    fields = []
    for key, value in data.items():
        if isinstance(value, list):
            body = ",\n".join("    " + json.dumps(row, ensure_ascii=True, separators=(",", ":")) for row in value)
            fields.append("  " + json.dumps(key) + ": [\n" + body + "\n  ]")
        else:
            fields.append("  " + json.dumps(key) + ": " + json.dumps(value, ensure_ascii=True))
    return "{\n" + ",\n".join(fields) + "\n}\n"


def appendix(data):
    lines = [MARKER, "", "## Complete discovered inventory", "", "Generated by the inventory command. Counts are physical local files, not independent samples. Full field/type trees, exact paths, split counts and array dimensions are in [TRAINING_DATA_INVENTORY.json](TRAINING_DATA_INVENTORY.json).", ""]
    lines += ["### Original video measurements", "", "| Original file | Seconds | Resolution | Average FPS |", "|---|---:|---|---|"]
    for row in data["videos"]:
        if row["role"] != "original":
            continue
        media = row.get("media", {})
        stream = media.get("streams", [{}])[0]
        lines.append(f"| `{row['path']}` | {media.get('format', {}).get('duration', 'unmeasured')} | {stream.get('width', '?')} x {stream.get('height', '?')} | {stream.get('avg_frame_rate', '?')} |")
    lines += [""]
    for key, label in [("raw_labels", "Raw capture logs"), ("joined", "Synchronized frame labels"), ("sync_maps", "Synchronization maps (no per-frame label object)"), ("ownership", "Renderer ownership sessions"), ("manifests", "Dataset manifests and frozen/reviewed pools"), ("arrays", "NPZ datasets and feature/prediction caches"), ("csv", "Legacy joined feature tables"), ("project_files", "Manual/application project files"), ("other_jsonl", "Other frame records and predictions (not automatically truth)")]:
        lines += [f"### {label} ({len(data[key])})", "", "| Local path | Contents / observed schema |", "|---|---|"]
        for row in data[key]:
            if key == "arrays":
                detail = "; ".join(f"{k}: {v['shape']} {v['dtype']}" for k, v in row["arrays"].items())
            elif key == "manifests":
                counts = {k: v for k, v in row.items() if k.endswith("_count") or k.endswith("_splits")}
                sample = row.get("samples_schema", row.get("cases_schema", row.get("records_schema", row.get("schema", {}))))
                detail = compact(counts) + "; fields: " + ", ".join(sample if isinstance(sample, dict) else [])
            elif key == "ownership":
                detail = f"{row['json_frames']} JSON sidecars; {row['rgb_images']} RGB / {row['id_images']} ID PNGs; {row.get('frames_with_issues', '?')} frames with issues; {row.get('frames_with_known_fire_pixels', '?')} with known fire pixels; schema in inventory"
            elif key == "csv":
                detail = ", ".join(row["columns"])
            else:
                shapes = row.get("observed_schemas", [row.get("schema", {})])
                fields = sorted({k for s in shapes if isinstance(s, dict) for k in s})
                detail = f"{row.get('lines', 'sampled schema only')} records; " + ", ".join(fields)
            lines.append(f"| `{row['path']}` | {detail} |")
        lines += [""]
    lines += ["### Standalone NPY arrays (grouped by directory and schema)", "", "Exact individual file paths and headers are in the JSON inventory. These include raw crop caches, reference sprites and predictions; grouping does not imply all are training examples.", "", "| Directory | Files | Shape / dtype |", "|---|---:|---|"]
    grouped = Counter((str(Path(r["path"]).parent).replace("\\", "/"), compact(r["array"])) for r in data["npy"])
    for (directory, header), count in sorted(grouped.items()):
        lines.append(f"| `{directory}` | {count} | {header} |")
    lines += [""]
    lines += ["### Videos outside the original-recording folder", "", "Derived clips, fixtures and copies are not additional independent recordings. Group them with their source; if provenance is unresolved, audit it before admitting the video as an independent source.", ""]
    lines += [f"- `{r['path']}`" for r in data["videos"] if r["role"] != "original"]
    lines += ["", "### Inspection errors", "", "Errors must be resolved or explicitly excluded before training.", ""]
    lines += [f"- `{r['path']}`: {r['error']}" for r in data["errors"]] or ["- None."]
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--check", action="store_true", help="Fail if the stored inventory differs from local files")
    parser.add_argument("--ffprobe", type=Path, default=ROOT / "FireCrackle/src-tauri/runtime/ffprobe.exe")
    args = parser.parse_args()
    data = scan(args.ffprobe if args.ffprobe.exists() else None)
    serialized = serialize_inventory(data)
    if args.check and (not OUT.exists() or OUT.read_text(encoding="utf-8") != serialized):
        raise SystemExit("Training inventory changed. Run --write, review and commit the updated catalogue.")
    if args.write:
        OUT.write_text(serialized, encoding="utf-8")
        prose = DOC.read_text(encoding="utf-8").split(MARKER)[0].rstrip()
        DOC.write_text(prose + "\n\n" + appendix(data), encoding="utf-8")
    print(json.dumps({k: len(v) for k, v in data.items() if isinstance(v, list)}, indent=2))


if __name__ == "__main__":
    main()
