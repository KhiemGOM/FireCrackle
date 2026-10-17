//! Thin native/WASM ABI. All pixel rules live in veil.rs, not in bindings.
#![allow(dead_code)]
#[path = "veil.rs"]
mod veil;

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
    if p.is_null() {
        return -1;
    }
    let data = unsafe { std::slice::from_raw_parts_mut(p, len) };
    match veil::unveil_in_place(
        data,
        w,
        h,
        channels,
        veil::A_TOP,
        veil::A_BOTTOM,
        [veil::COLOUR as u8; 3],
    ) {
        Ok(()) => 0,
        Err(_) => -1,
    }
}
