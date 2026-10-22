//! Test plan: the Rust decoder must read exactly what the Java encoder draws (same CRC, same bit order); a frame
//! without a strip (uniform or random pixels) must decode to None rather than a wrong ID; a single flipped cell
//! must be caught (Manchester polarity or CRC); compressed grey levels near the threshold must still decode;
//! the scale must be respected (a scale-3 strip read as scale 2 is None).
use hud_cadence::strip::{crc, decode, white, width, CELLS, HUD_STRIP_Y};

fn draw_at(frame: u32, scale: usize, width: usize, x0: usize, y0: usize, on: u8, off: u8) -> Vec<u8> {
    let mut g = vec![40u8; width * 64];
    for cell in 0..CELLS {
        let v = if white(frame, cell) { on } else { off };
        for y in 0..3 * scale {
            for x in 0..2 * scale {
                g[(y0 + y) * width + x0 + cell * 2 * scale + x] = v;
            }
        }
    }
    g
}
fn draw(frame: u32, scale: usize, width: usize, on: u8, off: u8) -> Vec<u8> {
    draw_at(frame, scale, width, 0, 0, on, off)
}

#[test]
fn crc_matches_ccitt_false_test_vectors() {
    assert_eq!(crc(0), 0x84c0);
    assert_eq!(crc(0x31323334), 0x5349);
}

#[test]
fn round_trips_ids_at_scale_3_and_4() {
    for scale in [3, 4] {
        for id in [0u32, 1, 42, 65535, 0xdeadbeef, 0xffffffff] {
            let g = draw(id, scale, 1500, 255, 0);
            assert_eq!(decode(&g, 1500, scale, 0, 0), Some(id), "id {id} scale {scale}");
        }
    }
}

#[test]
fn soft_grey_levels_still_decode_and_no_strip_is_none() {
    let g = draw(777, 3, 1500, 160, 90);
    assert_eq!(decode(&g, 1500, 3, 0, 0), Some(777));
    assert_eq!(decode(&vec![40u8; 1500 * 64], 1500, 3, 0, 0), None);
    let noise: Vec<u8> = (0..1500 * 64).map(|i| ((i * 7919) % 251) as u8).collect();
    assert_eq!(decode(&noise, 1500, 3, 0, 0), None);
}

#[test]
fn a_flipped_cell_or_the_wrong_scale_is_rejected() {
    let mut g = draw(4242, 3, 1500, 255, 0);
    let cell = 40; // inside the ID field
    for y in 0..9 {
        for x in 0..6 {
            let i = y * 1500 + cell * 6 + x;
            g[i] = 255 - g[i];
        }
    }
    assert_eq!(decode(&g, 1500, 3, 0, 0), None);
    let g = draw(4242, 3, 1500, 255, 0);
    assert_eq!(decode(&g, 1500, 2, 0, 0), None);
}

#[test]
fn the_hud_strip_decodes_from_its_right_edge_offset_and_row_and_nowhere_else() {
    // mod-hud: 2560-wide video at scale 3, strip at x0 = 2560 - 768, y0 = 11 * 3
    let (x0, y0) = (2560 - width(3), HUD_STRIP_Y * 3);
    let g = draw_at(99, 3, 2560, x0, y0, 255, 0);
    assert_eq!(decode(&g, 2560, 3, x0, y0), Some(99));
    assert_eq!(decode(&g, 2560, 3, x0, 0), None);
    assert_eq!(decode(&g, 2560, 3, 0, y0), None);
    assert_eq!(decode(&g, 2560, 3, 2560 - 100, y0), None); // would run past the right edge
    assert_eq!(decode(&g, 2560, 3, x0, 60), None); // would run past the bottom of the image
}
