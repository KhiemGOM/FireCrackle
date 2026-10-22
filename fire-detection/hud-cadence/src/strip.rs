//! The frame-ID sync strip drawn by mod-hud and mod-gui ("gui-v1"): 128 Manchester cells of 2×3 GUI pixels at the
//! top left, encoding a 16-bit preamble 0xD3A5, the 32-bit renderer frame ID and CRC-16/CCITT-FALSE, MSB first.
//! Cell 2k is the bit, cell 2k+1 its complement (white = 1).

pub const CELLS: usize = 128;
pub const PREAMBLE: u16 = 0xd3a5;
/// Strip width in video pixels at a GUI scale.
pub const fn width(scale: usize) -> usize {
    2 * CELLS * scale
}

pub fn crc(frame: u32) -> u16 {
    let mut crc: u32 = 0xffff;
    for shift in [24, 16, 8, 0] {
        crc ^= ((frame >> shift) & 255) << 8;
        for _ in 0..8 {
            crc = if crc & 0x8000 != 0 { (crc << 1) ^ 0x1021 } else { crc << 1 } & 0xffff;
        }
    }
    crc as u16
}

/// Whether cell `cell` is white for renderer frame `frame` (the encoder, for tests and documentation).
pub fn white(frame: u32, cell: usize) -> bool {
    let bit = cell / 2;
    let value = if bit < 16 {
        (PREAMBLE >> (15 - bit)) & 1 != 0
    } else if bit < 48 {
        (frame >> (47 - bit)) & 1 != 0
    } else {
        (crc(frame) >> (63 - bit)) & 1 != 0
    };
    if cell % 2 == 0 {
        value
    } else {
        !value
    }
}

/// GUI row of mod-hud's strip (below the overlay box); mod-gui draws its strip at row 0.
pub const HUD_STRIP_Y: usize = 11;

/// Decodes the strip from a grey image of width `width`, with the strip's top-left at video (`x0`, `y0`)
/// (mod-gui: (0, 0); mod-hud: `x0 = width - 256 * scale`, `y0 = 11 * scale`). Each GUI pixel is `scale` video
/// pixels. Samples the centre of each cell, checks Manchester polarity, preamble and CRC. Returns the renderer
/// frame ID, or None when any check fails (a frame without a strip, or a torn frame).
pub fn decode(gray: &[u8], width: usize, scale: usize, x0: usize, y0: usize) -> Option<u32> {
    let (cell_w, cell_h) = (2 * scale, 3 * scale);
    if x0 + CELLS * cell_w > width || gray.len() < (y0 + cell_h) * width {
        return None;
    }
    let y = y0 + cell_h / 2;
    let sample = |cell: usize| gray[y * width + x0 + cell * cell_w + cell_w / 2] > 128;
    let mut bits = [false; 64];
    for (k, bit) in bits.iter_mut().enumerate() {
        let (a, b) = (sample(2 * k), sample(2 * k + 1));
        if a == b {
            return None;
        }
        *bit = a;
    }
    let value = |range: std::ops::Range<usize>| bits[range].iter().fold(0u64, |acc, &b| (acc << 1) | b as u64);
    if value(0..16) as u16 != PREAMBLE {
        return None;
    }
    let frame = value(16..48) as u32;
    (value(48..64) as u16 == crc(frame)).then_some(frame)
}
