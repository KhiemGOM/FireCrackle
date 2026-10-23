//! Test plan: the reader must work at any recording resolution, not only the one it was tuned on.
//! A recording of a game at GUI scale `s` drawn at `Hg` pixels tall and stored `H` pixels tall has font pixels of
//! `g = s * H / Hg` video pixels: whole (1440p at scale 3: 3, 1080p at scale 3: 3) or not (a 1440p game in a 1080p
//! file: 2.25). The font reader needs whole ones, so the footage is resampled by `3 / g` first, and `g` has to be found
//! without being told. Ways this can break: a resampled label is blurry and rings (the reader demanded 97 % of the
//! template and found nothing); the wrong size is picked (a neighbour such as 2 vs 2.25 reads plausible digits);
//! footage without the overlay yields a size anyway; frames without the overlay in some samples sink the vote;
//! a size that is only an approximation of the true one (a 1 % window-size rounding) fails.
//! Footage here is made by an independent exact-area downscale, not by the code under test.
use hud_cadence::autoscale::{detect, geometry, parse_probe, resample, Band};
use hud_cadence::font::{render, Font};

fn font() -> Font {
    Font::load(include_bytes!("../assets/ascii.png")).unwrap()
}

/// Exact-area downscale (each output pixel is the mean of the source area it covers).
fn area(g: &[u8], w: usize, h: usize, ow: usize, oh: usize) -> Vec<u8> {
    let (sx, sy) = (w as f64 / ow as f64, h as f64 / oh as f64);
    let mut out = vec![0u8; ow * oh];
    for oy in 0..oh {
        for ox in 0..ow {
            let (x0, x1, y0, y1) = (ox as f64 * sx, (ox + 1) as f64 * sx, oy as f64 * sy, (oy + 1) as f64 * sy);
            let (mut sum, mut wsum) = (0.0, 0.0);
            for y in y0.floor() as usize..(y1.ceil() as usize).min(h) {
                let wy = (y1.min(y as f64 + 1.0) - y0.max(y as f64)).max(0.0);
                for x in x0.floor() as usize..(x1.ceil() as usize).min(w) {
                    let wx = (x1.min(x as f64 + 1.0) - x0.max(x as f64)).max(0.0);
                    sum += g[y * w + x] as f64 * wx * wy;
                    wsum += wx * wy;
                }
            }
            out[oy * ow + ox] = (sum / wsum).round() as u8;
        }
    }
    out
}

/// The top band of a game frame drawn at GUI scale `s` (game pixels), then stored `ratio` times as large:
/// dark world, a lighter box, the label on the GUI grid.
fn band(f: &Font, text: &str, s: usize, ratio: f64, x_gui: usize) -> Band {
    let (gw, gh) = (2000usize, 12 * s);
    let mut g = vec![30u8; gw * gh];
    let img = render(f, text, s);
    let (x0, y0) = (x_gui * s, s);
    for y in y0 - s..y0 + img.height + s {
        for x in x0 - s..(x0 + img.width + s).min(gw) {
            g[y * gw + x] = 65;
        }
    }
    for y in 0..img.height {
        for x in 0..img.width {
            if img.get(x, y) {
                g[(y0 + y) * gw + x0 + x] = 214;
            }
        }
    }
    let (ow, oh) = (((gw as f64 * ratio).round() as usize), ((gh as f64 * ratio).round() as usize));
    let gray = if (ratio - 1.0).abs() < 1e-9 { g } else { area(&g, gw, gh, ow, oh) };
    Band { gray, width: ow, height: oh }
}

fn samples(f: &Font, s: usize, ratio: f64) -> Vec<Band> {
    // different values and label positions, as a real recording has
    [("FPS: 116", 2), ("XYZ: 1156.123 | FPS: 61", 2), ("XYZ: 8 / 9 | Yaw: -5.4 | FPS: 1023", 2), ("FPS: 99", 2), ("A: 1 | FPS: 244", 2)]
        .iter()
        .map(|(t, x)| band(f, t, s, ratio, *x))
        .collect()
}

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() / b < 0.01
}

#[test]
fn the_font_size_is_found_at_every_common_resolution_and_gui_scale() {
    let f = font();
    // (GUI scale, game height, video height): the 1440p game stored at 1440p and at 1080p, a native 1080p game at
    // GUI scales 2/3/4, a 4K game stored at 1080p, and a 1440p game stored at 720p.
    for (s, hg, hv) in [(3usize, 1440.0, 1440.0), (3, 1440.0, 1080.0), (3, 1080.0, 1080.0), (2, 1080.0, 1080.0), (4, 1080.0, 1080.0), (4, 2160.0, 1080.0), (3, 1440.0, 720.0), (5, 1440.0, 1440.0)] {
        let ratio = hv / hg;
        let found = detect(&f, &samples(&f, s, ratio), hv as usize);
        let want = s as f64 * ratio;
        let got = found.unwrap_or_else(|| panic!("scale {s}, {hg} -> {hv}: nothing found"));
        assert!(close(got.glyph, want), "scale {s}, {hg} -> {hv}: wanted a {want} px font pixel, got {}", got.glyph);
        assert!(close(got.factor * got.glyph, 3.0), "the resample factor must make a font pixel 3 px, got {} * {}", got.factor, got.glyph);
        assert!(got.reads >= 4, "most samples should read: {}", got.reads);
    }
}

#[test]
fn samples_without_the_overlay_do_not_stop_the_size_being_found() {
    let f = font();
    let mut s = samples(&f, 3, 0.75);
    let blank = Band { gray: vec![35; s[0].width * s[0].height], width: s[0].width, height: s[0].height };
    s[1] = blank.clone();
    s[3] = blank;
    let got = detect(&f, &s, 1080).expect("three of five samples still read");
    assert!(close(got.glyph, 2.25), "{}", got.glyph);
}

#[test]
fn footage_without_the_overlay_has_no_size() {
    let f = font();
    let mut seed = 0x9e3779b97f4a7c15u64;
    let mut rnd = move || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        (seed % 256) as u8
    };
    let (w, h) = (1500usize, 40usize);
    let noise: Vec<Band> = (0..6).map(|_| Band { gray: (0..w * h).map(|_| rnd()).collect(), width: w, height: h }).collect();
    assert!(detect(&f, &noise, 1080).is_none(), "noise");
    let dark: Vec<Band> = (0..6).map(|_| Band { gray: vec![20; w * h], width: w, height: h }).collect();
    assert!(detect(&f, &dark, 1080).is_none(), "dark");
    assert!(detect(&f, &[], 1080).is_none(), "no samples");
}

#[test]
fn a_size_a_percent_off_is_still_found() {
    // a window that is 1445 px tall instead of 1440, stored at 1080: font pixel 3 * 1080 / 1445
    let f = font();
    let ratio = 1080.0 / 1445.0;
    let got = detect(&f, &samples(&f, 3, ratio), 1080).expect("found");
    assert!(close(got.glyph, 3.0 * ratio) || close(got.glyph, 2.25), "{}", got.glyph);
}

#[test]
fn resampling_keeps_the_mean_and_gives_the_asked_size() {
    let g = vec![100u8; 40 * 10];
    for (ow, oh) in [(30usize, 8usize), (80, 20), (40, 10), (53, 13)] {
        let r = resample(&g, 40, 10, ow, oh);
        assert_eq!(r.len(), ow * oh);
        assert!(r.iter().all(|&p| (99..=101).contains(&p)), "a flat image stays flat at {ow}x{oh}");
    }
    // a hard edge stays an edge: left half dark, right half bright
    let mut e = vec![0u8; 40 * 4];
    for y in 0..4 {
        for x in 20..40 {
            e[y * 40 + x] = 200;
        }
    }
    let r = resample(&e, 40, 4, 80, 8);
    assert!(r[0] < 10 && r[79] > 190 && r[39] < 60 && r[40] > 140);
}

#[test]
fn the_crop_and_resample_sizes_make_the_readers_1500_by_40_frame() {
    // (font pixel size, video size) -> (crop w, crop h, out w, out h)
    assert_eq!(geometry(3.0, 2560, 1440), (1500, 40, 1500, 40), "whole 3 px font pixels need no resample");
    // ffmpeg's scaler pads an odd input width to even, which stretches the picture by a pixel across the band and moves
    // every glyph off the grid the reader searches: the crop is always even (measured: 1125 shifted the label 1 px)
    assert_eq!(geometry(2.25, 1920, 1080), (1126, 30, 1501, 40), "a 1440p game in a 1080p file");
    assert_eq!(geometry(1.5, 1280, 720), (750, 20, 1500, 40));
    let (cw, ch, ow, oh) = geometry(6.0, 3840, 2160);
    assert_eq!((cw, ch), (3000, 80), "a 4K game at scale 6 reads from the larger crop");
    assert_eq!((ow, oh), (1500, 40));
    // a video smaller than the wanted crop is not read outside itself
    let (cw, ch, _, _) = geometry(2.0, 800, 20);
    assert!(cw <= 800 && ch <= 20);
    for (g, w, h) in [(2.25, 1920usize, 1080usize), (1.7, 1280, 720), (2.3, 1921, 1081), (2.0, 1919, 1079)] {
        let (cw, ch, _, _) = geometry(g, w, h);
        assert!(cw % 2 == 0 && ch % 2 == 0 || cw == w || ch == h, "even crop for {g} in {w}x{h}: {cw}x{ch}");
    }
}

#[test]
fn the_size_and_length_come_out_of_ffmpegs_banner() {
    let banner = "Input #0, matroska,webm, from 'x.mkv':
  Duration: 00:12:34.56, start: 0.000000, bitrate: 21000 kb/s
  Stream #0:0: Video: av1 (libdav1d) (Main), yuv420p(tv, bt709), 1920x1080 [SAR 1:1 DAR 16:9], 60 fps, 60 tbr, 1k tbn
  Stream #0:1: Audio: opus, 48000 Hz, stereo, fltp
";
    let (w, h, secs) = parse_probe(banner).expect("parsed");
    assert_eq!((w, h), (1920, 1080));
    assert!((secs - 754.56).abs() < 1e-6, "{secs}");
    assert!(parse_probe("nothing useful").is_none());
    assert!(parse_probe("Duration: N/A, start: 0
  Stream #0:0: Video: h264, 1280x720").is_none(), "an unknown length cannot be sampled");
    // a hex-looking number before the size must not be taken for it (the codec tag 0x31637661, a 0x1 profile)
    let tagged = "  Duration: 00:00:10.00, start: 0
  Stream #0:0: Video: h264 (High) (avc1 / 0x31637661), yuv420p, 1280x720, 30 fps
";
    assert_eq!(parse_probe(tagged).map(|p| (p.0, p.1)), Some((1280, 720)));
}
