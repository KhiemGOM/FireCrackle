//! The app side of the shared GUI mask (`fire_core::gui_mask`, plan in `docs/PLAN-GUI-MASK.md` 3.2).
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
    crate::fsutil::write_atomic(&path, &json).map_err(|e| {
        format!(
            "could not save the GUI answer in {}: {e}",
            project_dir.display()
        )
    })
}

/// Set on pixels of an open screen (inventory, menu buttons, recipe book), whose ids do not fit the low nibble.
pub const SCREEN_FLAG: u8 = 0x40;
const SCREEN_PIECES: [PieceId; 4] = [
    PieceId::InventoryPanel,
    PieceId::MenuButton,
    PieceId::RecipeBookPanel,
    PieceId::ItemTooltip,
];

/// One byte per pixel: the pixel class (0 none, 1 opaque, 2 translucent, 3 unknown) in bits 4-5, the piece id in
/// the low nibble, and [`SCREEN_FLAG`] for an open screen (unveil protects only those, never the HUD).
pub fn pack(piece: u8, class: u8) -> u8 {
    let screen = if SCREEN_PIECES.iter().any(|&p| p as u8 == piece) {
        SCREEN_FLAG
    } else {
        0
    };
    (class << 4) | (piece & 0x0f) | screen
}

/// `(piece, class)` of a packed pixel.
pub fn unpack(b: u8) -> (u8, u8) {
    (b & 0x0f, (b >> 4) & 0x03)
}

/// Whether a packed pixel belongs to an open screen.
pub fn is_screen(b: u8) -> bool {
    b & SCREEN_FLAG != 0
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
        // the same texture set as every other GUI mask user (recipe book included)
        let tex = pov_textures()?;
        Ok(GuiAnalyzer {
            detector: GuiDetector::new(tex, GuiOptions::default())?,
        })
    }

    /// The frame's GUI scale from the HUD alone, None without a reliable HUD (`GuiDetector::hud_scale_with_hint`).
    /// Scans pass it to the interaction detector: one frame has one GUI scale, so a panel at another is not a screen.
    pub fn hud_scale(
        &self,
        rgb: &[u8],
        width: usize,
        height: usize,
        hint: &mut fire_core::gui_mask::GuiFitHint,
    ) -> Result<Option<f64>, String> {
        self.detector.hud_scale_with_hint(rgb, width, height, hint)
    }

    /// Decode a JPEG frame and mask it: the summary and one packed byte per pixel.
    pub fn analyze_jpeg(&self, jpeg: &[u8]) -> Result<(GuiMaskReply, Vec<u8>), String> {
        self.analyze_jpeg_with_screens(jpeg, None)
    }

    /// The same, with the open screens taken from the engine result the GUI scan made of this frame (any size of
    /// the same shape: the native frame) instead of detecting them again on this picture. The HUD is always read
    /// from this picture.
    pub fn analyze_jpeg_with_screens(
        &self,
        jpeg: &[u8],
        screens: Option<&fire_core::gui_interaction::Detection>,
    ) -> Result<(GuiMaskReply, Vec<u8>), String> {
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
        self.analyze_rgb(&rgb, w, h, screens)
    }

    /// The mask of the native frame (the exact PNG the app decodes for a paused picture): detectors only ever see
    /// native pictures. `screens`: the GUI scan's result for the frame, used instead of detecting screens again.
    pub fn analyze_png(
        &self,
        png: &[u8],
        screens: Option<&fire_core::gui_interaction::Detection>,
    ) -> Result<(GuiMaskReply, Vec<u8>), String> {
        let mut reader = png::Decoder::new(std::io::Cursor::new(png))
            .read_info()
            .map_err(|e| format!("the frame is not a readable PNG: {e}"))?;
        let mut px = vec![0; reader.output_buffer_size().ok_or("the PNG is too large")?];
        let info = reader
            .next_frame(&mut px)
            .map_err(|e| format!("the frame is not a readable PNG: {e}"))?;
        let (w, h) = (info.width as usize, info.height as usize);
        let rgb = match (info.color_type, info.bit_depth) {
            (png::ColorType::Rgb, png::BitDepth::Eight) => px[..w * h * 3].to_vec(),
            (png::ColorType::Rgba, png::BitDepth::Eight) => px[..w * h * 4]
                .chunks_exact(4)
                .flat_map(|p| [p[0], p[1], p[2]])
                .collect(),
            other => return Err(format!("unsupported PNG format {other:?}")),
        };
        self.analyze_rgb(&rgb, w, h, screens)
    }

    /// The mask of RGB24 pixels: the HUD from them, open screens from `screens` (any size of the same shape) or
    /// detected on them.
    pub fn analyze_rgb(
        &self,
        rgb: &[u8],
        w: usize,
        h: usize,
        screens: Option<&fire_core::gui_interaction::Detection>,
    ) -> Result<(GuiMaskReply, Vec<u8>), String> {
        let mut m = match screens {
            None => self.detector.detect(rgb, w, h)?,
            Some(s) => {
                same_shape(s, w, h)?;
                self.detector
                    .detect_with_screens(rgb, w, h, &s.scaled(w, h))?
            }
        };
        // Reuse the shared texture-confirmed screen masks. Their hits also let
        // the preview distinguish an open menu/inventory from the normal HUD.
        fire_core::gui_mask::add_screen_masks(rgb, w, h, self.detector.textures(), &mut m)?;
        Ok(reply_of(m))
    }
}

/// A result for the same picture at another resolution: equal aspect within a pixel of rounding.
fn same_shape(s: &fire_core::gui_interaction::Detection, w: usize, h: usize) -> Result<(), String> {
    if (s.image_width as f64 * h as f64 - s.image_height as f64 * w as f64).abs()
        <= s.image_width.max(s.image_height) as f64
    {
        Ok(())
    } else {
        Err(format!(
            "the scan's {}x{} result is not this {w}x{h} picture",
            s.image_width, s.image_height
        ))
    }
}

/// A `width` x `height` mask holding only the open screens of the GUI scan's native result: no detector runs (the
/// gallery, where unveil needs only the screens). The HUD is not read, so the mask is not `reliable`.
pub fn screens_mask(
    screens: &fire_core::gui_interaction::Detection,
    width: usize,
    height: usize,
) -> Result<(GuiMaskReply, Vec<u8>), String> {
    same_shape(screens, width, height)?;
    let mut m = fire_core::gui_mask::GuiMask {
        width,
        height,
        piece: vec![0; width * height],
        class: vec![0; width * height],
        fit: None,
        reliable: false,
        hits: vec![],
        notes: vec![],
    };
    screens.scaled(width, height).merge_neutral_panel(&mut m)?;
    Ok(reply_of(m))
}

/// The summary and packed pixels the app reads (`gui_mask_frame`).
fn reply_of(m: fire_core::gui_mask::GuiMask) -> (GuiMaskReply, Vec<u8>) {
    let (w, h) = (m.width, m.height);
    {
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
        (reply, packed)
    }
}
