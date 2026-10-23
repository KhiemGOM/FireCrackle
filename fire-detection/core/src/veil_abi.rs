//! Thin native/WASM ABI. All pixel rules live in veil.rs, not in bindings.
#![allow(dead_code)]
#[path = "veil.rs"]
mod veil;

/// # Safety
/// p must contain len bytes; optional masks eachw*h bytes; out4 writable doubles.
#[no_mangle]
pub unsafe extern "C" fn portal_guard(
    p: *const u8,
    len: usize,
    w: usize,
    h: usize,
    mask: *const u8,
    known: *const u8,
    out: *mut f64,
) -> i32 {
    if p.is_null() || out.is_null() {
        return -1;
    }
    let rgb = unsafe { std::slice::from_raw_parts(p, len) };
    let m = if mask.is_null() {
        None
    } else {
        Some(unsafe { std::slice::from_raw_parts(mask, w.saturating_mul(h)) })
    };
    let k = if known.is_null() {
        None
    } else {
        Some(unsafe { std::slice::from_raw_parts(known, w.saturating_mul(h)) })
    };
    match veil::portal::guard(rgb, w, h, m, k) {
        Ok(g) => {
            let v = [
                g.abstain as u8 as f64,
                g.flags as f64,
                g.largest_purple as f64,
                g.known_pixels as f64,
            ];
            unsafe { std::ptr::copy_nonoverlapping(v.as_ptr(), out, 4) };
            0
        }
        Err(_) => -1,
    }
}

/// # Safety
/// Input buffers must match their lengths; out must reference8 writable doubles.
#[no_mangle]
pub unsafe extern "C" fn portal_fit(
    p: *const u8,
    len: usize,
    w: usize,
    h: usize,
    atlas: *const u8,
    atlas_len: usize,
    side: usize,
    mask: *const u8,
    out: *mut f64,
) -> i32 {
    if p.is_null() || atlas.is_null() || out.is_null() {
        return -1;
    }
    let rgb = unsafe { std::slice::from_raw_parts(p, len) };
    let tex = unsafe { std::slice::from_raw_parts(atlas, atlas_len) };
    let m = if mask.is_null() {
        None
    } else {
        Some(unsafe { std::slice::from_raw_parts(mask, w.saturating_mul(h)) })
    };
    match veil::portal::fit(rgb, w, h, tex, side, m) {
        Ok(f) => {
            let values = [
                f.detected as u8 as f64,
                f.phase as f64,
                f.opacity,
                f.residual,
                f.baseline,
                f.improvement,
                f.runner_up,
                f.purple_share,
            ];
            unsafe { std::ptr::copy_nonoverlapping(values.as_ptr(), out, 8) };
            0
        }
        Err(_) => -1,
    }
}
/// # Safety
/// RGB/atlas/mask lengths must match dimensions; valid must referencew*h writable bytes.
#[no_mangle]
pub unsafe extern "C" fn portal_inverse(
    p: *mut u8,
    len: usize,
    w: usize,
    h: usize,
    atlas: *const u8,
    atlas_len: usize,
    side: usize,
    phase: usize,
    opacity: f64,
    mask: *const u8,
    valid: *mut u8,
) -> i32 {
    if p.is_null() || atlas.is_null() || valid.is_null() {
        return -1;
    }
    let rgb = unsafe { std::slice::from_raw_parts_mut(p, len) };
    let tex = unsafe { std::slice::from_raw_parts(atlas, atlas_len) };
    let m = if mask.is_null() {
        None
    } else {
        Some(unsafe { std::slice::from_raw_parts(mask, w.saturating_mul(h)) })
    };
    match veil::portal::undo(rgb, w, h, tex, side, phase, opacity, m) {
        Ok(v) => {
            unsafe { std::ptr::copy_nonoverlapping(v.as_ptr(), valid, v.len()) };
            0
        }
        Err(_) => -1,
    }
}

#[no_mangle]
pub extern "C" fn veil_constant(index: u32) -> f64 {
    let o = veil::Options::default();
    match index {
        0 => veil::A_TOP,
        1 => veil::A_BOTTOM,
        2 => veil::COLOUR,
        3 => o.min_share,
        4 => o.margin,
        5 => o.slack,
        6 => veil::MENU_ALPHA,
        _ => f64::NAN,
    }
}

#[no_mangle]
pub extern "C" fn veil_alloc(n: usize) -> *mut u8 {
    let mut v = vec![0u8; n];
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}
/// # Safety
/// Pointer/length must be the exact allocation returned by veil_alloc.
#[no_mangle]
pub unsafe extern "C" fn veil_free(p: *mut u8, n: usize) {
    if !p.is_null() {
        drop(unsafe { Vec::from_raw_parts(p, n, n) });
    }
}
/// # Safety
/// Pointer must reference len readable bytes for the duration of this call.
#[no_mangle]
pub unsafe extern "C" fn veil_detect(
    p: *const u8,
    len: usize,
    w: usize,
    h: usize,
    channels: usize,
    y0: usize,
    share: f64,
    margin: f64,
    slack: f64,
) -> i32 {
    if p.is_null() {
        return -1;
    }
    let data = unsafe { std::slice::from_raw_parts(p, len) };
    match veil::detect_pixels(
        data,
        w,
        h,
        channels,
        y0,
        veil::Options {
            min_share: share,
            margin,
            slack,
        },
    ) {
        Ok((yes, _)) => yes as i32,
        Err(_) => -1,
    }
}
/// # Safety
/// Same readable-buffer requirement as veil_detect; diagnostic primitive only.
#[no_mangle]
pub unsafe extern "C" fn veil_detect_strict(
    p: *const u8,
    len: usize,
    w: usize,
    h: usize,
    channels: usize,
    y0: usize,
    share: f64,
    margin: f64,
    slack: f64,
) -> i32 {
    if p.is_null() {
        return -1;
    }
    let data = unsafe { std::slice::from_raw_parts(p, len) };
    match veil::strict_pixels(
        data,
        w,
        h,
        channels,
        y0,
        veil::Options {
            min_share: share,
            margin,
            slack,
        },
    ) {
        Ok(yes) => yes as i32,
        Err(_) => -1,
    }
}
/// # Safety
/// Same readable-buffer requirement as veil_detect.
#[no_mangle]
pub unsafe extern "C" fn veil_share(
    p: *const u8,
    len: usize,
    w: usize,
    h: usize,
    channels: usize,
    y0: usize,
) -> f64 {
    if p.is_null() {
        return -1.0;
    }
    let data = unsafe { std::slice::from_raw_parts(p, len) };
    veil::detect_pixels(data, w, h, channels, y0, veil::Options::default())
        .map(|(_, s)| s)
        .unwrap_or(-1.0)
}
/// # Safety
/// Pointer must reference len exclusively writable bytes for the duration of this call.
#[no_mangle]
pub unsafe extern "C" fn veil_inverse(
    p: *mut u8,
    len: usize,
    w: usize,
    h: usize,
    channels: usize,
) -> i32 {
    unsafe { veil_inverse_style(p, len, w, h, channels, 0) }
}
/// `veil_inverse` of a chosen style: 0 flat gradient, 1 the 1.21 menu background.
/// # Safety
/// Pointer must reference len exclusively writable bytes for the duration of this call.
#[no_mangle]
pub unsafe extern "C" fn veil_inverse_style(
    p: *mut u8,
    len: usize,
    w: usize,
    h: usize,
    channels: usize,
    style: u32,
) -> i32 {
    let style = match style {
        0 => veil::VeilStyle::Flat,
        1 => veil::VeilStyle::Menu,
        _ => return -1,
    };
    if p.is_null() {
        return -1;
    }
    let data = unsafe { std::slice::from_raw_parts_mut(p, len) };
    match veil::unveil_style_in_place(data, w, h, channels, style) {
        Ok(()) => 0,
        Err(_) => -1,
    }
}
