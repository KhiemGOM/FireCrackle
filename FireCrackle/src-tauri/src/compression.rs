//! Real temporal H.264 round trip for a projected 32-row fire cycle.
//! Inputs are full-size white-background PNGs; only the frontend's fire alpha is displayed.
use std::{ffi::OsStr, process::Command};
use studio_core::fsutil::ScratchDir;

fn validate(width: u32, height: u32, frames: &[Vec<u8>], crf: u8) -> Result<(), String> {
    if width == 0
        || height == 0
        || width > 4096
        || height > 4096
        || u64::from(width) * u64::from(height) > 8_847_360
        || frames.len() != 32
        || !(16..=45).contains(&crf)
    {
        return Err("Invalid compression dimensions, cycle length or CRF".into());
    }
    if frames.iter().map(Vec::len).sum::<usize>() > 96 * 1024 * 1024 {
        return Err("Compression input too large".into());
    }
    for png in frames {
        if png.len() < 33
            || png[..8] != *b"\x89PNG\r\n\x1a\n"
            || png[12..16] != *b"IHDR"
            || png[16..20] != width.to_be_bytes()
            || png[20..24] != height.to_be_bytes()
        {
            return Err("Compression frames must be PNGs at the selected resolution".into());
        }
    }
    Ok(())
}

fn run(command: &mut Command) -> Result<(), String> {
    let out = command
        .output()
        .map_err(|e| format!("Could not run FFmpeg: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "FFmpeg compression failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    Ok(())
}

pub fn encode(
    ffmpeg: &OsStr,
    width: u32,
    height: u32,
    frames: Vec<Vec<u8>>,
    crf: u8,
) -> Result<Vec<u8>, String> {
    validate(width, height, &frames, crf)?;
    let dir = ScratchDir::new("codec").map_err(|e| e.to_string())?;
    for (row, png) in frames.iter().enumerate() {
        std::fs::write(dir.0.join(format!("in{row:02}.png")), png).map_err(|e| e.to_string())?;
    }
    let video = dir.0.join("cycle.mkv");
    // 20 animation rows/sec -> 60 video frames/sec (three holds per row).
    // Pad odd dimensions for 4:2:0, without moving the fire or changing pixel scale.
    run(studio_core::proc::hidden_command(ffmpeg)
        .args([
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-framerate",
            "20",
            "-i",
        ])
        .arg(dir.0.join("in%02d.png"))
        .args([
            "-vf",
            "fps=60,pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0:white",
            "-frames:v",
            "96",
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
        ])
        .arg(crf.to_string())
        .args([
            "-pix_fmt", "yuv420p", "-g", "96", "-bf", "2", "-threads", "2",
        ])
        .arg(&video))?;
    // Decode the middle held frame for each animation row, preserving I/P/B effects.
    run(studio_core::proc::hidden_command(ffmpeg)
        .args(["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i"])
        .arg(&video)
        .args([
            "-vf",
            &format!("select=eq(mod(n\\,3)\\,1),crop={width}:{height}:0:0:exact=1"),
        ])
        .args(studio_core::import::variable_frame_rate_args(ffmpeg))
        .args(["-frames:v", "32", "-start_number", "0", "-threads", "2"])
        .arg(dir.0.join("out%02d.png")))?;
    let mut packed = Vec::new();
    for row in 0..32 {
        let png = std::fs::read(dir.0.join(format!("out{row:02}.png")))
            .map_err(|e| format!("Missing decoded fire row {row}: {e}"))?;
        packed.extend_from_slice(&(png.len() as u32).to_le_bytes());
        packed.extend(png);
    }
    Ok(packed)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_incomplete_or_mismatched_cycles() {
        assert!(validate(1920, 1080, &[], 28).is_err());
        assert!(validate(1920, 1080, &vec![vec![0; 33]; 32], 28).is_err());
        assert!(validate(100_000, 1080, &vec![vec![]; 32], 28).is_err());
    }
    /// Optional real encoder smoke test; set FIRECRACKLE_TEST_FFMPEG to a local executable.
    #[test]
    fn real_temporal_roundtrip() {
        let Some(ffmpeg) = std::env::var_os("FIRECRACKLE_TEST_FFMPEG") else {
            return;
        };
        let dir = ScratchDir::new("codec").unwrap();
        let input = if let Some(path) = std::env::var_os("FIRECRACKLE_TEST_INPUT") {
            std::path::PathBuf::from(path)
        } else {
            run(studio_core::proc::hidden_command(&ffmpeg)
                .args([
                    "-nostdin",
                    "-v",
                    "error",
                    "-y",
                    "-f",
                    "lavfi",
                    "-i",
                    "testsrc2=size=64x64:rate=20:duration=1.6",
                    "-frames:v",
                    "32",
                    "-threads",
                    "1",
                    "-start_number",
                    "0",
                ])
                .arg(dir.0.join("row%02d.png")))
            .unwrap();
            dir.0.clone()
        };
        let frames = (0..32)
            .map(|row| std::fs::read(input.join(format!("row{row:02}.png"))).unwrap())
            .collect::<Vec<_>>();
        let width = u32::from_be_bytes(frames[0][16..20].try_into().unwrap());
        let height = u32::from_be_bytes(frames[0][20..24].try_into().unwrap());
        let original = frames[10].clone();
        let bytes = encode(&ffmpeg, width, height, frames, 36).unwrap();
        let mut offset = 0;
        for row in 0..32 {
            let len = u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
            let png = &bytes[offset + 4..offset + 4 + len];
            assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
            assert_eq!(u32::from_be_bytes(png[16..20].try_into().unwrap()), width);
            assert_eq!(u32::from_be_bytes(png[20..24].try_into().unwrap()), height);
            if row == 10 {
                assert_ne!(png, original);
            }
            offset += 4 + len;
        }
        assert_eq!(offset, bytes.len());
    }
}
