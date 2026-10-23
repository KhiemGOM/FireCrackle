//! Minecraft's camera and a solver for it (perspective reversal): from world points and where they appear on screen,
//! the eye position, yaw, pitch, roll and vertical FOV. View transform is the game's (`GameRenderer`: pitch about x,
//! then yaw + 180 about y; roll first, covering view bobbing / hurt tilt); projection is `overlay::project`.

use crate::fire_model::block_candidates;
use crate::overlay::project as project_view;

/// Eye position (blocks), yaw / pitch / roll / vertical FOV (degrees), Minecraft conventions: yaw 0 looks +z,
/// yaw 90 looks −x, positive pitch looks down.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Camera {
    pub pos: [f64; 3],
    pub yaw: f64,
    pub pitch: f64,
    pub roll: f64,
    pub fov: f64,
}

impl Camera {
    /// World point to view space (x right, y up, looking down −z).
    pub fn to_view(self, p: [f64; 3]) -> [f64; 3] {
        let d = [p[0] - self.pos[0], p[1] - self.pos[1], p[2] - self.pos[2]];
        let (sy, cy) = (self.yaw + 180.0).to_radians().sin_cos();
        let (x1, y1, z1) = (d[0] * cy + d[2] * sy, d[1], -d[0] * sy + d[2] * cy);
        let (sp, cp) = self.pitch.to_radians().sin_cos();
        let (y2, z2) = (y1 * cp - z1 * sp, y1 * sp + z1 * cp);
        let (sr, cr) = self.roll.to_radians().sin_cos();
        [x1 * cr - y2 * sr, x1 * sr + y2 * cr, z2]
    }

    /// View direction to world direction (the inverse rotation).
    pub fn view_dir_to_world(self, v: [f64; 3]) -> [f64; 3] {
        let (sr, cr) = (-self.roll).to_radians().sin_cos();
        let (x1, y2) = (v[0] * cr - v[1] * sr, v[0] * sr + v[1] * cr);
        let (sp, cp) = (-self.pitch).to_radians().sin_cos();
        let (y1, z1) = (y2 * cp - v[2] * sp, y2 * sp + v[2] * cp);
        let (sy, cy) = (-(self.yaw + 180.0)).to_radians().sin_cos();
        [x1 * cy + z1 * sy, y1, -x1 * sy + z1 * cy]
    }

    /// Pixel (x right, y down) of a world point on a `w`×`h` frame; None behind the camera.
    pub fn project(&self, p: [f64; 3], w: usize, h: usize) -> Option<(f64, f64)> {
        project_view(self.to_view(p), self.fov, w, h)
    }

    /// The same rotation with pitch in [−90, 90] and angles in (−180, 180].
    fn normalized(mut self) -> Camera {
        let wrap = |a: f64| {
            let r = (a + 180.0).rem_euclid(360.0) - 180.0;
            if r == -180.0 {
                180.0
            } else {
                r
            }
        };
        self.pitch = wrap(self.pitch);
        if self.pitch.abs() > 90.0 {
            self.pitch = self.pitch.signum() * 180.0 - self.pitch;
            self.yaw += 180.0;
            self.roll += 180.0;
        }
        self.yaw = wrap(self.yaw);
        self.roll = wrap(self.roll);
        self
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Fit {
    pub camera: Camera,
    /// Root-mean-square pixel distance between projected and observed points.
    pub rms: f64,
    pub points: usize,
    /// All points lie on one plane, so FOV and distance cannot be separated: FOV was held at its starting value.
    pub fov_fixed: bool,
    /// Logged quads left out because they did not fit the camera every other quad agrees on.
    pub dropped_quads: usize,
}

const BEHIND: f64 = 1e4; // residual for a point that falls behind the camera during the search

fn residuals(points: &[([f64; 3], [f64; 2])], w: usize, h: usize, c: &Camera, out: &mut Vec<f64>) {
    out.clear();
    for (p, px) in points {
        match c.project(*p, w, h) {
            Some((x, y)) => {
                out.push(x - px[0]);
                out.push(y - px[1]);
            }
            None => {
                out.push(BEHIND);
                out.push(BEHIND);
            }
        }
    }
}

fn with(c: &Camera, k: usize, v: f64) -> Camera {
    let mut c = *c;
    match k {
        0..=2 => c.pos[k] = v,
        3 => c.yaw = v,
        4 => c.pitch = v,
        5 => c.roll = v,
        _ => c.fov = v,
    }
    c
}

fn get(c: &Camera, k: usize) -> f64 {
    match k {
        0..=2 => c.pos[k],
        3 => c.yaw,
        4 => c.pitch,
        5 => c.roll,
        _ => c.fov,
    }
}

fn coplanar(points: &[([f64; 3], [f64; 2])]) -> bool {
    let p: Vec<[f64; 3]> = points.iter().map(|q| q.0).collect();
    let sub = |a: [f64; 3], b: [f64; 3]| [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    let cross = |a: [f64; 3], b: [f64; 3]| {
        [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
        ]
    };
    let dot = |a: [f64; 3], b: [f64; 3]| a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    for i in 1..p.len() {
        for j in i + 1..p.len() {
            let n = cross(sub(p[i], p[0]), sub(p[j], p[0]));
            let len = dot(n, n).sqrt();
            if len > 1e-6 {
                return p.iter().all(|&q| (dot(n, sub(q, p[0])) / len).abs() < 1e-6);
            }
        }
    }
    true
}

/// Solves the n×n system `a x = b` (Gaussian elimination, partial pivoting); None when singular.
fn solve_linear(mut a: Vec<f64>, mut b: Vec<f64>, n: usize) -> Option<Vec<f64>> {
    for col in 0..n {
        let piv =
            (col..n).max_by(|&i, &j| a[i * n + col].abs().total_cmp(&a[j * n + col].abs()))?;
        if a[piv * n + col].abs() < 1e-300 {
            return None;
        }
        for k in 0..n {
            a.swap(col * n + k, piv * n + k);
        }
        b.swap(col, piv);
        for r in col + 1..n {
            let f = a[r * n + col] / a[col * n + col];
            for k in col..n {
                a[r * n + k] -= f * a[col * n + k];
            }
            b[r] -= f * b[col];
        }
    }
    let mut x = vec![0.0; n];
    for r in (0..n).rev() {
        let s: f64 = (r + 1..n).map(|k| a[r * n + k] * x[k]).sum();
        x[r] = (b[r] - s) / a[r * n + r];
    }
    Some(x)
}

/// Extra residuals appended after the point residuals (a prior); `NO_PRIOR` for none.
type Prior<'a> = &'a dyn Fn(&Camera, &mut Vec<f64>);
const NO_PRIOR: Prior = &|_, _| {};

fn levenberg_marquardt(
    points: &[([f64; 3], [f64; 2])],
    w: usize,
    h: usize,
    start: &Camera,
    params: &[usize],
    iterations: usize,
) -> (Camera, f64) {
    levenberg_marquardt_with(points, w, h, start, params, iterations, NO_PRIOR)
}

fn levenberg_marquardt_with(
    points: &[([f64; 3], [f64; 2])],
    w: usize,
    h: usize,
    start: &Camera,
    params: &[usize],
    iterations: usize,
    prior: Prior,
) -> (Camera, f64) {
    let residuals =
        |points: &[([f64; 3], [f64; 2])], w: usize, h: usize, c: &Camera, out: &mut Vec<f64>| {
            residuals(points, w, h, c, out);
            prior(c, out);
        };
    let n = params.len();
    let mut c = *start;
    let mut r = Vec::new();
    residuals(points, w, h, &c, &mut r);
    let mut cost: f64 = r.iter().map(|v| v * v).sum();
    let mut lambda = 1e-3;
    let mut rr = Vec::new();
    for _ in 0..iterations {
        // numeric Jacobian
        let mut jac = vec![0.0; r.len() * n];
        for (j, &k) in params.iter().enumerate() {
            let step = if k < 3 { 1e-6 } else { 1e-5 };
            residuals(points, w, h, &with(&c, k, get(&c, k) + step), &mut rr);
            for i in 0..r.len() {
                jac[i * n + j] = (rr[i] - r[i]) / step;
            }
        }
        let mut jtj = vec![0.0; n * n];
        let mut jtr = vec![0.0; n];
        for i in 0..r.len() {
            for a in 0..n {
                jtr[a] += jac[i * n + a] * r[i];
                for b in 0..n {
                    jtj[a * n + b] += jac[i * n + a] * jac[i * n + b];
                }
            }
        }
        let mut improved = false;
        for _ in 0..12 {
            let mut m = jtj.clone();
            for a in 0..n {
                m[a * n + a] += lambda * jtj[a * n + a].max(1e-12);
            }
            let Some(delta) = solve_linear(m, jtr.iter().map(|v| -v).collect(), n) else {
                break;
            };
            let mut trial = c;
            for (j, &k) in params.iter().enumerate() {
                trial = with(&trial, k, get(&trial, k) + delta[j]);
            }
            if !(1.0..179.0).contains(&trial.fov) {
                lambda *= 10.0;
                continue;
            }
            residuals(points, w, h, &trial, &mut rr);
            let tc: f64 = rr.iter().map(|v| v * v).sum();
            if tc < cost {
                let done = cost - tc < 1e-14 * cost.max(1e-30);
                c = trial;
                cost = tc;
                std::mem::swap(&mut r, &mut rr);
                lambda = (lambda * 0.3).max(1e-12);
                improved = !done;
                break;
            }
            lambda *= 10.0;
        }
        if !improved {
            break;
        }
    }
    (c, cost)
}

/// Fits the camera to `points` (world point, observed pixel) from `start`. FOV is fitted when `fit_fov` and the
/// points do not all lie on one plane; otherwise it stays at `start.fov`. None without points.
pub fn fit(
    points: &[([f64; 3], [f64; 2])],
    w: usize,
    h: usize,
    start: &Camera,
    fit_fov: bool,
) -> Option<Fit> {
    if points.is_empty() {
        return None;
    }
    let fov_fixed = fit_fov && coplanar(points);
    let params: &[usize] = if fit_fov && !fov_fixed {
        &[0, 1, 2, 3, 4, 5, 6]
    } else {
        &[0, 1, 2, 3, 4, 5]
    };
    let (c, cost) = levenberg_marquardt(points, w, h, start, params, 200);
    Some(Fit {
        camera: c.normalized(),
        rms: (cost / points.len() as f64).sqrt(),
        points: points.len(),
        fov_fixed,
        dropped_quads: 0,
    })
}

/// One drawn fire quad as the label mod logs it: screen corners (framebuffer pixels) and their sprite UVs.
#[derive(Clone, Debug, PartialEq)]
pub struct LoggedQuad {
    pub corners: [[f64; 2]; 4],
    pub uv: [[f64; 2]; 4],
}

/// A labelled fire block: position, logged distance from the camera to its centre, drawn quads.
#[derive(Clone, Debug, PartialEq)]
pub struct LoggedBlock {
    pub pos: [i32; 3],
    pub dist: f64,
    pub quads: Vec<LoggedQuad>,
}

/// The quads of one logged fire source (`"quads": [{"c": [8 numbers], "uv": [8 numbers]}, ...]`); malformed ones skipped.
pub fn logged_quads(source: &crate::json::Value) -> Vec<LoggedQuad> {
    use crate::json::Value;
    let mut out = Vec::new();
    for q in source.get("quads").and_then(Value::arr).unwrap_or(&[]) {
        let (Some(c), Some(uv)) = (
            q.get("c").and_then(Value::arr),
            q.get("uv").and_then(Value::arr),
        ) else {
            continue;
        };
        if c.len() != 8 || uv.len() != 8 {
            continue;
        }
        let n = |a: &[Value], i: usize| a[i].num().unwrap_or(f64::NAN);
        let mut lq = LoggedQuad {
            corners: [[0.0; 2]; 4],
            uv: [[0.0; 2]; 4],
        };
        for i in 0..4 {
            lq.corners[i] = [n(c, 2 * i), n(c, 2 * i + 1)];
            lq.uv[i] = [n(uv, 2 * i), n(uv, 2 * i + 1)];
        }
        if lq.corners.iter().flatten().all(|v| v.is_finite()) {
            out.push(lq);
        }
    }
    out
}

/// The fire blocks of one label row (`label.fires` with `src: "block"`) that have drawn quads.
pub fn logged_blocks(label: &crate::json::Value) -> Vec<LoggedBlock> {
    use crate::json::Value;
    label
        .get("fires")
        .and_then(Value::arr)
        .unwrap_or(&[])
        .iter()
        .filter(|s| s.get("src").and_then(Value::str) == Some("block"))
        .filter_map(|s| {
            let p = s.get("pos")?.arr()?;
            Some(LoggedBlock {
                pos: [p[0].num()? as i32, p[1].num()? as i32, p[2].num()? as i32],
                dist: s.get("dist")?.num()?,
                quads: logged_quads(s),
            })
        })
        .filter(|b| !b.quads.is_empty())
        .collect()
}

/// World points of a model quad in the logged quad's corner order, matched by UV; None if the UVs differ.
#[allow(clippy::needless_range_loop)] // corners are indexed in step across model, log and output
fn pair(model: &crate::fire_model::ModelQuad, q: &LoggedQuad) -> Option<[[f64; 3]; 4]> {
    let key = |t: [f64; 2]| ((t[0] > 0.5) as u8, (t[1] > 0.5) as u8);
    let mut out = [[0.0; 3]; 4];
    for i in 0..4 {
        let k = (0..4).find(|&j| key(model.uv[j]) == key(q.uv[i]))?;
        out[i] = model.corners[k];
    }
    // every model corner used once
    let mut used = [false; 4];
    for i in 0..4 {
        let k = (0..4).find(|&j| key(model.uv[j]) == key(q.uv[i]))?;
        if used[k] {
            return None;
        }
        used[k] = true;
    }
    Some(out)
}

/// The UV-compatible candidate that projects closest to a logged quad under `c`: (squared error, world corners).
#[allow(clippy::needless_range_loop)] // corners are indexed in step across model, log and output
fn best_candidate(
    q: &LoggedQuad,
    cs: &[crate::fire_model::ModelQuad],
    c: &Camera,
    w: usize,
    h: usize,
) -> Option<(f64, [[f64; 3]; 4])> {
    let mut best: Option<(f64, [[f64; 3]; 4])> = None;
    for m in cs {
        let Some(world) = pair(m, q) else { continue };
        let mut e = 0.0;
        for i in 0..4 {
            e += match c.project(world[i], w, h) {
                Some((x, y)) => (x - q.corners[i][0]).powi(2) + (y - q.corners[i][1]).powi(2),
                None => BEHIND * BEHIND,
            };
        }
        if best.as_ref().is_none_or(|b| e < b.0) {
            best = Some((e, world));
        }
    }
    best
}

/// For every logged quad, its best candidate's corners paired with the logged pixels.
fn assign(
    blocks: &[LoggedBlock],
    cands: &[Vec<crate::fire_model::ModelQuad>],
    c: &Camera,
    w: usize,
    h: usize,
) -> Vec<([f64; 3], [f64; 2])> {
    let mut points = Vec::new();
    for (b, cs) in blocks.iter().zip(cands) {
        for q in &b.quads {
            if let Some((_, world)) = best_candidate(q, cs, c, w, h) {
                points.extend((0..4).map(|i| (world[i], q.corners[i])));
            }
        }
    }
    points
}

/// RMS pixel distance between every logged quad corner and the matching model corner (nearest model quad per logged
/// quad, as in `fit_label_frame`) under `c`: how well a camera reproduces what the game drew. None without quads.
pub fn corner_rms(blocks: &[LoggedBlock], c: &Camera, w: usize, h: usize) -> Option<f64> {
    let cands: Vec<_> = blocks.iter().map(|b| block_candidates(b.pos)).collect();
    let points = assign(blocks, &cands, c, w, h);
    if points.is_empty() {
        return None;
    }
    let mut r = Vec::new();
    residuals(&points, w, h, c, &mut r);
    Some((r.iter().map(|v| v * v).sum::<f64>() / points.len() as f64).sqrt())
}

/// Fit from `c` with corner assignment redone between rounds.
fn refit(
    blocks: &[LoggedBlock],
    cands: &[Vec<crate::fire_model::ModelQuad>],
    c: &Camera,
    w: usize,
    h: usize,
) -> Option<Fit> {
    let mut c = *c;
    let mut f = None;
    for _ in 0..3 {
        let r = fit(&assign(blocks, cands, &c, w, h), w, h, &c, true)?;
        c = r.camera;
        f = Some(r);
    }
    f
}

/// Starting cameras over yaw (15° steps), pitch (−75..75°) and FOV (70, 110, 125: the slider and its sprint/effect
/// multipliers), each placed so the world point `anchor` lies on the ray through pixel `anchor_px` at distance
/// `dist(fov)`.
fn start_grid(
    anchor: [f64; 3],
    anchor_px: [f64; 2],
    dist: impl Fn(f64) -> f64,
    w: usize,
    h: usize,
) -> Vec<Camera> {
    let mut out = Vec::new();
    for fov in [70.0f64, 110.0, 125.0] {
        let t = (fov.to_radians() / 2.0).tan();
        let ray = [
            (anchor_px[0] / w as f64 * 2.0 - 1.0) * t * w as f64 / h as f64,
            (1.0 - anchor_px[1] / h as f64 * 2.0) * t,
            -1.0,
        ];
        let len = (ray[0] * ray[0] + ray[1] * ray[1] + 1.0).sqrt();
        let d = dist(fov);
        for yi in 0..24 {
            for pi in 0..11 {
                let mut c = Camera {
                    pos: [0.0; 3],
                    yaw: -180.0 + 15.0 * yi as f64,
                    pitch: -75.0 + 15.0 * pi as f64,
                    roll: 0.0,
                    fov,
                };
                let r = c.view_dir_to_world([ray[0] / len, ray[1] / len, ray[2] / len]);
                c.pos = [
                    anchor[0] - d * r[0],
                    anchor[1] - d * r[1],
                    anchor[2] - d * r[2],
                ];
                out.push(c);
            }
        }
    }
    out
}

/// A short fit from every start, on all cores; results sorted by cost.
fn coarse(
    starts: Vec<Camera>,
    short_fit: impl Fn(&Camera) -> (Camera, f64) + Sync,
) -> Vec<(f64, Camera)> {
    let mut tried: Vec<(f64, Camera)> = parallel_map(starts.len(), |i| {
        let (c, cost) = short_fit(&starts[i]);
        (cost, c)
    });
    tried.sort_by(|a, b| a.0.total_cmp(&b.0));
    tried
}

/// `f(0..n)` on all cores, in order. On wasm32 (no threads in the browser module) it runs in order on one.
pub(crate) fn parallel_map<T: Send, F: Fn(usize) -> T + Sync>(n: usize, f: F) -> Vec<T> {
    if cfg!(target_arch = "wasm32") || n < 2 {
        return (0..n).map(f).collect();
    }
    let threads = std::thread::available_parallelism()
        .map_or(1, |t| t.get())
        .min(n);
    let chunk = n.div_ceil(threads);
    std::thread::scope(|s| {
        let f = &f;
        let handles: Vec<_> = (0..n)
            .step_by(chunk)
            .map(|start| {
                s.spawn(move || (start..(start + chunk).min(n)).map(f).collect::<Vec<T>>())
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|h| h.join().expect("worker"))
            .collect()
    })
}

/// Perspective reversal from any world points and where they appear (e.g. block corners clicked on a frame), with no
/// starting guess: the start grid is anchored on the points' centroid at the distance their spread implies.
/// Needs at least 4 points; FOV is held (and flagged) when they all lie on one plane.
pub fn solve(points: &[([f64; 3], [f64; 2])], w: usize, h: usize) -> Option<Fit> {
    if points.len() < 4 {
        return None;
    }
    let n = points.len() as f64;
    let cw = points.iter().fold([0.0; 3], |a, p| {
        [a[0] + p.0[0] / n, a[1] + p.0[1] / n, a[2] + p.0[2] / n]
    });
    let cp = points
        .iter()
        .fold([0.0; 2], |a, p| [a[0] + p.1[0] / n, a[1] + p.1[1] / n]);
    let sw = (points
        .iter()
        .map(|p| (p.0[0] - cw[0]).powi(2) + (p.0[1] - cw[1]).powi(2) + (p.0[2] - cw[2]).powi(2))
        .sum::<f64>()
        / n)
        .sqrt();
    let sp = (points
        .iter()
        .map(|p| (p.1[0] - cp[0]).powi(2) + (p.1[1] - cp[1]).powi(2))
        .sum::<f64>()
        / n)
        .sqrt()
        .max(1.0);
    let dist = |fov: f64| (sw * (h as f64 / 2.0) / (fov.to_radians() / 2.0).tan() / sp).max(0.5);
    let fov_free = !coplanar(points);
    let params: &[usize] = if fov_free {
        &[0, 1, 2, 3, 4, 5, 6]
    } else {
        &[0, 1, 2, 3, 4, 5]
    };
    let tried = coarse(start_grid(cw, cp, dist, w, h), |c| {
        levenberg_marquardt(points, w, h, c, params, 15)
    });
    let mut best: Option<Fit> = None;
    for (_, c) in tried.iter().take(4) {
        let start = if fov_free {
            *c
        } else {
            Camera { fov: 70.0, ..*c }
        };
        let f = fit(points, w, h, &start, true)?;
        if best.as_ref().is_none_or(|b| f.rms < b.rms) {
            best = Some(f);
        }
    }
    best
}

/// The camera of a labelled frame, from its fire blocks alone (no starting guess): a yaw/pitch grid with the
/// position placed on the ray through the first block's quads at its logged distance, then corner assignment by UV
/// and nearest projection, then the fit. None without any logged quad.
pub fn fit_label_frame(blocks: &[LoggedBlock], w: usize, h: usize) -> Option<Fit> {
    let blocks: Vec<LoggedBlock> = blocks
        .iter()
        .filter(|b| !b.quads.is_empty())
        .cloned()
        .collect();
    let first = blocks.first()?;
    let cands: Vec<_> = blocks.iter().map(|b| block_candidates(b.pos)).collect();
    let centre = [
        first.pos[0] as f64 + 0.5,
        first.pos[1] as f64 + 0.5,
        first.pos[2] as f64 + 0.5,
    ];
    let n = (first.quads.len() * 4) as f64;
    let mean = first
        .quads
        .iter()
        .flat_map(|q| q.corners.iter())
        .fold([0.0, 0.0], |a, c| [a[0] + c[0] / n, a[1] + c[1] / n]);
    let tried = coarse(start_grid(centre, mean, |_| first.dist, w, h), |c| {
        let pts = assign(&blocks, &cands, c, w, h);
        levenberg_marquardt(&pts, w, h, c, &[0, 1, 2, 3, 4, 5, 6], 15)
    });
    // fine: the best few, re-assigned and fitted fully
    let mut best: Option<Fit> = None;
    for (_, c) in tried.iter().take(4) {
        let f = refit(&blocks, &cands, c, w, h)?;
        if best.as_ref().is_none_or(|b| f.rms < b.rms) {
            best = Some(f);
        }
    }
    // robust: a quad that disagrees with all the others (worst error) is left out, a few times at most, while it helps
    let mut best = best?;
    let mut blocks = blocks;
    let total: usize = blocks.iter().map(|b| b.quads.len()).sum();
    while best.rms > 0.1 && best.dropped_quads < 3 && total - best.dropped_quads > 2 {
        let mut worst: Option<(f64, usize, usize)> = None;
        for (bi, (b, cs)) in blocks.iter().zip(&cands).enumerate() {
            for (qi, q) in b.quads.iter().enumerate() {
                let e = best_candidate(q, cs, &best.camera, w, h).map_or(f64::INFINITY, |x| x.0);
                if worst.is_none_or(|x| e > x.0) {
                    worst = Some((e, bi, qi));
                }
            }
        }
        let Some((_, bi, qi)) = worst else { break };
        let mut fewer = blocks.clone();
        fewer[bi].quads.remove(qi);
        let Some(mut f) = refit(&fewer, &cands, &best.camera, w, h) else {
            break;
        };
        if f.rms >= best.rms {
            break;
        }
        f.dropped_quads = best.dropped_quads + 1;
        best = f;
        blocks = fewer;
    }
    Some(best)
}

/// A rotation + FOV guess for `solve_guided`, as `reversal::orientation` gives it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Guess {
    pub yaw: f64,
    pub pitch: f64,
    pub roll: f64,
    pub fov: f64,
    /// Yaw is known only modulo 90° (all four quarter turns are tried).
    pub yaw_mod_90: bool,
    /// False when the FOV is a guess (it is then held only loosely).
    pub fov_known: bool,
}

/// How firmly the guess is held, in degrees per pixel of click error (the automatic guess is good to about 0.5°).
const PRIOR_ANGLE: f64 = 0.5;
const PRIOR_FOV: f64 = 2.0;
const PRIOR_FOV_UNKNOWN: f64 = 30.0;
/// Click error (px rms) above which the guided answer counts as missing the clicks: the guess was wrong.
const GUESS_WRONG_PX: f64 = 3.0;

/// The eye, with rotation and FOV held at `start`'s, from clicked points (each gives two linear equations) and, when
/// given, the eye height. None when the equations do not fix it or a point falls behind the camera.
fn eye_from_points(
    points: &[([f64; 3], [f64; 2])],
    w: usize,
    h: usize,
    start: &Camera,
    eye_y: Option<f64>,
) -> Option<Camera> {
    let rot = Camera {
        pos: [0.0; 3],
        ..*start
    };
    let f = h as f64 / 2.0 / (start.fov.to_radians() / 2.0).tan();
    // view = R p + t with t = -R eye; rows of the linear system in t
    let mut rows: Vec<([f64; 3], f64)> = Vec::new();
    for (p, px) in points {
        let rp = rot.to_view(*p);
        let (xc, yc) = (px[0] - w as f64 / 2.0, h as f64 / 2.0 - px[1]);
        rows.push(([-f, 0.0, -xc], f * rp[0] + xc * rp[2]));
        rows.push(([0.0, -f, -yc], f * rp[1] + yc * rp[2]));
    }
    if let Some(y) = eye_y {
        // eye = -R^T t, so eye_y = -(R^T t)_y; weighted like f pixels per block
        let c: Vec<f64> = (0..3)
            .map(|k| {
                let mut e = [0.0; 3];
                e[k] = 1.0;
                -rot.view_dir_to_world(e)[1] * f
            })
            .collect();
        rows.push(([c[0], c[1], c[2]], y * f));
    }
    let mut a = vec![0.0; 9];
    let mut b = vec![0.0; 3];
    for (r, v) in &rows {
        for i in 0..3 {
            b[i] += r[i] * v;
            for j in 0..3 {
                a[i * 3 + j] += r[i] * r[j];
            }
        }
    }
    // a well-posed system has three clearly non-zero pivots; compare with its scale
    let scale = a[0].abs().max(a[4].abs()).max(a[8].abs());
    let t = solve_linear(a.clone(), b, 3)?;
    let det = a[0] * (a[4] * a[8] - a[5] * a[7]) - a[1] * (a[3] * a[8] - a[5] * a[6])
        + a[2] * (a[3] * a[7] - a[4] * a[6]);
    if det.abs().partial_cmp(&(1e-9 * scale.powi(3))) != Some(std::cmp::Ordering::Greater) {
        return None;
    }
    let e = rot.view_dir_to_world([-t[0], -t[1], -t[2]]);
    let cam = Camera { pos: e, ..*start };
    points
        .iter()
        .all(|(p, _)| cam.to_view(*p)[2] < -1e-6)
        .then_some(cam)
}

fn angle_gap(a: f64, b: f64) -> f64 {
    (a - b + 180.0).rem_euclid(360.0) - 180.0
}

/// The camera from the automatic guess plus clicked block corners (world point, pixel): two corners, or one with the
/// eye height `eye_y`, are enough; with four or more the guess is also allowed to be wrong (the unguided `solve` is
/// tried too). Answers best first (by click error plus how far the angles moved from the guess); `rms` is the click
/// error alone. Empty when the clicks do not fix the camera.
pub fn solve_guided(
    points: &[([f64; 3], [f64; 2])],
    w: usize,
    h: usize,
    guess: &Guess,
    eye_y: Option<f64>,
) -> Vec<Fit> {
    if w == 0
        || h == 0
        || points
            .iter()
            .any(|(p, px)| p.iter().chain(px).any(|v| !v.is_finite()))
        || eye_y.is_some_and(|y| !y.is_finite())
    {
        return Vec::new();
    }
    let mut distinct: Vec<[f64; 3]> = Vec::new();
    for (p, _) in points {
        if distinct
            .iter()
            .all(|q| (0..3).any(|k| (q[k] - p[k]).abs() > 1e-9))
        {
            distinct.push(*p);
        }
    }
    if 2 * distinct.len() + usize::from(eye_y.is_some()) < 3 {
        return Vec::new();
    }
    let fov_sigma = if guess.fov_known {
        PRIOR_FOV
    } else {
        PRIOR_FOV_UNKNOWN
    };
    let turns = if guess.yaw_mod_90 { 4 } else { 1 };
    let mut out: Vec<(f64, Fit)> = Vec::new();
    for q in 0..turns {
        let centre = Camera {
            pos: [0.0; 3],
            yaw: guess.yaw + 90.0 * q as f64,
            pitch: guess.pitch,
            roll: guess.roll,
            fov: guess.fov,
        };
        let Some(start) = eye_from_points(points, w, h, &centre, eye_y) else {
            continue;
        };
        let prior = |c: &Camera, r: &mut Vec<f64>| {
            r.push(angle_gap(c.yaw, centre.yaw) / PRIOR_ANGLE);
            r.push((c.pitch - centre.pitch) / PRIOR_ANGLE);
            r.push((c.roll - centre.roll) / PRIOR_ANGLE);
            r.push((c.fov - centre.fov) / fov_sigma);
            if let Some(y) = eye_y {
                r.push((c.pos[1] - y) * 100.0);
            }
        };
        let (c, cost) =
            levenberg_marquardt_with(points, w, h, &start, &[0, 1, 2, 3, 4, 5, 6], 100, &prior);
        if points.iter().any(|(p, _)| c.to_view(*p)[2] >= 0.0) {
            continue;
        }
        let mut r = Vec::new();
        residuals(points, w, h, &c, &mut r);
        let rms = (r.iter().map(|v| v * v).sum::<f64>() / points.len() as f64).sqrt();
        out.push((
            (cost / points.len() as f64).sqrt(),
            Fit {
                camera: c.normalized(),
                rms,
                points: points.len(),
                fov_fixed: false,
                dropped_quads: 0,
            },
        ));
    }
    out.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut fits: Vec<Fit> = out.into_iter().map(|(_, f)| f).collect();
    // the clicks alone, when they could separate FOV from distance: first only if the guided answer misses the clicks
    // (the guess was wrong) and they fit better; a few noisy clicks fit a wild camera too well to be trusted otherwise
    if distinct.len() >= 4 {
        if let Some(f) = solve(points, w, h).filter(|f| !f.fov_fixed) {
            let guided = fits.first().map_or(f64::INFINITY, |g| g.rms);
            if guided > GUESS_WRONG_PX && f.rms < guided {
                fits.insert(0, f);
            } else {
                fits.push(f);
            }
        }
    }
    fits
}
