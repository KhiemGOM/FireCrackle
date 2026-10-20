//! The app side of the shared GUI mask (`fire_core::gui_mask`, plan in `PLAN-GUI-MASK.md` 3.2).
//!
//! HUD fitting retains its 1.16.5 reference. Independent interaction panels use
//! the shared versioned source bank, without a user-confirmation gate.
//! Legacy `<video>.firecrackle/gui.json` answers remain readable without controlling masking.

use fire_core::gui_mask::{GuiDetector, GuiOptions, GuiTextures, PieceId};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

/// The user's answer to "is this footage vanilla Minecraft 1.16.5 GUI (no resource pack, no HUD mods, not cropped)?"
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GuiAnswer {
    Yes,
    No,
    NotSure,
}

#[derive(Serialize, Deserialize)]
struct AnswerFile {
    answer: GuiAnswer,
}

const ANSWER_FILE: &str = "gui.json";

/// The legacy saved answer; missing/corrupt data is never rewritten as a user confirmation.
pub fn read_answer(project_dir: &Path) -> Option<GuiAnswer> {
    let bytes = std::fs::read(project_dir.join(ANSWER_FILE)).ok()?;
    serde_json::from_slice::<AnswerFile>(&bytes)
        .ok()
        .map(|f| f.answer)
}

/// Save the answer (temp file + rename, so a crash never leaves a half-written answer).
pub fn write_answer(project_dir: &Path, answer: GuiAnswer) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(&AnswerFile { answer }).map_err(|e| e.to_string())?;
    let path = project_dir.join(ANSWER_FILE);
    let tmp = project_dir.join(format!("{ANSWER_FILE}.tmp"));
    let r = std::fs::write(&tmp, json).and_then(|_| std::fs::rename(&tmp, &path));
    if r.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    r.map_err(|e| {
        format!(
            "could not save the GUI answer in {}: {e}",
            project_dir.display()
        )
    })
}

/// One byte per pixel: the pixel class (0 none, 1 opaque, 2 translucent, 3 unknown) in the high nibble, the piece id in
/// the low nibble.
pub fn pack(piece: u8, class: u8) -> u8 {
    (class << 4) | (piece & 0x0f)
}

/// `(piece, class)` of a packed pixel.
pub fn unpack(b: u8) -> (u8, u8) {
    (b & 0x0f, b >> 4)
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PieceCount {
    pub piece: String,
    pub count: usize,
}

/// What the UI shows about a frame's mask (the pixels travel separately as packed bytes).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct GuiMaskReply {
    pub width: usize,
    pub height: usize,
    pub reliable: bool,
    /// A panel can be masked independently of a reliable HUD fit.
    pub mask_available: bool,
    /// Video pixels per GUI pixel.
    pub scale: Option<f64>,
    pub scaled_width: Option<u32>,
    pub scaled_height: Option<u32>,
    pub notes: Vec<String>,
    pub pieces: Vec<PieceCount>,
}

static WIDGETS: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../fire-detection/data/assets/gui/widgets.rgba"
));
static ICONS: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../fire-detection/data/assets/gui/icons.rgba"
));
static INVENTORY: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../fire-detection/data/assets/gui/inventory.rgba"
));
static FONT: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../fire-detection/data/assets/gui/ascii.rgba"
));
static BARS: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../fire-detection/data/assets/gui/bars.rgba"
));
static RECIPE: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../fire-detection/data/assets/gui/recipe_book.rgba"
));

/// One immutable source bank for previews, AI preprocessing and Misc scans.
/// Cache geometry only; never carry a previous frame's GUI decision forward.
pub fn interaction_detector(
) -> Result<std::sync::Arc<fire_core::gui_interaction::InteractionDetector>, String> {
    static DETECTOR: std::sync::OnceLock<
        Result<std::sync::Arc<fire_core::gui_interaction::InteractionDetector>, String>,
    > = std::sync::OnceLock::new();
    DETECTOR
        .get_or_init(|| {
            fire_core::gui_interaction::InteractionDetector::from_bundle(include_bytes!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../../fire-detection/data/assets/gui/interaction.bundle"
            )))
            .map(|detector| std::sync::Arc::new(detector.serial()))
        })
        .clone()
}

pub fn with_interactions(mut textures: GuiTextures) -> Result<GuiTextures, String> {
    textures.interactions = Some(interaction_detector()?);
    Ok(textures)
}

/// Exact vanilla sheets used by the validated first-person pipeline. The
/// recipe sheet is generated locally by the frontend build prerequisite.
pub fn pov_textures() -> Result<GuiTextures, String> {
    with_interactions(
        GuiTextures::from_rgba(WIDGETS.to_vec(), ICONS.to_vec(), INVENTORY.to_vec())?
            .with_extras(Some(BARS.to_vec()), Some(FONT.to_vec()))?
            .with_recipe_book(Some(RECIPE.to_vec()))?,
    )
}

/// Runs the shared mask with the vanilla textures built into the binary.
pub struct GuiAnalyzer {
    detector: GuiDetector,
}

impl GuiAnalyzer {
    pub fn new() -> Result<GuiAnalyzer, String> {
        let tex = with_interactions(
            GuiTextures::from_rgba(WIDGETS.to_vec(), ICONS.to_vec(), INVENTORY.to_vec())?
                .with_extras(None, Some(FONT.to_vec()))?,
        )?;
        Ok(GuiAnalyzer {
            detector: GuiDetector::new(tex, GuiOptions::default())?,
        })
    }

    /// Decode a JPEG frame and mask it: the summary and one packed byte per pixel.
    pub fn analyze_jpeg(&self, jpeg: &[u8]) -> Result<(GuiMaskReply, Vec<u8>), String> {
        if jpeg.is_empty() {
            return Err("the frame is empty".into());
        }
        let mut d = jpeg_decoder::Decoder::new(jpeg);
        let px = d
            .decode()
            .map_err(|e| format!("the frame is not a readable JPEG: {e}"))?;
        let info = d.info().ok_or("the frame has no JPEG header")?;
        let (w, h) = (info.width as usize, info.height as usize);
        let rgb = match info.pixel_format {
            jpeg_decoder::PixelFormat::RGB24 => px,
            jpeg_decoder::PixelFormat::L8 => px.iter().flat_map(|&v| [v, v, v]).collect(),
            other => return Err(format!("unsupported JPEG pixel format {other:?}")),
        };
        let mut m = self.detector.detect(&rgb, w, h)?;
        // Reuse the shared texture-confirmed screen masks. Their hits also let
        // the preview distinguish an open menu/inventory from the normal HUD.
        fire_core::gui_mask::add_screen_masks(&rgb, w, h, self.detector.textures(), &mut m)?;
        let mut counts: BTreeMap<String, usize> = BTreeMap::new();
        for hit in &m.hits {
            *counts.entry(format!("{:?}", hit.piece)).or_insert(0) += 1;
        }
        // drawing order of the pieces, so the summary reads bottom-up like the HUD
        let order = |n: &str| {
            [
                PieceId::Hotbar,
                PieceId::SelectedSlot,
                PieceId::Offhand,
                PieceId::HotbarItem,
                PieceId::Crosshair,
                PieceId::XpBar,
                PieceId::Health,
                PieceId::Armor,
                PieceId::Food,
                PieceId::Air,
                PieceId::EffectIcon,
            ]
            .iter()
            .position(|p| format!("{p:?}") == n)
            .unwrap_or(usize::MAX)
        };
        let mut pieces: Vec<PieceCount> = counts
            .into_iter()
            .map(|(piece, count)| PieceCount { piece, count })
            .collect();
        pieces.sort_by_key(|p| order(&p.piece));
        let packed = m
            .piece
            .iter()
            .zip(&m.class)
            .map(|(&p, &c)| pack(p, c))
            .collect();
        let reply = GuiMaskReply {
            width: w,
            height: h,
            reliable: m.reliable,
            mask_available: m.reliable || m.class.iter().any(|&c| c != 0),
            scale: m.fit.map(|f| f.scale),
            scaled_width: m.fit.map(|f| f.scaled_width),
            scaled_height: m.fit.map(|f| f.scaled_height),
            notes: m.notes,
            pieces,
        };
        Ok((reply, packed))
    }
}
