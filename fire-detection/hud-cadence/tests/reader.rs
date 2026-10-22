//! Test plan. Ways this can break: wrong glyph cell lookup (off-by-one row/col in ascii.png); wrong advance
//! (digits are 5 wide + 1 gap); the shadow (+1,+1 font px, dark) must not match; the overlay x-position moves
//! when earlier fields change width, so the anchor must be found, not assumed; a missing overlay must read
//! as None, not garbage; a non-digit after the number must stop the read; a 2-, 3- and 4-digit value must
//! all read; compressed edges (grey ramp pixels) must still binarize to the same glyph.
use hud_cadence::font::{glyph, render, Font};
use hud_cadence::reader::{read_strip, Reading};

fn font() -> Font {
    Font::load(include_bytes!("../assets/ascii.png")).unwrap()
}

#[test]
fn digits_are_five_wide_and_seven_tall_in_the_vanilla_font() {
    let f = font();
    for d in b'0'..=b'9' {
        let g = glyph(&f, d as char);
        assert_eq!(g.width, 5, "{}", d as char);
        assert!(g.rows[7].iter().all(|&p| !p), "row 7 of a digit is empty");
    }
    let one = glyph(&f, '1');
    assert_eq!(&one.rows[0][..5], &[false, false, true, false, false]);
    assert_eq!(&one.rows[6][..5], &[true, true, true, true, true]);
    assert_eq!(glyph(&f, ' ').width, 3);
}

#[test]
fn rendering_scales_each_font_pixel_to_a_scale_square_with_one_gap_column() {
    let f = font();
    let img = render(&f, "12", 3);
    // '1' (5) + gap (1) + '2' (5) + gap (1) = 12 font px = 36 video px, 8 font rows = 24 px
    assert_eq!((img.width, img.height), (36, 24));
    assert!(img.get(2 * 3, 0) && img.get(2 * 3 + 2, 2) && !img.get(5 * 3, 0));
}

/// A synthetic top strip: dark background, the text "XYZ: 1 / 2 | FPS: 146" at scale 3 with a shadow, at a given x.
fn strip(f: &Font, text: &str, x0: usize, scale: usize, shadow: bool) -> (Vec<u8>, usize, usize) {
    let (w, h) = (1500, 40);
    let mut g = vec![40u8; w * h];
    let img = render(f, text, scale);
    let (y0, s) = (6, scale);
    if shadow {
        for y in 0..img.height {
            for x in 0..img.width {
                if img.get(x, y) {
                    g[(y0 + s + y) * w + x0 + s + x] = 60;
                }
            }
        }
    }
    for y in 0..img.height {
        for x in 0..img.width {
            if img.get(x, y) {
                g[(y0 + y) * w + x0 + x] = 220;
            }
        }
    }
    (g, w, h)
}

#[test]
fn reads_two_three_and_four_digit_values_wherever_the_anchor_sits() {
    let f = font();
    for (text, want) in [("XYZ: 10 | FPS: 60", "60"), ("XYZ: -1000.5 | FPS: 146", "146"), ("FPS: 1234 | T", "1234")] {
        for x0 in [0usize, 123, 1000] {
            let (g, w, h) = strip(&f, text, x0, 3, true);
            let r = read_strip(&f, &g, w, h, 3, None).unwrap_or_else(|| panic!("{text} at {x0}"));
            assert_eq!(r.value, want, "{text} at {x0}");
            assert_eq!(r.anchor.1, 6);
        }
    }
}

#[test]
fn a_frame_without_the_overlay_reads_none_and_a_tracked_anchor_is_retried_from_scratch() {
    let f = font();
    let g = vec![40u8; 1500 * 40];
    assert!(read_strip(&f, &g, 1500, 40, 3, None).is_none());
    let (g2, w, h) = strip(&f, "FPS: 77", 300, 3, true);
    assert_eq!(read_strip(&f, &g2, w, h, 3, Some((900, 6))).unwrap().value, "77");
}

#[test]
fn soft_compressed_edges_still_read_the_same_digits() {
    let f = font();
    let (mut g, w, h) = strip(&f, "FPS: 146", 500, 3, true);
    // dim every other glyph pixel to a mid-grey ramp as a video encoder would
    for (i, p) in g.iter_mut().enumerate() {
        if *p == 220 && i % 2 == 0 {
            *p = 185;
        }
    }
    assert_eq!(read_strip(&f, &g, w, h, 3, None).unwrap().value, "146");
}

#[test]
fn reading_is_exposed_with_per_digit_mismatch_counts() {
    let f = font();
    let (g, w, h) = strip(&f, "FPS: 90", 10, 3, false);
    let Reading { value, mismatches, .. } = read_strip(&f, &g, w, h, 3, None).unwrap();
    assert_eq!(value, "90");
    assert_eq!(mismatches, vec![0, 0]);
}
