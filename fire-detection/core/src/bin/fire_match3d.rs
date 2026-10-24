//! fire_match3d VIDEO JOINED.jsonl [--every N] [--limit N] [--min-px N] [--dump FRAME DIR]
//!
//! Research: could a 3D quad tell the fire's animation phase? Every fire block on screen shows the same global texture
//! frame (sheet 1 is always 16 frames on from sheet 0), so a frame has one unknown phase of 32. With the camera (the
//! answer key `camera::fit_label_frame` solves from the logged quads, used where it reproduces every logged corner to
//! ≤ 0.06 px, then that camera with growing error) and each logged fire's planes in 3D
//! (`camera::logged_quad_worlds`), every candidate phase is drawn as the game draws fire: cut-out texels with a depth
//! buffer (per pixel, the nearest opaque texel along `Camera::pixel_ray`). Each drawing is compared with the video
//! frame (mean colour error over the pixels any phase covers; where a phase draws nothing, the local background), the
//! fires of a frame are summed, and the best phase is scored against the logged one (`label.f0`).
//!
//! Sizes and pixel errors are in video pixels. `--blur N`: box-blur both brightness images N px before correlating.
//! `--levels N`: only the first N camera error levels (the first is the perfect camera). `--one-plane`: each fire
//! drawn as its single biggest plane on screen (what one flat quad can model), the baseline for the 3D drawing.
//! Cases: the variant known (each plane's logged sheet and UV: an upper bound) and the sheet searched per fire (a real
//! tool does not know which variant a block drew). Fires at least `--min-px` tall (40), fully visible, not veiled.
//! `--dump FRAME DIR`: write that frame's fires (video crop | drawing at the true phase) as raw RGB to look at.
use fire_core::camera::{corner_rms, fit_label_frame, logged_blocks, logged_quad_worlds, Camera};
use fire_core::json::{parse, Value};
use fire_core::video::{read_frame, spawn_rgb24};
use std::io::BufRead;

const SHEETS: [&[u8]; 2] = [
    include_bytes!("../../testdata/fire_0.rgba"),
    include_bytes!("../../testdata/fire_1.rgba"),
];
const PHASES: usize = 32;

/// One texel along a pixel's ray: its depth, plane and texel (column, row within the 16×16 sprite).
#[derive(Clone, Copy)]
struct Hit {
    t: f64,
    plane: usize,
    tx: usize,
    ty: usize,
}

struct Plane {
    world: [[f64; 3]; 4],
    uv: [[f64; 2]; 4],
    sheet: usize,
    fire: usize,
}

/// A fire to score: its planes (in the frame's list of every fire's planes) and its height on screen.
struct Fire {
    planes: std::ops::Range<usize>,
    height: f64,
    scored: bool,
}

fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

/// Every texel of every plane along the ray through each pixel of `bbox`, nearest first.
fn layers(planes: &[Plane], cam: &Camera, w: usize, h: usize, bbox: [usize; 4]) -> Vec<Vec<Hit>> {
    let [x0, y0, x1, y1] = bbox;
    let mut out = Vec::with_capacity((x1 - x0) * (y1 - y0));
    for y in y0..y1 {
        for x in x0..x1 {
            let ray = cam.pixel_ray(x as f64 + 0.5, y as f64 + 0.5, w, h);
            let mut hits = Vec::new();
            for (k, p) in planes.iter().enumerate() {
                let (e1, e2) = (sub(p.world[1], p.world[0]), sub(p.world[3], p.world[0]));
                let n = cross(e1, e2);
                let den = dot(ray, n);
                if den.abs() < 1e-12 {
                    continue;
                }
                let t = dot(sub(p.world[0], cam.pos), n) / den;
                if t <= 0.0 {
                    continue;
                }
                let hit = [
                    cam.pos[0] + t * ray[0],
                    cam.pos[1] + t * ray[1],
                    cam.pos[2] + t * ray[2],
                ];
                let d = sub(hit, p.world[0]);
                let (g11, g12, g22) = (dot(e1, e1), dot(e1, e2), dot(e2, e2));
                let det = g11 * g22 - g12 * g12;
                let (r1, r2) = (dot(d, e1), dot(d, e2));
                let a = (r1 * g22 - r2 * g12) / det;
                let b = (r2 * g11 - r1 * g12) / det;
                if !(0.0..=1.0).contains(&a) || !(0.0..=1.0).contains(&b) {
                    continue;
                }
                let u = p.uv[0][0] + a * (p.uv[1][0] - p.uv[0][0]) + b * (p.uv[3][0] - p.uv[0][0]);
                let v = p.uv[0][1] + a * (p.uv[1][1] - p.uv[0][1]) + b * (p.uv[3][1] - p.uv[0][1]);
                let tx = ((u * 16.0).floor() as isize).clamp(0, 15) as usize;
                let ty = ((v * 16.0).floor() as isize).clamp(0, 15) as usize;
                hits.push(Hit {
                    t,
                    plane: k,
                    tx,
                    ty,
                });
            }
            hits.sort_by(|a, b| a.t.total_cmp(&b.t));
            out.push(hits);
        }
    }
    out
}

/// The colour the game draws at a pixel for `phase` (None: no opaque texel), each plane's sheet from `sheet_of`.
fn texel(hits: &[Hit], phase: usize, sheet_of: &dyn Fn(usize) -> usize) -> Option<[u8; 3]> {
    for hit in hits {
        // measured on quad1: a plane the log marks sheet `s` shows the other texture file at that file's frame (phase =
        // the log's f0). Flipping only the texture or only the 16-frame offset matches worse than chance; both, 55 %
        // exact. Either the log's sheet field or these two files' names count the other way round.
        let tex = 1 - sheet_of(hit.plane);
        let row = (phase + 16 * tex) % PHASES;
        let i = ((row * 16 + hit.ty) * 16 + hit.tx) * 4;
        if SHEETS[tex][i + 3] > 0 {
            return Some([SHEETS[tex][i], SHEETS[tex][i + 1], SHEETS[tex][i + 2]]);
        }
    }
    None
}

fn correlation(a: &[f64], b: &[f64]) -> f64 {
    let n = a.len().max(1) as f64;
    let (ma, mb) = (a.iter().sum::<f64>() / n, b.iter().sum::<f64>() / n);
    let (mut sab, mut saa, mut sbb) = (0.0, 0.0, 0.0);
    for (x, y) in a.iter().zip(b) {
        sab += (x - ma) * (y - mb);
        saa += (x - ma) * (x - ma);
        sbb += (y - mb) * (y - mb);
    }
    if saa <= 0.0 || sbb <= 0.0 {
        0.0
    } else {
        sab / (saa * sbb).sqrt()
    }
}

fn median(mut v: Vec<u8>) -> u8 {
    if v.is_empty() {
        return 0;
    }
    v.sort_unstable();
    v[v.len() / 2]
}

/// How badly each phase's drawing matches the frame (lower is better): 1 − the correlation of brightness over the pixels
/// any phase covers, so the nether fog's blend towards its colour (a·colour + b per channel) does not matter.
fn phase_errors(
    frame: &[u8],
    w: usize,
    bbox: [usize; 4],
    hits: &[Vec<Hit>],
    sheet_of: &dyn Fn(usize) -> usize,
    blur: usize,
) -> [f64; PHASES] {
    let [x0, y0, x1, _] = bbox;
    let bw = x1 - x0;
    let drawn: Vec<[Option<[u8; 3]>; PHASES]> = hits
        .iter()
        .map(|h| std::array::from_fn(|r| texel(h, r, sheet_of)))
        .collect();
    let covered: Vec<bool> = drawn
        .iter()
        .map(|d| d.iter().any(Option::is_some))
        .collect();
    let obs = |i: usize| {
        let (x, y) = (x0 + i % bw, y0 + i / bw);
        let o = (y * w + x) * 3;
        [frame[o], frame[o + 1], frame[o + 2]]
    };
    // the background where a phase draws nothing: the median of the pixels around that no phase covers
    let bg: [u8; 3] = std::array::from_fn(|c| {
        median(
            (0..hits.len())
                .filter(|&i| !covered[i])
                .map(|i| obs(i)[c])
                .collect(),
        )
    });
    let luma = |p: [u8; 3]| 0.299 * p[0] as f64 + 0.587 * p[1] as f64 + 0.114 * p[2] as f64;
    // brightness of the frame and of each drawing over the whole box, box-blurred by `blur` px (sub-pixel slips and
    // compression smear thin flames), then correlated over the covered pixels
    let bh = hits.len() / bw;
    let smooth = |img: Vec<f64>| -> Vec<f64> {
        if blur == 0 {
            return img;
        }
        let b = blur as isize;
        (0..img.len())
            .map(|i| {
                let (x, y) = ((i % bw) as isize, (i / bw) as isize);
                let (mut s, mut n) = (0.0, 0.0);
                for dy in -b..=b {
                    for dx in -b..=b {
                        let (u, v) = (x + dx, y + dy);
                        if u >= 0 && v >= 0 && (u as usize) < bw && (v as usize) < bh {
                            s += img[v as usize * bw + u as usize];
                            n += 1.0;
                        }
                    }
                }
                s / n
            })
            .collect()
    };
    let idx: Vec<usize> = (0..hits.len()).filter(|&i| covered[i]).collect();
    let o_all = smooth((0..hits.len()).map(|i| luma(obs(i))).collect());
    let o: Vec<f64> = idx.iter().map(|&i| o_all[i]).collect();
    std::array::from_fn(|r| {
        let p_all = smooth(drawn.iter().map(|d| luma(d[r].unwrap_or(bg))).collect());
        let p: Vec<f64> = idx.iter().map(|&i| p_all[i]).collect();
        1.0 - correlation(&p, &o)
    })
}

/// The projected box of a fire's planes under `cam`, 3 px wider, within the frame.
fn bbox(planes: &[Plane], cam: &Camera, w: usize, h: usize) -> Option<[usize; 4]> {
    let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    for p in planes {
        for c in &p.world {
            let (x, y) = cam.project(*c, w, h)?;
            (x0, y0, x1, y1) = (x0.min(x), y0.min(y), x1.max(x), y1.max(y));
        }
    }
    let clip = |v: f64, m: usize| v.clamp(0.0, m as f64) as usize;
    let b = [
        clip(x0 - 3.0, w),
        clip(y0 - 3.0, h),
        clip(x1 + 4.0, w),
        clip(y1 + 4.0, h),
    ];
    (b[2] > b[0] && b[3] > b[1] && (b[2] - b[0]) * (b[3] - b[1]) < 900 * 900).then_some(b)
}

struct Rng(u64);
impl Rng {
    fn unit(&mut self) -> f64 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        ((self.0 >> 11) as f64 + 0.5) / (1u64 << 53) as f64
    }
    fn gauss(&mut self) -> f64 {
        (-2.0 * self.unit().ln()).sqrt() * (std::f64::consts::TAU * self.unit()).cos()
    }
}

/// The camera with error: angles and FOV in degrees, position in blocks (each axis, one sigma).
fn perturb(c: &Camera, angle: f64, pos: f64, fov: f64, rng: &mut Rng) -> Camera {
    Camera {
        pos: [
            c.pos[0] + pos * rng.gauss(),
            c.pos[1] + pos * rng.gauss(),
            c.pos[2] + pos * rng.gauss(),
        ],
        yaw: c.yaw + angle * rng.gauss(),
        pitch: c.pitch + angle * rng.gauss(),
        roll: c.roll + angle * rng.gauss(),
        fov: c.fov + fov * rng.gauss(),
    }
}

/// Rank of the true phase (0 = best) and whether the best is within one frame of it.
fn rank(err: &[f64; PHASES], truth: usize) -> (usize, bool) {
    let best = (0..PHASES)
        .min_by(|&a, &b| err[a].total_cmp(&err[b]))
        .unwrap();
    let rank = (0..PHASES).filter(|&r| err[r] < err[truth]).count();
    let d = (best as isize - truth as isize).rem_euclid(PHASES as isize);
    (rank, d <= 1 || d == PHASES as isize - 1)
}

#[derive(Default)]
struct Tally {
    n: usize,
    exact: usize,
    near: usize,
    top3: usize,
}
impl Tally {
    fn add(&mut self, (rank, near): (usize, bool)) {
        self.n += 1;
        self.exact += usize::from(rank == 0);
        self.near += usize::from(near);
        self.top3 += usize::from(rank < 3);
    }
    fn line(&self) -> String {
        let p = |k: usize| 100.0 * k as f64 / self.n.max(1) as f64;
        format!(
            "{:5} | {:5.1} % | {:5.1} % | {:5.1} %",
            self.n,
            p(self.exact),
            p(self.near),
            p(self.top3)
        )
    }
}

fn main() {
    let usage = "usage: fire_match3d VIDEO JOINED.jsonl [--every N] [--limit N] [--min-px N] [--blur N] [--levels N] [--one-plane] [--dump FRAME DIR]";
    let mut args = std::env::args().skip(1);
    let video = args.next().expect(usage);
    let joined = args.next().expect(usage);
    let (mut every, mut limit, mut min_px, mut dump) =
        (1usize, usize::MAX, 40.0, None::<(u64, String)>);
    let (mut blur, mut level_count, mut one_plane) = (0usize, 5usize, false);
    while let Some(f) = args.next() {
        if f == "--one-plane" {
            one_plane = true;
            continue;
        }
        let v = args.next().expect(usage);
        match f.as_str() {
            "--every" => every = v.parse().expect("--every"),
            "--limit" => limit = v.parse().expect("--limit"),
            "--min-px" => min_px = v.parse().expect("--min-px"),
            "--blur" => blur = v.parse().expect("--blur"),
            "--levels" => level_count = v.parse().expect("--levels"),
            "--dump" => {
                dump = Some((
                    v.parse().expect("--dump FRAME"),
                    args.next().expect("--dump FRAME DIR"),
                ))
            }
            other => panic!("unknown flag {other}"),
        }
    }
    // camera error levels: (angle °, position blocks, FOV °)
    let levels: [(f64, f64, f64); 5] = [
        (0.0, 0.0, 0.0),
        (0.1, 0.01, 0.2),
        (0.25, 0.02, 0.5),
        (0.5, 0.05, 1.0),
        (1.0, 0.1, 2.0),
    ];
    let (info, mut child) = spawn_rgb24(&video).expect("video");
    let (w, h) = (info.width, info.height);
    let mut pipe = child.stdout.take().expect("piped");
    let mut frame = vec![0u8; w * h * 3];
    // per level: [known variant, sheet searched] × [frame, single fire]; frames by largest fire: 40-80, 80-160, 160+
    let mut tallies: Vec<[[Tally; 2]; 2]> = (0..levels.len()).map(|_| Default::default()).collect();
    let mut by_size: Vec<[Tally; 3]> = (0..levels.len()).map(|_| Default::default()).collect();
    let mut px_err: Vec<Vec<f64>> = vec![Vec::new(); levels.len()];
    let (mut keyed, mut used) = (0usize, 0usize);
    let mut rng = Rng(12345);
    let t0 = std::time::Instant::now();
    for (row, line) in std::io::BufReader::new(std::fs::File::open(&joined).expect("joined"))
        .lines()
        .enumerate()
    {
        if !read_frame(&mut pipe, &mut frame).expect("frame") {
            break;
        }
        let Ok(v) = parse(&line.expect("read")) else {
            continue;
        };
        let label = v.get("label").unwrap_or(&v);
        let (Some(lw), Some(lh), Some(f0)) = (
            label.get("w").and_then(Value::num),
            label.get("h").and_then(Value::num),
            label.get("f0").and_then(Value::num),
        ) else {
            continue;
        };
        // the log is in the game's pixels; the recording may be the same view scaled (quad1: 2560×1440 → 1920×1080).
        // The camera does not depend on the size: solve in the log's pixels, draw and compare in the video's
        let (lw, lh) = (lw as usize, lh as usize);
        let scale = w as f64 / lw as f64;
        if ((h as f64 / lh as f64) - scale).abs() > 1e-3 {
            continue;
        }
        let blocks = logged_blocks(label);
        if blocks.is_empty() {
            continue;
        }
        keyed += 1;
        let dumping = dump.as_ref().is_some_and(|(d, _)| *d == row as u64);
        if !dumping && (dump.is_some() || (keyed - 1) % every != 0) {
            continue;
        }
        if used >= limit {
            break;
        }
        let Some(key) = fit_label_frame(&blocks, lw, lh) else {
            continue;
        };
        if key.rms > 0.06 || key.fov_fixed {
            continue;
        }
        // each logged fire to match: big enough, fully visible, not veiled; its planes in 3D with their logged sheets
        let worlds = logged_quad_worlds(&blocks, &key.camera, lw, lh);
        let (mut fires, mut planes): (Vec<Fire>, Vec<Plane>) = (Vec::new(), Vec::new());
        let json_fires: Vec<&Value> = label
            .get("fires")
            .and_then(Value::arr)
            .unwrap_or(&[])
            .iter()
            .filter(|s| s.get("src").and_then(Value::str) == Some("block"))
            .collect();
        for (b, ws) in blocks.iter().zip(&worlds) {
            let Some(src) = json_fires.iter().find(|s| {
                s.get("pos")
                    .and_then(Value::arr)
                    .is_some_and(|p| p.iter().filter_map(Value::num).map(|x| x as i32).eq(b.pos))
            }) else {
                continue;
            };
            let num = |k: &str| src.get(k).and_then(Value::num);
            let bx = src
                .get("box")
                .and_then(Value::arr)
                .map(|a| a.iter().filter_map(Value::num).collect::<Vec<_>>());
            let height = bx
                .as_ref()
                .filter(|b| b.len() == 4)
                .map_or(0.0, |b| (b[3] - b[1]) * scale);
            let scored = height >= min_px
                && num("vis").unwrap_or(0.0) >= 0.95
                && num("veil").unwrap_or(1.0) <= 0.01;
            // the logged quads' sheets, in the order `logged_quads` kept them (same validity rule)
            let sheets: Vec<usize> = src
                .get("quads")
                .and_then(Value::arr)
                .unwrap_or(&[])
                .iter()
                .filter(|q| {
                    let ok = |k: &str| q.get(k).and_then(Value::arr).is_some_and(|a| a.len() == 8);
                    ok("c")
                        && ok("uv")
                        && q.get("c")
                            .and_then(Value::arr)
                            .unwrap()
                            .iter()
                            .all(|x| x.num().is_some_and(f64::is_finite))
                })
                .map(|q| q.get("s").and_then(Value::num).unwrap_or(0.0) as usize)
                .collect();
            if sheets.len() != b.quads.len() {
                continue;
            }
            let id = fires.len();
            let mut mine: Vec<Plane> = b
                .quads
                .iter()
                .zip(ws)
                .zip(&sheets)
                .filter_map(|((q, w), &s)| {
                    w.map(|world| Plane {
                        world,
                        uv: q.uv,
                        sheet: s.min(1),
                        fire: id,
                    })
                })
                .collect();
            if one_plane && mine.len() == b.quads.len() {
                // the plane covering the most screen (logged corners, shoelace area)
                let area = |c: &[[f64; 2]; 4]| {
                    (0..4)
                        .map(|i| c[i][0] * c[(i + 1) % 4][1] - c[(i + 1) % 4][0] * c[i][1])
                        .sum::<f64>()
                        .abs()
                        / 2.0
                };
                let best = (0..b.quads.len())
                    .max_by(|&x, &y| {
                        area(&b.quads[x].corners).total_cmp(&area(&b.quads[y].corners))
                    })
                    .unwrap();
                let keep = mine.swap_remove(best);
                mine = vec![keep];
            }
            if mine.len() == if one_plane { 1 } else { b.quads.len() } {
                let start = planes.len();
                planes.extend(mine);
                fires.push(Fire {
                    planes: start..planes.len(),
                    height,
                    scored,
                });
            }
        }
        if !fires.iter().any(|f| f.scored) {
            continue;
        }
        used += 1;
        let truth = f0 as usize % PHASES;
        let tallest = fires
            .iter()
            .filter(|f| f.scored)
            .map(|f| f.height)
            .fold(0.0, f64::max);
        let size = if tallest < 80.0 {
            0
        } else if tallest < 160.0 {
            1
        } else {
            2
        };
        for (li, &(a, p, f)) in levels.iter().enumerate().take(level_count) {
            let cam = if li == 0 {
                key.camera
            } else {
                perturb(&key.camera, a, p, f, &mut rng)
            };
            if let Some(e) = corner_rms(&blocks, &cam, lw, lh) {
                px_err[li].push(e * scale);
            }
            let mut sum = [[0.0; PHASES]; 2];
            for (id, fire) in fires.iter().enumerate().filter(|(_, f)| f.scored) {
                let Some(bb) = bbox(&planes[fire.planes.clone()], &cam, w, h) else {
                    continue;
                };
                // every fire is drawn (neighbours overlap this one's box); the searched case tries this fire's sheet
                let hits = layers(&planes, &cam, w, h, bb);
                let known = phase_errors(&frame, w, bb, &hits, &|k| planes[k].sheet, blur);
                let all = &planes;
                let as_sheet =
                    |s: usize| move |k: usize| if all[k].fire == id { s } else { all[k].sheet };
                let as0 = phase_errors(&frame, w, bb, &hits, &as_sheet(0), blur);
                let as1 = phase_errors(&frame, w, bb, &hits, &as_sheet(1), blur);
                let searched: [f64; PHASES] = std::array::from_fn(|r| as0[r].min(as1[r]));
                for (case, e) in [known, searched].iter().enumerate() {
                    tallies[li][case][1].add(rank(e, truth));
                    for r in 0..PHASES {
                        sum[case][r] += e[r];
                    }
                }
                if dumping && li == 0 {
                    let (dir, [x0, y0, x1, y1]) = (&dump.as_ref().unwrap().1, bb);
                    let (bw, bh) = (x1 - x0, y1 - y0);
                    let mut out = vec![0u8; bw * 2 * bh * 3];
                    for (i, hs) in hits.iter().enumerate() {
                        let (x, y) = (i % bw, i / bw);
                        let o = ((y0 + y) * w + x0 + x) * 3;
                        out[(y * bw * 2 + x) * 3..][..3].copy_from_slice(&frame[o..o + 3]);
                        let d = texel(hs, truth, &|k| planes[k].sheet).unwrap_or([0, 0, 0]);
                        out[(y * bw * 2 + bw + x) * 3..][..3].copy_from_slice(&d);
                    }
                    let name = format!(
                        "{dir}/fire_{row}_{}x{}_{}.rgb",
                        bw * 2,
                        bh,
                        fire.height as usize
                    );
                    std::fs::write(&name, out).expect("dump");
                    eprintln!(
                        "wrote {name}; known-variant 1-correlation by phase (truth {truth}): {:?}",
                        known.map(|e| (e * 100.0).round() / 100.0)
                    );
                }
            }
            for case in 0..2 {
                tallies[li][case][0].add(rank(&sum[case], truth));
            }
            by_size[li][size].add(rank(&sum[1], truth));
        }
        if dumping {
            break;
        }
    }
    let _ = child.kill();
    println!(
        "{used} frames with fires ≥ {min_px} px (of {keyed} labelled), {:.1} s",
        t0.elapsed().as_secs_f64()
    );
    println!("phase of 32 (chance: exact 3.1 %, within ±1 9.4 %, top 3 9.4 %)");
    println!("camera error (angle°, pos blocks, fov°) | corner px p50 | case | frames: n | exact | ±1 | top3 | single fires: n | exact | ±1 | top3");
    for (li, &(a, p, f)) in levels.iter().enumerate() {
        let mut e = px_err[li].clone();
        e.sort_by(f64::total_cmp);
        let p50 = e.get(e.len() / 2).copied().unwrap_or(f64::NAN);
        for (case, name) in ["variant known", "sheet searched"].iter().enumerate() {
            println!(
                "({a:4.2}, {p:4.2}, {f:3.1}) | {p50:6.2} | {name:14} | {} | {}",
                tallies[li][case][0].line(),
                tallies[li][case][1].line()
            );
        }
    }
    println!("sheet searched, frames by their largest fire: 40-80 px | 80-160 px | 160+ px");
    for (li, &(a, p, f)) in levels.iter().enumerate() {
        println!(
            "({a:4.2}, {p:4.2}, {f:3.1}) | {} | {} | {}",
            by_size[li][0].line(),
            by_size[li][1].line(),
            by_size[li][2].line()
        );
    }
}
