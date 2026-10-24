"""Benchmark adapter for MCV / MinecraftCV (rubyswolf/mcv @ ef4bec1).

Runs the app's own Python-backend pose solve (`run_pose_solve`, copied verbatim into mcv_solver_verbatim.py) on
each case's clicks, exactly as the app calls it: no `initial_vfov_deg` (the app never sends one -> 70 deg start),
focal scanned over [0.3, 3] x f(70 deg) then golden-section refined, RANSAC-EPnP + iterative + LM pose per focal.

Input mapping: each click becomes one structure vertex with known world (x, y, z), attached to a zero-length line
whose both endpoints are the click (vertex image point = mean of its endpoints = the click). Zero-length lines are
dropped by the backend's line-correspondence builder (< 1 px), so the solve is pure point PnP; no edge information
the benchmark does not give is invented.

Pixel convention: the tool's camera matrix puts the principal point at ((w-1)/2, (h-1)/2), i.e. OpenCV's
pixel-centre convention (pixel i's centre at i). The benchmark's (0,0) is the frame corner, centre (w/2, h/2).
So tool_px = bench_px - 0.5 on input and bench_px = tool_px + 0.5 on output, for clicks and held-out alike.

Usage: python -I run_mcv.py CASES.json OUT.json [--limit N]
"""
import json
import math
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cv2  # noqa: E402
import numpy as np  # noqa: E402
import mcv_solver_verbatim as mcv  # noqa: E402

HALF = 0.5

# Instrumentation only (forwards every call unchanged): count RANSAC failures, which is where the web backend
# (opencv.js) differs from the Python backend (web falls back to a plain SOLVEPNP_ITERATIVE solve).
_ransac = cv2.solvePnPRansac
_stats = {"calls": 0, "fails": 0}


def _counting_ransac(*a, **k):
    _stats["calls"] += 1
    out = _ransac(*a, **k)
    if not out[0]:
        _stats["fails"] += 1
    return out


cv2.solvePnPRansac = _counting_ransac


def solve_pose_for_focal_web(object_pts, image_pts, line_corr, width, height, focal):
    """--web: line-for-line transliteration of the WEB backend's per-focal solve, `evaluatePoseForFocalWeb` in
    src/app/mcvClient.ts (lines 1086-1279), with opencv-python standing in for the repo's opencv.js (4.14.0-pre).
    It differs from the Python backend's `_solve_pose_for_focal` only in that a failed (or throwing) RANSAC falls
    back to a plain SOLVEPNP_ITERATIVE solve instead of returning an infinite cost, and it has no line terms.
    The focal search around it (run_pose_solve vs runWebPoseSolve) is identical in both backends, so the verbatim
    run_pose_solve drives it. Returns the Python backend's tuple shape."""
    k = mcv._camera_matrix_from_focal(focal, width, height)
    dist = np.zeros((4, 1), dtype=np.float64)
    n = object_pts.shape[0]
    inf = (float("inf"), np.zeros((3, 1)), np.zeros((3, 1)), np.array([], dtype=np.int32), float("inf"), float("inf"))
    try:
        ok, rvec, tvec, inliers = cv2.solvePnPRansac(object_pts, image_pts, k, dist, useExtrinsicGuess=False,
                                                     iterationsCount=800, reprojectionError=4.0, confidence=0.999,
                                                     flags=cv2.SOLVEPNP_EPNP)
    except cv2.error:
        ok, inliers = False, None
    if not ok:
        inliers = None
        try:
            ok, rvec, tvec = cv2.solvePnP(object_pts, image_pts, k, dist, useExtrinsicGuess=False,
                                          flags=cv2.SOLVEPNP_ITERATIVE)
        except cv2.error:
            ok = False
        if not ok:
            return inf
    idx = [] if inliers is None else sorted(set(int(i) for i in np.asarray(inliers).reshape(-1) if 0 <= int(i) < n))
    if len(idx) < 4:
        idx = list(range(n))
    idx = np.array(idx, dtype=np.int32)
    obj_in, img_in = object_pts[idx], image_pts[idx]
    try:
        ok_refine, rvec, tvec = cv2.solvePnP(obj_in, img_in, k, dist, rvec=rvec, tvec=tvec, useExtrinsicGuess=True,
                                             flags=cv2.SOLVEPNP_ITERATIVE)
        if not ok_refine:
            return inf
        try:
            rvec, tvec = cv2.solvePnPRefineLM(obj_in, img_in, k, dist, rvec, tvec)
        except cv2.error:
            pass
    except cv2.error:
        return inf
    proj, _ = cv2.projectPoints(object_pts, rvec, tvec, k, dist)
    err = np.linalg.norm(proj.reshape(-1, 2) - image_pts, axis=1)
    delta = 5.0
    huber = np.where(err <= delta, 0.5 * err * err, delta * (err - 0.5 * delta))
    cost = float(np.mean(huber) + (n - len(idx)) * delta * delta)
    rmse = float(np.sqrt(np.mean(err * err)))
    return cost, rvec, tvec, idx, rmse, 0.0


def camera_from_pose(rvec, tvec, yaw, pitch, cam_pos, vfov):
    """Benchmark camera (eye, yaw/pitch/roll, vertical FOV). Yaw/pitch are the tool's own; roll (which the tool
    does not report) is what is left of the tool's rotation after them, in fire_core::camera's convention."""
    R, _ = cv2.Rodrigues(np.asarray(rvec, dtype=np.float64).reshape(3, 1))
    Rv = np.diag([1.0, -1.0, -1.0]) @ R  # OpenCV cam (x right, y down, z fwd) -> view (x right, y up, -z fwd)
    a = math.radians(yaw + 180.0)
    sy, cy = math.sin(a), math.cos(a)
    Ryaw = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    p = math.radians(pitch)
    sp, cp = math.sin(p), math.cos(p)
    Rpitch = np.array([[1, 0, 0], [0, cp, -sp], [0, sp, cp]])
    M = Rv @ (Rpitch @ Ryaw).T
    roll = math.degrees(math.atan2(M[1, 0], M[0, 0]))
    resid = abs(M[2, 2] - 1.0)
    return {"x": cam_pos["x"], "y": cam_pos["y"], "z": cam_pos["z"], "yaw": yaw, "pitch": pitch, "roll": roll,
            "fov": vfov}, resid


def solve_case(case):
    w, h = int(case["w"]), int(case["h"])
    lines, vertices = [], []
    for i, c in enumerate(case["clicks"]):
        x, y = c["px"][0] - HALF, c["px"][1] - HALF
        lines.append({"from": {"x": x, "y": y, "from": [i], "to": []},
                      "to": {"x": x, "y": y, "from": [], "to": [i]}, "axis": "x"})
        wx, wy, wz = c["world"]
        vertices.append({"from": [i], "to": [i], "x": float(wx), "y": float(wy), "z": float(wz)})
    args = {"width": w, "height": h, "lines": lines, "vertices": vertices}

    before = dict(_stats)
    t0 = time.perf_counter()
    res = mcv.run_pose_solve(args)
    ms = (time.perf_counter() - t0) * 1000.0
    fails = _stats["fails"] - before["fails"]
    calls = _stats["calls"] - before["calls"]

    def project(worlds):
        if not worlds:
            return []
        pts = mcv.project_world_points({
            "points": [{"x": float(p[0]), "y": float(p[1]), "z": float(p[2])} for p in worlds],
            "width": w, "height": h, "focal_px": res["optimized_focal_px"], "rvec": res["rvec"], "tvec": res["tvec"],
        })["points"]
        return [[q["x"] + HALF, q["y"] + HALF] for q in pts]

    clicks_px = project([c["world"] for c in case["clicks"]])
    heldout_px = project([c["world"] for c in case["heldout"]])
    cam, resid = camera_from_pose(res["rvec"], res["tvec"], res["rotation"]["yaw"], res["rotation"]["pitch"],
                                  res["camera_position"], res["optimized_vfov_deg"])

    f = res["optimized_focal_px"]
    f_init = res["initial_focal_px"]
    notes = [f"inliers {res['inlier_count']}/{res['point_count']}", f"f {f:.2f}px"]
    if fails:
        notes.append(f"ransac failed {fails}/{calls} focal tries")
    if f <= f_init * 0.30 * 1.001 or f >= f_init * 3.0 * 0.999:
        notes.append("focal at search bound")
    if resid > 1e-6:
        notes.append(f"roll extraction residual {resid:.2e}")
    # Pose with points behind the camera: the tool's projectPoints still returns pixels (it does not clip).
    R, _ = cv2.Rodrigues(np.asarray(res["rvec"], dtype=np.float64).reshape(3, 1))
    t = np.asarray(res["tvec"], dtype=np.float64).reshape(3)
    behind = sum(1 for c in case["heldout"] if (R @ np.asarray(c["world"], float) + t)[2] <= 0)
    if behind:
        notes.append(f"{behind} heldout behind camera")
    return {"id": case["id"], "ok": True, "ms": ms, "camera": cam, "clicks_px": clicks_px, "heldout_px": heldout_px,
            "note": "; ".join(notes)}


def main():
    src, out = sys.argv[1], sys.argv[2]
    limit = None
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])
    cases = json.loads(Path(src).read_text(encoding="utf-8"))["cases"]
    if limit:
        cases = cases[:limit]
    web = "--web" in sys.argv
    if web:
        mcv._solve_pose_for_focal = solve_pose_for_focal_web
    answers = []
    t_all = time.perf_counter()
    for i, case in enumerate(cases):
        try:
            ans = solve_case(case)
        except Exception as exc:  # the tool's own refusals (e.g. <4 points, no PnP solution) land here
            ans = {"id": case["id"], "ok": False, "ms": 0.0, "camera": None, "clicks_px": [], "heldout_px": [],
                   "note": f"{type(exc).__name__}: {exc}"}
        answers.append(ans)
        if (i + 1) % 50 == 0:
            print(f"{i + 1}/{len(cases)} {time.perf_counter() - t_all:.1f}s", flush=True)
    if web:
        doc = {"solver": "mcv-web", "version": "rubyswolf/mcv@ef4bec1 web backend flow (evaluatePoseForFocalWeb, "
               "transliterated) on opencv-python " + cv2.__version__, "answers": answers}
    else:
        doc = {"solver": "mcv", "version": "rubyswolf/mcv@ef4bec1 python backend run_pose_solve (opencv-python "
               + cv2.__version__ + ")", "answers": answers}
    Path(out).write_text(json.dumps(doc), encoding="utf-8")
    print(f"done {len(answers)} cases in {time.perf_counter() - t_all:.1f}s; ransac calls {_stats['calls']} "
          f"fails {_stats['fails']}")


if __name__ == "__main__":
    main()
