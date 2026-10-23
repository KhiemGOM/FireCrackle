//! GUI mask commands. Vanilla-GUI compatibility is a documented assumption; detection still
//! reports unreliable fits. Legacy answer commands remain for project/API compatibility.

use super::{AppState, err, run};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use studio_core::gui::{GuiAnalyzer, GuiAnswer, GuiMaskReply, read_answer, write_answer};
use tauri::State;
use tauri::ipc::Response;

/// The last mask, so the overlay pixels need not be computed twice: project folder, frame, packed pixels.
static LAST: Mutex<Option<(PathBuf, u32, Vec<u8>)>> = Mutex::new(None);

pub(crate) fn analyzer() -> Result<&'static GuiAnalyzer, String> {
    static A: OnceLock<Result<GuiAnalyzer, String>> = OnceLock::new();
    A.get_or_init(GuiAnalyzer::new)
        .as_ref()
        .map_err(|e| e.clone())
}

#[tauri::command]
pub async fn gui_answer_get(state: State<'_, AppState>) -> Result<Option<GuiAnswer>, String> {
    run(state.ws.clone(), |w| Ok(read_answer(w.dir()))).await
}

#[tauri::command]
pub async fn gui_answer_set(state: State<'_, AppState>, answer: GuiAnswer) -> Result<(), String> {
    run(state.ws.clone(), move |w| write_answer(w.dir(), answer)).await
}

/// Metadata and pixels are returned from the same analysis, without a shared
/// "last mask" lookup that another frame can replace between IPC requests.
#[tauri::command]
/// `width`: the mask of that cached preview picture (the gallery's), instead of the display frame.
pub async fn gui_mask_frame(
    state: State<'_, AppState>,
    frame: u32,
    width: Option<u32>,
) -> Result<Response, String> {
    let source = Source::take(&state).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let (reply, packed) = source.analyze(frame, width)?;
        mask_packet(&reply, &packed).map(Response::new)
    })
    .await
    .map_err(err)?
}

/// What a mask needs, taken under the workspace lock (cheap handles only): decoding and analysis then run without
/// it, so masks run in parallel and never hold up the app's other commands.
struct Source {
    frames: studio_core::workspace::FrameService,
    project: studio_core::project::Project,
    dir: PathBuf,
    scan: crate::gui_scan::Jobs,
}
impl Source {
    async fn take(state: &State<'_, AppState>) -> Result<Source, String> {
        let scan = state.gui_scan.clone();
        let (frames, project, dir) = run(state.ws.clone(), |w| {
            Ok((
                w.frame_service(),
                w.automation_project(),
                w.dir().to_path_buf(),
            ))
        })
        .await?;
        Ok(Source {
            frames,
            project,
            dir,
            scan,
        })
    }
    /// The picture to mask: the display frame, or the cached preview of `width`.
    fn picture(&self, frame: u32, width: Option<u32>) -> Result<Vec<u8>, String> {
        match width {
            Some(width) => crate::preview_thumbnail::get_sized(
                &self.project,
                &self.dir,
                frame,
                width,
                crate::external_tools::video_tools,
            ),
            None => self
                .frames
                .get(frame)
                .map(|b| (*b).clone())
                .map_err(|e| err(studio_core::workspace::WorkspaceError::Frame(e))),
        }
    }
    /// The frame's GUI mask as the app shows it: the HUD read from that picture, open screens from the GUI scan's
    /// native-resolution result when the scan has reached this frame (one engine answer everywhere), else detected
    /// on the picture.
    fn analyze(&self, frame: u32, width: Option<u32>) -> Result<(GuiMaskReply, Vec<u8>), String> {
        let jpeg = self.picture(frame, width)?;
        analyze(&jpeg, &self.scan, &self.project, frame)
    }
}

fn analyze(
    jpeg: &[u8],
    scan: &crate::gui_scan::Jobs,
    project: &studio_core::project::Project,
    frame: u32,
) -> Result<(GuiMaskReply, Vec<u8>), String> {
    match scan.screens(project, frame) {
        // scanned: the scan's answer, an open screen or none at all
        Some(found) => {
            let (width, height) = (project.meta.width, project.meta.height);
            let found =
                found.unwrap_or_else(|| fire_core::gui_interaction::Detection::none(width, height));
            analyzer()?.analyze_jpeg_with_screens(jpeg, Some(&found))
        }
        None => analyzer()?.analyze_jpeg(jpeg),
    }
}

fn mask_packet(reply: &GuiMaskReply, packed: &[u8]) -> Result<Vec<u8>, String> {
    let metadata = serde_json::to_vec(reply).map_err(err)?;
    let size = u32::try_from(metadata.len()).map_err(err)?;
    let pixels = if reply.mask_available { packed } else { &[] };
    let mut bytes = Vec::with_capacity(4 + metadata.len() + pixels.len());
    bytes.extend_from_slice(&size.to_le_bytes());
    bytes.extend_from_slice(&metadata);
    bytes.extend_from_slice(pixels);
    Ok(bytes)
}

/// Mask the frame as the app shows it; the pixels are kept for `gui_mask_pixels`.
#[tauri::command]
pub async fn gui_mask(state: State<'_, AppState>, frame: u32) -> Result<GuiMaskReply, String> {
    let source = Source::take(&state).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let (reply, packed) = source.analyze(frame, None)?;
        *LAST.lock().map_err(err)? = Some((source.dir.clone(), frame, packed));
        Ok(reply)
    })
    .await
    .map_err(err)?
}

/// The packed pixels (`class << 4 | piece`, one byte each) of the last `gui_mask` of this frame, sent raw.
#[tauri::command]
pub async fn gui_mask_pixels(state: State<'_, AppState>, frame: u32) -> Result<Response, String> {
    run(state.ws.clone(), move |w| {
        let last = LAST.lock().map_err(err)?;
        match last.as_ref() {
            Some((dir, f, packed)) if dir == w.dir() && *f == frame => {
                Ok(Response::new(packed.clone()))
            }
            _ => Err(format!("no mask computed for frame {frame} yet")),
        }
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reply(available: bool) -> GuiMaskReply {
        GuiMaskReply {
            width: 2,
            height: 1,
            reliable: available,
            mask_available: available,
            scale: None,
            scaled_width: None,
            scaled_height: None,
            notes: vec![],
            pieces: vec![],
        }
    }

    #[test]
    fn independent_packets_keep_their_own_metadata_and_pixels() {
        let first = mask_packet(&reply(true), &[0x11, 0x22]).unwrap();
        let second = mask_packet(&reply(false), &[0x33, 0x44]).unwrap();
        for (bytes, available, expected) in
            [(&first, true, &[0x11, 0x22][..]), (&second, false, &[][..])]
        {
            let size = u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize;
            let metadata: serde_json::Value = serde_json::from_slice(&bytes[4..4 + size]).unwrap();
            assert_eq!(metadata["mask_available"], available);
            assert_eq!(&bytes[4 + size..], expected);
        }
    }
}
