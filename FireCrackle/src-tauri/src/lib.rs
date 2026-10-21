//! Thin Tauri shim over `studio_core::workspace`: one open video at a time, every command a one-liner.
//! Anything that can block (importing, decoding) runs on a blocking thread so the window stays responsive.

use std::path::Path;
use std::sync::{Arc, Mutex};
use studio_core::config::{SettingInfo, Settings};
use studio_core::lane::Bucket;
use studio_core::phase::Flag;
use studio_core::workspace::{PhaseChart, ThumbStatus, UiAction, View, Workspace};
use tauri::State;
use tauri::ipc::Response;
mod comparison_proof;
mod compression;
mod external_tools;
mod gui;
mod gui_scan;
mod jolt;
mod no_fire;
mod pov;
mod preview_thumbnail;
mod quad_phase;
mod scan_cache;
mod url_import;

#[tauri::command]
async fn compress_fire_cycle(
    width: u32,
    height: u32,
    frames: Vec<Vec<u8>>,
    crf: u8,
) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        compression::encode(
            &external_tools::video_tools()?.ffmpeg,
            width,
            height,
            frames,
            crf,
        )
        .map(Response::new)
    })
    .await
    .map_err(err)?
}

#[derive(Default)]
struct AppState {
    ws: Arc<Mutex<Option<Workspace>>>,
    pov: pov::Jobs,
    no_fire: pov::Jobs,
    links: url_import::Jobs,
    gui_scan: gui_scan::Jobs,
}

#[tauri::command]
fn gui_scan_start(state: State<'_, AppState>) -> Result<gui_scan::Status, String> {
    let guard = state.ws.lock().map_err(|_| "Workspace unavailable")?;
    let project = guard
        .as_ref()
        .ok_or("No video is open")?
        .automation_project();
    drop(guard);
    state
        .gui_scan
        .start(project, external_tools::video_tools()?)
}
#[tauri::command]
fn gui_scan_status(state: State<'_, AppState>) -> Result<gui_scan::Status, String> {
    let guard = state.ws.lock().map_err(|_| "Workspace unavailable")?;
    let project = guard
        .as_ref()
        .ok_or("No video is open")?
        .automation_project();
    drop(guard);
    state.gui_scan.status(&project)
}
#[tauri::command]
fn gui_scan_cancel(state: State<'_, AppState>) -> Result<(), String> {
    let guard = state.ws.lock().map_err(|_| "Workspace unavailable")?;
    let project = guard
        .as_ref()
        .ok_or("No video is open")?
        .automation_project();
    drop(guard);
    state.gui_scan.cancel(&project)
}

#[tauri::command]
fn tool_status() -> Option<external_tools::Progress> {
    external_tools::status()
}

/// Which package this copy came from (setup, portable ZIP, AppImage, Debian), so the update banner offers the matching file.
#[tauri::command]
fn install_kind() -> studio_core::install_kind::InstallKind {
    studio_core::install_kind::detect()
}
#[tauri::command]
fn link_start(
    state: State<'_, AppState>,
    url: String,
    folder: String,
) -> Result<url_import::Status, String> {
    state.links.start(url, std::path::PathBuf::from(folder))
}
#[tauri::command]
fn link_status(state: State<'_, AppState>) -> Result<Option<url_import::Status>, String> {
    state.links.status()
}
#[tauri::command]
fn link_cancel(state: State<'_, AppState>, id: u64) -> Result<(), String> {
    state.links.cancel(id)
}
#[tauri::command]
fn no_fire_start(state: State<'_, AppState>) -> Result<pov::Status, String> {
    let guard = state.ws.lock().map_err(|_| "Workspace unavailable")?;
    let workspace = guard.as_ref().ok_or("No video is open")?;
    let project = workspace.automation_project();
    drop(guard);
    let ws = state.ws.clone();
    state.no_fire.start_no_fire_saving(
        project,
        external_tools::video_tools()?,
        Box::new(move |project, rows| {
            let mut guard = ws.lock().map_err(|_| "Workspace unavailable")?;
            let workspace = guard.as_mut().ok_or("No video is open")?;
            let current = workspace.automation_project();
            if current.video_path != project.video_path
                || current.fingerprint != project.fingerprint
                || current.frames.len() != project.frames.len()
            {
                return Err("Video changed before no-fire labels could be saved".into());
            }
            let frames: Vec<u32> = rows.iter().map(|&(frame, _)| frame).collect();
            workspace
                .add_auto_no_fire(&frames)
                .map(|(_, count)| count)
                .map_err(err)
        }),
    )
}
#[tauri::command]
fn no_fire_status(state: State<'_, AppState>) -> Result<Option<pov::Status>, String> {
    let guard = state.ws.lock().map_err(|_| "Workspace unavailable")?;
    let Some(workspace) = guard.as_ref() else {
        return Ok(None);
    };
    state.no_fire.restore(&workspace.automation_project(), true)
}
#[tauri::command]
fn no_fire_cancel(state: State<'_, AppState>, id: u64) -> Result<(), String> {
    state.no_fire.cancel(id)
}
#[tauri::command]
fn no_fire_candidates(
    state: State<'_, AppState>,
    id: u64,
    offset: usize,
) -> Result<Vec<u32>, String> {
    state.no_fire.candidates(id, offset)
}

#[tauri::command]
fn pov_start(state: State<'_, AppState>) -> Result<pov::Status, String> {
    let guard = state.ws.lock().map_err(|_| "Workspace unavailable")?;
    let project = guard
        .as_ref()
        .ok_or("No video is open")?
        .automation_project();
    state.pov.start(project, external_tools::video_tools()?)
}

#[tauri::command]
fn pov_status(state: State<'_, AppState>) -> Result<Option<pov::Status>, String> {
    let guard = state.ws.lock().map_err(|_| "Workspace unavailable")?;
    let Some(workspace) = guard.as_ref() else {
        return Ok(None);
    };
    state.pov.restore(&workspace.automation_project(), false)
}

#[tauri::command]
fn pov_cancel(state: State<'_, AppState>, id: u64) -> Result<(), String> {
    state.pov.cancel(id)
}

#[tauri::command]
async fn pov_apply(state: State<'_, AppState>, id: u64) -> Result<View, String> {
    let ws = state.ws.clone();
    let pov = state.pov.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = ws.lock().map_err(|_| "Workspace unavailable")?;
        let workspace = guard.as_mut().ok_or("No video is open")?;
        let project = workspace.automation_project();
        pov.apply(id, &project, |rows| {
            workspace.add_auto_predictions(rows).map_err(err)
        })
    })
    .await
    .map_err(err)?
}

fn err<E: std::fmt::Debug>(e: E) -> String {
    format!("{e:?}")
}

/// Run `f` on the open workspace on a blocking thread.
async fn run<T: Send + 'static>(
    ws: Arc<Mutex<Option<Workspace>>>,
    f: impl FnOnce(&mut Workspace) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = ws
            .lock()
            .map_err(|_| "internal error: the workspace lock was poisoned".to_string())?;
        let w = guard
            .as_mut()
            .ok_or_else(|| "no video is open".to_string())?;
        f(w)
    })
    .await
    .map_err(err)?
}

/// Optional initial video supplied by a desktop launch or file shortcut.
#[tauri::command]
fn startup_video() -> Option<String> {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--video" {
            return args.next();
        }
    }
    None
}

/// Import (or load) the project for a video and make it the open workspace.
#[tauri::command]
async fn open_video(state: State<'_, AppState>, path: String) -> Result<View, String> {
    let ws = state.ws.clone();
    let pov = state.pov.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut w = Workspace::open(
            &external_tools::video_tools()?,
            Path::new(&path),
            &Settings::default(),
        )
        .map_err(err)?;
        let view = w.view();
        let mut guard = ws
            .lock()
            .map_err(|_| "internal error: the workspace lock was poisoned".to_string())?;
        if let Some(status) = pov.status()?
            && status.state == "running"
        {
            pov.cancel(status.id)?;
        }
        if let Some(old) = guard.take() {
            old.wait_idle(); // let the previous video's prefetch finish before it is dropped
        }
        *guard = Some(w);
        Ok(view)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
async fn view(state: State<'_, AppState>) -> Result<View, String> {
    run(state.ws.clone(), |w| Ok(w.view())).await
}

#[tauri::command]
async fn act(state: State<'_, AppState>, action: UiAction) -> Result<View, String> {
    run(state.ws.clone(), move |w| w.apply(action).map_err(err)).await
}

#[tauri::command]
async fn export_labels(state: State<'_, AppState>, path: String) -> Result<View, String> {
    run(state.ws.clone(), move |w| {
        w.export_labels_to(Path::new(&path)).map_err(err)
    })
    .await
}

#[tauri::command]
async fn import_labels(state: State<'_, AppState>, path: String) -> Result<View, String> {
    run(state.ws.clone(), move |w| {
        let text =
            std::fs::read_to_string(&path).map_err(|e| format!("Could not read labels: {e}"))?;
        w.import_labels(&text).map_err(err)
    })
    .await
}

#[tauri::command]
async fn preview_thumbnail(
    state: State<'_, AppState>,
    frame: u32,
    width: Option<u32>,
    targets: Option<Vec<u32>>,
) -> Result<Response, String> {
    let (project, dir) = run(state.ws.clone(), |w| {
        Ok((w.automation_project(), w.dir().to_path_buf()))
    })
    .await?;
    tauri::async_runtime::spawn_blocking(move || {
        match targets {
            Some(targets) => preview_thumbnail::get_with_targets(
                &project,
                &dir,
                frame,
                width.unwrap_or(128),
                &targets,
                external_tools::video_tools,
            ),
            None => preview_thumbnail::get_sized(
                &project,
                &dir,
                frame,
                width.unwrap_or(128),
                external_tools::video_tools,
            ),
        }
        .map(Response::new)
    })
    .await
    .map_err(err)?
}

/// The JPEG bytes of one frame, sent raw (no JSON). A frame that is not cached decodes for up to a second, so the
/// workspace is locked only to take a handle on its frame cache: every other command keeps working meanwhile.
#[tauri::command]
async fn frame(state: State<'_, AppState>, frame: u32) -> Result<Response, String> {
    let frames = run(state.ws.clone(), |w| Ok(w.frame_service())).await?;
    tauri::async_runtime::spawn_blocking(move || {
        frames
            .get(frame)
            .map(|b| Response::new((*b).clone()))
            .map_err(|e| err(studio_core::workspace::WorkspaceError::Frame(e)))
    })
    .await
    .map_err(err)?
}

#[tauri::command]
async fn timeline(
    state: State<'_, AppState>,
    start: u32,
    end: u32,
    buckets: usize,
) -> Result<Vec<Bucket>, String> {
    run(state.ws.clone(), move |w| {
        Ok(w.timeline(start, end, buckets))
    })
    .await
}

#[tauri::command]
async fn flags(state: State<'_, AppState>) -> Result<Vec<Flag>, String> {
    run(state.ws.clone(), |w| Ok(w.flags())).await
}

#[tauri::command]
async fn jolt_read(
    state: State<'_, AppState>,
    video_path: String,
) -> Result<Option<String>, String> {
    run(state.ws.clone(), move |w| {
        let project = w.automation_project();
        if project.video_path != video_path {
            return Err("The open video changed. Reopen its Phase tab.".into());
        }
        jolt::read(Path::new(&project.video_path))
    })
    .await
}
#[tauri::command]
async fn jolt_write(
    state: State<'_, AppState>,
    video_path: String,
    data: String,
) -> Result<(), String> {
    run(state.ws.clone(), move |w| {
        let project = w.automation_project();
        if project.video_path != video_path {
            return Err("The open video changed. Import into its own Phase tab.".into());
        }
        jolt::write(Path::new(&project.video_path), &data)
    })
    .await
}
#[tauri::command]
async fn jolt_frame(
    state: State<'_, AppState>,
    video_path: String,
    time: f64,
) -> Result<u32, String> {
    run(state.ws.clone(), move |w| {
        let project = w.automation_project();
        if project.video_path != video_path || !time.is_finite() || time < 0. {
            return Err("Invalid Jolt video timestamp".into());
        }
        let i = project.frames.partition_point(|f| f.pts < time);
        let index = if i == 0 {
            0
        } else if i >= project.frames.len()
            || time - project.frames[i - 1].pts <= project.frames[i].pts - time
        {
            i - 1
        } else {
            i
        };
        u32::try_from(index).map_err(err)
    })
    .await
}
#[tauri::command]
async fn phase_chart(
    state: State<'_, AppState>,
    max_points: usize,
    source: Option<String>,
) -> Result<PhaseChart, String> {
    use studio_core::label::LabelSource;
    let filter = match source.as_deref() {
        None | Some("independent") => None,
        Some("manual") => Some(LabelSource::Manual),
        Some("first_person") => Some(LabelSource::FirstPerson),
        Some("time_guess") => Some(LabelSource::TimeGuess),
        Some("no_fire") => Some(LabelSource::NoFire),
        _ => return Err("Unknown label source".into()),
    };
    run(state.ws.clone(), move |w| {
        Ok(w.phase_chart_source(max_points, filter))
    })
    .await
}

#[tauri::command]
async fn thumbs_start(state: State<'_, AppState>) -> Result<ThumbStatus, String> {
    run(state.ws.clone(), |w| Ok(w.thumbs_start())).await
}

#[tauri::command]
async fn thumbs_status(state: State<'_, AppState>) -> Result<ThumbStatus, String> {
    run(state.ws.clone(), |w| Ok(w.thumbs_status())).await
}

#[tauri::command]
async fn thumb_nearest(
    state: State<'_, AppState>,
    frames: Vec<u32>,
) -> Result<Vec<Option<u32>>, String> {
    run(state.ws.clone(), move |w| Ok(w.thumb_nearest(&frames))).await
}

/// The JPEG bytes of one stored thumbnail, sent raw.
#[tauri::command]
async fn thumb(state: State<'_, AppState>, frame: u32) -> Result<Response, String> {
    run(state.ws.clone(), move |w| {
        w.thumb_jpeg(frame).map(Response::new).map_err(err)
    })
    .await
}

#[tauri::command]
async fn settings_describe(state: State<'_, AppState>) -> Result<Vec<SettingInfo>, String> {
    run(state.ws.clone(), |w| Ok(w.describe_settings())).await
}

#[tauri::command]
async fn settings_set(state: State<'_, AppState>, key: String, value: f64) -> Result<View, String> {
    run(state.ws.clone(), move |w| {
        w.set_setting(&key, value).map_err(err)
    })
    .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run_app() {
    tauri::Builder::default()
        .setup(|app| {
            use tauri::Manager;
            external_tools::configure(app.path().app_local_data_dir()?);
            no_fire::configure(app.path().resource_dir()?.join("ai"));
            #[cfg(target_os = "linux")]
            no_fire::configure_cache(app.path().app_local_data_dir()?.join("ai"));
            quad_phase::eager_load();
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            startup_video,
            tool_status,
            install_kind,
            link_start,
            link_status,
            link_cancel,
            no_fire_start,
            no_fire_status,
            no_fire_cancel,
            no_fire_candidates,
            quad_phase::quad_phase,
            pov_start,
            pov_status,
            pov_cancel,
            pov_apply,
            compress_fire_cycle,
            comparison_proof::copy_comparison_proof,
            comparison_proof::save_comparison_proof,
            comparison_proof::copy_formatted_comparison_proof,
            open_video,
            view,
            act,
            export_labels,
            import_labels,
            frame,
            preview_thumbnail,
            timeline,
            flags,
            phase_chart,
            jolt_read,
            jolt_write,
            jolt_frame,
            thumbs_start,
            thumbs_status,
            thumb_nearest,
            thumb,
            gui::gui_answer_get,
            gui::gui_answer_set,
            gui::gui_mask_frame,
            gui::gui_mask,
            gui::gui_mask_pixels,
            gui_scan_start,
            gui_scan_status,
            gui_scan_cancel,
            settings_describe,
            settings_set
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            use tauri::Manager;
            if let tauri::RunEvent::Exit = event {
                app.state::<AppState>().links.shutdown();
                app.state::<AppState>().gui_scan.shutdown();
            }
        });
}
