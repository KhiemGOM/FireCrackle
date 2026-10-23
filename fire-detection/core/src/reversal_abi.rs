//! C ABI for the 3D fire tool (FireCrackle `src/lib/reversal.ts`): the automatic guess (`reversal::orientation`), the
//! camera solves (`camera::solve_guided`, `camera::solve`), projection (`Camera::project`) and fire geometry
//! (`fire_model`), so the browser draws only what Rust computed. Built on its own like `veil_abi.rs`:
//! `rustc --crate-type cdylib --target wasm32-unknown-unknown src/reversal_abi.rs`. Numbers go in and out as f64
//! arrays; a camera is 7 numbers (x, y, z, yaw, pitch, roll, fov); a pixel behind the camera is NaN.
#![allow(dead_code)]

#[path = "camera.rs"]
mod camera;
#[path = "fire_model.rs"]
mod fire_model;
#[path = "json.rs"]
mod json;
#[path = "lines.rs"]
mod lines;
#[path = "overlay.rs"]
mod overlay;
#[path = "reversal.rs"]
mod reversal;
#[path = "veil.rs"]
mod veil;

use camera::{Camera, Fit, Guess};
use std::slice;

#[no_mangle]
pub extern "C" fn rev_alloc(n: usize) -> *mut u8 {
    let mut v = vec![0u8; n.max(1)];
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// # Safety
/// `p` and `n` must come from one `rev_alloc` call.
#[no_mangle]
pub unsafe extern "C" fn rev_free(p: *mut u8, n: usize) {
    if !p.is_null() {
        drop(Vec::from_raw_parts(p, n.max(1), n.max(1)));
    }
}

unsafe fn f64s<'a>(p: *const f64, n: usize) -> &'a [f64] {
    if n == 0 || p.is_null() {
        &[]
    } else {
        slice::from_raw_parts(p, n)
    }
}

unsafe fn f64s_mut<'a>(p: *mut f64, n: usize) -> &'a mut [f64] {
    if n == 0 || p.is_null() {
        &mut []
    } else {
        slice::from_raw_parts_mut(p, n)
    }
}

fn camera_from(c: &[f64]) -> Camera {
    Camera {
        pos: [c[0], c[1], c[2]],
        yaw: c[3],
        pitch: c[4],
        roll: c[5],
        fov: c[6],
    }
}

/// A solved camera: camera (7), click rms, fov_fixed.
const FIT: usize = 9;

fn write_fit(f: &Fit, out: &mut [f64]) {
    let c = f.camera;
    out[..FIT].copy_from_slice(&[
        c.pos[0],
        c.pos[1],
        c.pos[2],
        c.yaw,
        c.pitch,
        c.roll,
        c.fov,
        f.rms,
        f.fov_fixed as u8 as f64,
    ]);
}

unsafe fn points(p: *const f64, n: usize) -> Vec<([f64; 3], [f64; 2])> {
    f64s(p, n * 5)
        .chunks_exact(5)
        .map(|v| ([v[0], v[1], v[2]], [v[3], v[4]]))
        .collect()
}

/// The automatic guess from an RGBA frame; `mask` (one byte per pixel, non-zero = not the world) may be null.
/// `out` gets yaw, pitch, roll, fov, fov_known, ambiguous, margin, support. 1 = answered, 0 = no answer, -1 = bad
/// input.
///
/// # Safety
/// `rgba` holds `w * h * 4` bytes, `mask` (if not null) `w * h`, `out` 8 f64.
#[no_mangle]
pub unsafe extern "C" fn rev_orientation(
    rgba: *const u8,
    w: usize,
    h: usize,
    mask: *const u8,
    out: *mut f64,
) -> i32 {
    if rgba.is_null() || out.is_null() || w < 3 || h < 3 {
        return -1;
    }
    let px = slice::from_raw_parts(rgba, w * h * 4);
    let rgb: Vec<u8> = px
        .chunks_exact(4)
        .flat_map(|p| [p[0], p[1], p[2]])
        .collect();
    let ignore: Option<Vec<bool>> = (!mask.is_null()).then(|| {
        slice::from_raw_parts(mask, w * h)
            .iter()
            .map(|&b| b != 0)
            .collect()
    });
    match reversal::orientation(&rgb, w, h, ignore.as_deref()) {
        Some(o) => {
            f64s_mut(out, 8).copy_from_slice(&[
                o.yaw,
                o.pitch,
                o.roll,
                o.fov,
                o.fov_known as u8 as f64,
                o.ambiguous as u8 as f64,
                o.margin,
                o.support,
            ]);
            1
        }
        None => 0,
    }
}

/// Guided camera solve from `n` clicks (x, y, z, pixel x, pixel y each) and `guess` (yaw, pitch, roll, fov,
/// yaw_mod_90, fov_known); `eye_y` NaN for none. Writes up to `cap` answers best first, returns how many.
///
/// # Safety
/// `pts` holds `n * 5` f64, `guess` 6, `out` `cap * 9`.
#[no_mangle]
#[allow(clippy::too_many_arguments)] // flat C ABI
pub unsafe extern "C" fn rev_solve_guided(
    pts: *const f64,
    n: usize,
    w: usize,
    h: usize,
    guess: *const f64,
    eye_y: f64,
    out: *mut f64,
    cap: usize,
) -> i32 {
    if guess.is_null() {
        return -1;
    }
    let g = f64s(guess, 6);
    let guess = Guess {
        yaw: g[0],
        pitch: g[1],
        roll: g[2],
        fov: g[3],
        yaw_mod_90: g[4] != 0.0,
        fov_known: g[5] != 0.0,
    };
    let eye = (!eye_y.is_nan()).then_some(eye_y);
    let fits = camera::solve_guided(&points(pts, n), w, h, &guess, eye);
    let out = f64s_mut(out, cap * FIT);
    let k = fits.len().min(cap);
    for (i, f) in fits.iter().take(k).enumerate() {
        write_fit(f, &mut out[i * FIT..]);
    }
    k as i32
}

/// Camera from clicks alone (4 or more). 1 = solved into `out`, 0 = not.
///
/// # Safety
/// `pts` holds `n * 5` f64, `out` 9.
#[no_mangle]
pub unsafe extern "C" fn rev_solve(
    pts: *const f64,
    n: usize,
    w: usize,
    h: usize,
    out: *mut f64,
) -> i32 {
    match camera::solve(&points(pts, n), w, h) {
        Some(f) => {
            write_fit(&f, f64s_mut(out, FIT));
            1
        }
        None => 0,
    }
}

/// Pixels of `n` world points (x, y, z each) under `cam`; NaN for a point behind the camera.
///
/// # Safety
/// `cam` holds 7 f64, `pts` `n * 3`, `out` `n * 2`.
#[no_mangle]
pub unsafe extern "C" fn rev_project(
    cam: *const f64,
    pts: *const f64,
    n: usize,
    w: usize,
    h: usize,
    out: *mut f64,
) -> i32 {
    if cam.is_null() {
        return -1;
    }
    let c = camera_from(f64s(cam, 7));
    let out = f64s_mut(out, n * 2);
    for (i, p) in f64s(pts, n * 3).chunks_exact(3).enumerate() {
        let (x, y) = c
            .project([p[0], p[1], p[2]], w, h)
            .unwrap_or((f64::NAN, f64::NAN));
        out[i * 2] = x;
        out[i * 2 + 1] = y;
    }
    n as i32
}

/// Quad record of the fire calls: 4 world corners (12), 4 pixels (8, NaN behind the camera), 4 UVs (8), sheet
/// (0 = fire_0, 1 = fire_1, -1 = either: a block's sprite variant is random by position).
const QUAD: usize = 29;

fn write_quad(
    c: &Camera,
    w: usize,
    h: usize,
    corners: &[[f64; 3]; 4],
    uv: &[[f64; 2]; 4],
    sheet: f64,
    out: &mut [f64],
) {
    for k in 0..4 {
        out[k * 3..k * 3 + 3].copy_from_slice(&corners[k]);
        let (x, y) = c.project(corners[k], w, h).unwrap_or((f64::NAN, f64::NAN));
        out[12 + k * 2] = x;
        out[12 + k * 2 + 1] = y;
        out[20 + k * 2] = uv[k][0];
        out[20 + k * 2 + 1] = uv[k][1];
    }
    out[28] = sheet;
}

/// The planes of a fire block at (x, y, z) (`fire_model::fire_block_quads`): `faces` bits 1 floor, 2 north, 4 east,
/// 8 south, 16 west, 32 up; `soul` non-zero for soul fire. Writes up to `cap` quads.
///
/// # Safety
/// `cam` holds 7 f64, `out` `cap * 29`.
#[no_mangle]
#[allow(clippy::too_many_arguments)] // flat C ABI
pub unsafe extern "C" fn rev_block_quads(
    cam: *const f64,
    w: usize,
    h: usize,
    x: i32,
    y: i32,
    z: i32,
    faces: u32,
    soul: u32,
    out: *mut f64,
    cap: usize,
) -> i32 {
    if cam.is_null() {
        return -1;
    }
    let c = camera_from(f64s(cam, 7));
    let f = fire_model::FireFaces {
        floor: faces & 1 != 0,
        north: faces & 2 != 0,
        east: faces & 4 != 0,
        south: faces & 8 != 0,
        west: faces & 16 != 0,
        up: faces & 32 != 0,
    };
    let quads = fire_model::fire_block_quads([x, y, z], f, soul != 0);
    let out = f64s_mut(out, cap * QUAD);
    let k = quads.len().min(cap);
    for (i, q) in quads.iter().take(k).enumerate() {
        write_quad(&c, w, h, &q.corners, &q.uv, -1.0, &mut out[i * QUAD..]);
    }
    k as i32
}

/// The fire on an entity with feet at (x, y, z) and hitbox `ew` × `eh`, facing `cam`. Writes up to `cap` quads.
///
/// # Safety
/// `cam` holds 7 f64, `out` `cap * 29`.
#[no_mangle]
#[allow(clippy::too_many_arguments)] // flat C ABI
pub unsafe extern "C" fn rev_entity_quads(
    cam: *const f64,
    w: usize,
    h: usize,
    x: f64,
    y: f64,
    z: f64,
    ew: f64,
    eh: f64,
    out: *mut f64,
    cap: usize,
) -> i32 {
    if cam.is_null() {
        return -1;
    }
    let c = camera_from(f64s(cam, 7));
    let quads = fire_model::entity_quads([x, y, z], ew, eh, c.yaw);
    let out = f64s_mut(out, cap * QUAD);
    let k = quads.len().min(cap);
    for (i, q) in quads.iter().take(k).enumerate() {
        write_quad(
            &c,
            w,
            h,
            &q.corners,
            &q.uv,
            q.sheet as f64,
            &mut out[i * QUAD..],
        );
    }
    k as i32
}

/// Number of entity types in `fire_model::ENTITY_SIZES`.
#[no_mangle]
pub extern "C" fn rev_entity_count() -> i32 {
    fire_model::ENTITY_SIZES.len() as i32
}

/// Entity type `i`: its name (UTF-8, up to `cap` bytes) into `name`, width and height into `dims`; returns the name
/// length, or -1 past the end.
///
/// # Safety
/// `name` holds `cap` bytes, `dims` 2 f64.
#[no_mangle]
pub unsafe extern "C" fn rev_entity(i: usize, name: *mut u8, cap: usize, dims: *mut f64) -> i32 {
    let Some(e) = fire_model::ENTITY_SIZES.get(i) else {
        return -1;
    };
    let b = e.0.as_bytes();
    let k = b.len().min(cap);
    if !name.is_null() {
        slice::from_raw_parts_mut(name, k).copy_from_slice(&b[..k]);
    }
    f64s_mut(dims, 2).copy_from_slice(&[e.1, e.2]);
    k as i32
}
