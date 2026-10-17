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

fn analyzer() -> Result<&'static GuiAnalyzer, String> {
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

/// Mask the frame as the app shows it; the pixels are kept for `gui_mask_pixels`.
#[tauri::command]
pub async fn gui_mask(state: State<'_, AppState>, frame: u32) -> Result<GuiMaskReply, String> {
    run(state.ws.clone(), move |w| {
        let jpeg = w.frame_jpeg(frame).map_err(err)?;
        let (reply, packed) = analyzer()?.analyze_jpeg(&jpeg)?;
        *LAST.lock().map_err(err)? = Some((w.dir().to_path_buf(), frame, packed));
        Ok(reply)
    })
    .await
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
