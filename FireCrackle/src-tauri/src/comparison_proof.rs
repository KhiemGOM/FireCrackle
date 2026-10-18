use std::{
    ffi::OsStr,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
#[cfg(windows)]
use tauri::Manager;
use tauri_plugin_clipboard_manager::ClipboardExt;

static NEXT: AtomicU64 = AtomicU64::new(0);
struct Scratch(PathBuf);
impl Scratch {
    fn new() -> Result<Self, String> {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "firecrackle-proof-{}-{stamp}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir(&path).map_err(|e| e.to_string())?;
        Ok(Self(path))
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn decode(png: &[u8]) -> Result<tauri::image::Image<'static>, String> {
    if png.len() < 24 || png.len() > 128 * 1024 * 1024 || !png.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("Invalid or oversized comparison PNG.".into());
    }
    let width = u32::from_be_bytes(png[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(png[20..24].try_into().unwrap());
    if width == 0
        || height == 0
        || width > 16384
        || height > 16384
        || u64::from(width) * u64::from(height) > 64_000_000
    {
        return Err("Invalid or oversized comparison dimensions.".into());
    }
    tauri::image::Image::from_bytes(png).map_err(|e| format!("Could not read comparison PNG: {e}"))
}

#[tauri::command]
pub async fn copy_comparison_proof(app: tauri::AppHandle, png: Vec<u8>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let image = decode(&png)?;
        app.clipboard()
            .write_image(&image)
            .map_err(|e| format!("Could not copy comparison image: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn encode(
    ffmpeg: &OsStr,
    png: &[u8],
    base: Option<&[u8]>,
    format: &str,
) -> Result<Vec<u8>, String> {
    if !["png", "jpeg", "gif", "webp"].contains(&format) {
        return Err("Unsupported comparison format.".into());
    }
    let image = decode(png)?;
    if format == "png" {
        return Ok(png.to_vec());
    }
    let animated = matches!(format, "gif" | "webp");
    if animated {
        if image.width() > 2048 || image.height() > 2048 {
            return Err("Animated comparison is too large.".into());
        }
        let before = decode(base.ok_or("Missing original comparison picture.")?)?;
        if (before.width(), before.height()) != (image.width(), image.height()) {
            return Err("Comparison pictures have different dimensions.".into());
        }
    }
    let dir = Scratch::new()?;
    let after = dir.0.join("after.png");
    std::fs::write(&after, png).map_err(|e| e.to_string())?;
    let output = dir.0.join(format!(
        "proof.{}",
        if format == "jpeg" { "jpg" } else { format }
    ));
    let mut command = crate::external_tools::command(ffmpeg);
    command.args([
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-filter_complex_threads",
        "1",
    ]);
    if animated {
        let before = dir.0.join("before.png");
        std::fs::write(&before, base.unwrap()).map_err(|e| e.to_string())?;
        command
            .args(["-loop", "1", "-framerate", "25", "-i"])
            .arg(before)
            .args(["-loop", "1", "-framerate", "25", "-i"])
            .arg(after);
        // Compute easing once per frame, not millions of times per frame in all_expr.
        // Normal blend uses its optimized pixel routines; opacity 1 means original A.
        let blend = animation_filter();
        if format == "gif" {
            command.args(["-filter_complex", &format!("{blend},split[a][b];[a]palettegen=stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a"), "-loop", "0"]);
        } else {
            command.args([
                "-filter_complex",
                &blend,
                "-c:v",
                "libwebp_anim",
                "-lossless",
                "1",
                "-compression_level",
                "0", // Fast lossless encoding: lower effort, no reduction in image fidelity.
                "-loop",
                "0",
            ]);
        }
        command.args(["-frames:v", "64"]);
    } else {
        command
            .arg("-i")
            .arg(after)
            .args(["-frames:v", "1", "-q:v", "2"]);
    }
    let result = command
        .args(["-threads", "2"])
        .arg(&output)
        .output()
        .map_err(|e| format!("Could not run comparison encoder: {e}"))?;
    if !result.status.success() {
        return Err(format!(
            "Could not encode comparison proof: {}",
            String::from_utf8_lossy(&result.stderr)
        ));
    }
    std::fs::read(output).map_err(|e| e.to_string())
}

fn animation_filter() -> String {
    // 64 frames / 25 Hz = 2.56 s, cosine easing with short endpoint holds.
    let commands = (0..64)
        .map(|frame| {
            let weight = (0.5 - 0.6 * (std::f64::consts::TAU * f64::from(frame) / 64.0).cos())
                .clamp(0.0, 1.0);
            format!(
                "{:.3} blend all_opacity {:.9}",
                f64::from(frame) / 25.0,
                1.0 - weight
            )
        })
        .collect::<Vec<_>>()
        .join(";");
    // Extra blend precision prevents one-level rounding flicker in unchanged picture/text pixels.
    format!(
        "[0:v]format=gbrp16le,sendcmd=c='{commands}'[original];[1:v]format=gbrp16le[after];[original][after]blend=all_mode=normal:all_opacity=1,trim=end_frame=64,format=rgb24"
    )
}

#[tauri::command]
pub async fn save_comparison_proof(
    path: String,
    format: String,
    png: Vec<u8>,
    base: Option<Vec<u8>>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !Path::new(&path).is_absolute() {
            return Err("Choose an absolute save path.".into());
        }
        let bytes = if format == "png" {
            decode(&png)?;
            png
        } else {
            encode(
                &crate::external_tools::video_tools()?.ffmpeg,
                &png,
                base.as_deref(),
                &format,
            )?
        };
        // Encode completely before replacing a user-selected destination.
        std::fs::write(path, bytes).map_err(|e| format!("Could not save comparison proof: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(windows)]
fn file_drop_payload(path: &Path) -> Vec<u8> {
    use std::os::windows::ffi::OsStrExt;
    // DROPFILES followed by a double-NUL-terminated UTF-16 file list (CF_HDROP).
    let mut bytes = Vec::new();
    for field in [20_u32, 0, 0, 0, 1] {
        bytes.extend_from_slice(&field.to_le_bytes());
    }
    for unit in path.as_os_str().encode_wide().chain([0, 0]) {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    bytes
}

#[cfg(windows)]
fn copy_file(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    use std::ffi::c_void;
    #[link(name = "user32")]
    unsafe extern "system" {
        fn OpenClipboard(owner: *mut c_void) -> i32;
        fn CloseClipboard() -> i32;
        fn EmptyClipboard() -> i32;
        fn SetClipboardData(format: u32, data: *mut c_void) -> *mut c_void;
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GlobalAlloc(flags: u32, size: usize) -> *mut c_void;
        fn GlobalLock(memory: *mut c_void) -> *mut c_void;
        fn GlobalUnlock(memory: *mut c_void) -> i32;
        fn GlobalFree(memory: *mut c_void) -> *mut c_void;
    }
    let payload = file_drop_payload(path);
    let owner = app
        .get_webview_window("main")
        .ok_or("Main window unavailable.")?
        .hwnd()
        .map_err(|e| e.to_string())?;
    // Windows owns the movable allocation only after SetClipboardData succeeds.
    unsafe {
        let memory = GlobalAlloc(0x0042, payload.len());
        if memory.is_null() {
            return Err("Could not allocate clipboard data.".into());
        }
        let target = GlobalLock(memory);
        if target.is_null() {
            GlobalFree(memory);
            return Err("Could not prepare clipboard data.".into());
        }
        std::ptr::copy_nonoverlapping(payload.as_ptr(), target.cast::<u8>(), payload.len());
        GlobalUnlock(memory);
        if OpenClipboard(owner.0) == 0 {
            GlobalFree(memory);
            return Err("Clipboard is busy. Try copying again.".into());
        }
        let success = EmptyClipboard() != 0 && !SetClipboardData(15, memory).is_null();
        CloseClipboard();
        if !success {
            GlobalFree(memory);
            return Err("Could not copy the comparison file.".into());
        }
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn copy_file(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    let uri = tauri::Url::from_file_path(path)
        .map_err(|_| "Invalid clipboard file path.")?
        .to_string();
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let clipboard = gtk::Clipboard::get(&gtk::gdk::SELECTION_CLIPBOARD);
        let targets = [
            gtk::TargetEntry::new("text/uri-list", gtk::TargetFlags::empty(), 0),
            gtk::TargetEntry::new("x-special/gnome-copied-files", gtk::TargetFlags::empty(), 1),
        ];
        let success = clipboard.set_with_data(&targets, move |_, selection, info| {
            if info == 0 {
                selection.set_uris(&[&uri]);
            } else {
                selection.set(
                    &gtk::gdk::Atom::intern("x-special/gnome-copied-files"),
                    8,
                    format!("copy\n{uri}").as_bytes(),
                );
            }
        });
        let _ = sender.send(if success {
            Ok(())
        } else {
            Err("Could not copy the comparison file.".into())
        });
    })
    .map_err(|e| e.to_string())?;
    receiver.recv().map_err(|e| e.to_string())?
}

#[cfg(not(any(windows, target_os = "linux")))]
fn copy_file(_app: &tauri::AppHandle, _path: &Path) -> Result<(), String> {
    Err(
        "Animated/file copying is not available on this platform. Use the save icon, or copy PNG."
            .into(),
    )
}

#[tauri::command]
pub async fn copy_formatted_comparison_proof(
    app: tauri::AppHandle,
    format: String,
    png: Vec<u8>,
    base: Option<Vec<u8>>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = encode(
            &crate::external_tools::video_tools()?.ffmpeg,
            &png,
            base.as_deref(),
            &format,
        )?;
        use sha2::{Digest, Sha256};
        let digest = format!("{:x}", Sha256::digest(&bytes));
        // Keep the file after the command returns: recipients read it when the user pastes.
        let root = std::env::temp_dir().join("firecrackle-proof-clipboard");
        std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        let path = root.join(format!(
            "comparison-proof-{}.{}",
            &digest[..16],
            if format == "jpeg" { "jpg" } else { &format }
        ));
        std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
        copy_file(&app, &path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fade_is_scheduled_per_frame_without_a_per_pixel_expression() {
        let filter = animation_filter();
        assert!(!filter.contains("all_expr"));
        assert_eq!(filter.matches("blend all_opacity").count(), 64);
        assert!(filter.contains("0.000 blend all_opacity 1.000000000"));
        assert!(filter.contains("1.280 blend all_opacity 0.000000000"));
        assert!(filter.contains("2.520 blend all_opacity 1.000000000"));
    }

    #[test]
    #[ignore = "requires FIRECRACKLE_TEST_FFMPEG and FIRECRACKLE_PROOF_BENCH fixture directory"]
    fn benchmark_real_size_animation() {
        let root = PathBuf::from(
            std::env::var_os("FIRECRACKLE_PROOF_BENCH").expect("Set FIRECRACKLE_PROOF_BENCH"),
        );
        let ffmpeg =
            std::env::var_os("FIRECRACKLE_TEST_FFMPEG").expect("Set FIRECRACKLE_TEST_FFMPEG");
        let before = std::fs::read(root.join("before.png")).unwrap();
        let after = std::fs::read(root.join("after.png")).unwrap();
        for format in ["webp", "gif"] {
            let started = std::time::Instant::now();
            let output = encode(&ffmpeg, &after, Some(&before), format).unwrap();
            eprintln!(
                "1288x766 {format}: {:.3}s, {} bytes",
                started.elapsed().as_secs_f64(),
                output.len()
            );
            std::fs::write(root.join(format!("native-fast.{format}")), output).unwrap();
        }
    }

    #[cfg(windows)]
    #[test]
    fn clipboard_file_list_is_unicode_and_double_nul_terminated() {
        let path = Path::new("C:\\proofs\\fire-🔥.webp");
        let data = file_drop_payload(path);
        assert_eq!(&data[..4], &20_u32.to_le_bytes());
        assert_eq!(&data[16..20], &1_u32.to_le_bytes());
        let wide: Vec<u16> = data[20..]
            .chunks_exact(2)
            .map(|b| u16::from_le_bytes([b[0], b[1]]))
            .collect();
        assert_eq!(&wide[wide.len() - 2..], &[0, 0]);
        assert_eq!(
            String::from_utf16(&wide[..wide.len() - 2]).unwrap(),
            path.to_str().unwrap()
        );
    }

    #[test]
    fn rejects_missing_or_mismatched_animation_inputs_and_unknown_formats() {
        let png = include_bytes!("../icons/32x32.png");
        assert!(
            encode(OsStr::new("unused"), png, None, "gif")
                .unwrap_err()
                .contains("Missing original")
        );
        assert!(
            encode(
                OsStr::new("unused"),
                png,
                Some(include_bytes!("../icons/128x128.png")),
                "webp"
            )
            .unwrap_err()
            .contains("different dimensions")
        );
        assert!(encode(OsStr::new("unused"), png, None, "exe").is_err());
        assert_eq!(encode(OsStr::new("unused"), png, None, "png").unwrap(), png);
    }

    #[test]
    #[ignore = "requires FIRECRACKLE_TEST_FFMPEG; exercises real GIF/WebP/JPEG encoding"]
    fn animated_formats_encode_real_fading_loops() {
        let ffmpeg =
            std::env::var_os("FIRECRACKLE_TEST_FFMPEG").expect("Set FIRECRACKLE_TEST_FFMPEG");
        let dir = Scratch::new().unwrap();
        let mut inputs = Vec::new();
        for (name, extra) in [
            ("base", ""),
            ("after", ",drawbox=x=16:y=0:w=16:h=28:color=white:t=fill"),
        ] {
            let path = dir.0.join(format!("{name}.png"));
            let filter =
                format!("color=black:s=32x32,drawbox=x=0:y=28:w=32:h=4:color=red:t=fill{extra}");
            let result = crate::external_tools::command(&ffmpeg)
                .args([
                    "-nostdin",
                    "-v",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    &filter,
                    "-frames:v",
                    "1",
                ])
                .arg(&path)
                .output()
                .unwrap();
            assert!(
                result.status.success(),
                "{}",
                String::from_utf8_lossy(&result.stderr)
            );
            inputs.push(std::fs::read(path).unwrap());
        }
        for format in ["gif", "webp", "jpeg"] {
            let bytes = encode(&ffmpeg, &inputs[1], Some(&inputs[0]), format).unwrap();
            let output = dir.0.join(format!("proof.{format}"));
            std::fs::write(&output, &bytes).unwrap();
            if let Some(root) = std::env::var_os("FIRECRACKLE_PROOF_TEST_OUTPUT") {
                std::fs::create_dir_all(&root).unwrap();
                std::fs::write(Path::new(&root).join(format!("proof.{format}")), &bytes).unwrap();
            }
            match format {
                "gif" => {
                    assert!(bytes.starts_with(b"GIF89a"));
                    assert!(bytes.windows(11).any(|b| b == b"NETSCAPE2.0"));
                    let decoded = crate::external_tools::command(&ffmpeg)
                        .args(["-nostdin", "-v", "error", "-i"])
                        .arg(output)
                        .args(["-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
                        .output()
                        .unwrap();
                    assert!(decoded.status.success());
                    assert_eq!(decoded.stdout.len(), 64 * 32 * 32 * 3);
                    let at = |frame: usize, x: usize, y: usize| {
                        decoded.stdout[(frame * 32 * 32 + y * 32 + x) * 3]
                    };
                    assert!(at(0, 24, 8) < 5 && at(32, 24, 8) > 245 && at(63, 24, 8) < 5);
                    assert!(at(16, 24, 8) > 30 && at(16, 24, 8) < 230);
                    for frame in 0..64 {
                        assert!(at(frame, 4, 8) < 5 && at(frame, 4, 30) > 240);
                    }
                }
                "webp" => {
                    assert_eq!(&bytes[0..4], b"RIFF");
                    assert_eq!(&bytes[8..12], b"WEBP");
                    let mut offset = 12;
                    let mut frames = 0;
                    let mut duration = 0;
                    while offset + 8 <= bytes.len() {
                        let size =
                            u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap())
                                as usize;
                        let data = &bytes[offset + 8..offset + 8 + size];
                        if &bytes[offset..offset + 4] == b"ANIM" {
                            assert_eq!(&data[4..6], &[0, 0]);
                        }
                        if &bytes[offset..offset + 4] == b"ANMF" {
                            frames += 1;
                            duration += u32::from_le_bytes([data[12], data[13], data[14], 0]);
                        }
                        offset += 8 + size + size % 2;
                    }
                    assert!(frames > 16);
                    assert_eq!(duration, 2560);
                }
                _ => assert!(bytes.starts_with(&[0xff, 0xd8, 0xff])),
            }
        }
    }

    #[test]
    fn decodes_png_to_clipboard_pixels_and_rejects_invalid_data() {
        let png = include_bytes!("../icons/32x32.png");
        let image = decode(png).unwrap();
        assert_eq!((image.width(), image.height()), (32, 32));
        assert_eq!(image.rgba().len(), 32 * 32 * 4);
        assert!(decode(b"not an image").is_err());
        let mut oversized = png.to_vec();
        oversized[16..20].copy_from_slice(&u32::MAX.to_be_bytes());
        assert!(decode(&oversized).is_err());
    }
}
