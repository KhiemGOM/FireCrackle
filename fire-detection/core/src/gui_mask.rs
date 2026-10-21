//! Unified per-piece GUI mask, phase 1: GUI scale fit and the neutral HUD (see `FireCrackle/PLAN-GUI-MASK.md`).
//!
//! Metadata only: for every pixel, which HUD piece (if any) is drawn there and whether it is opaque, translucent (world
//! still visible, blended with a known colour) or unknown. Nothing is erased. Geometry is Yarn 1.16.5 `InGameHud` /
//! `Window` (line numbers in the plan); presence and the scale are read from the pixels by matching the vanilla
//! textures, never assumed. Only meant for footage the user confirmed to be vanilla 1.16.5.

use std::{
    cell::OnceCell,
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex, RwLock},
};

#[path = "gui_screens.rs"]
mod screens;
pub use screens::add_screen_masks;

// ================================================================ textures

#[derive(Clone, Debug)]
pub struct Texture {
    pub width: usize,
    pub height: usize,
    pub rgba: Vec<u8>,
}

impl Texture {
    fn texel(&self, u: i64, v: i64) -> [u8; 4] {
        if u < 0 || v < 0 || u as usize >= self.width || v as usize >= self.height {
            return [0; 4];
        }
        let i = (v as usize * self.width + u as usize) * 4;
        [
            self.rgba[i],
            self.rgba[i + 1],
            self.rgba[i + 2],
            self.rgba[i + 3],
        ]
    }
}

/// The three 256x256 vanilla sheets the HUD is drawn from (`textures/gui/widgets.png`, `icons.png`,
/// `container/inventory.png`), as raw RGBA.
#[derive(Clone, Debug)]
pub struct GuiTextures {
    pub widgets: Texture,
    pub icons: Texture,
    pub inventory: Texture,
    /// `textures/gui/bars.png` (boss bars), when present.
    pub bars: Option<Texture>,
    /// `textures/font/ascii.png` (16x16 glyphs of 8x8), when present: needed only to compose synthetic text.
    pub font: Option<Texture>,
    /// Optional local recipe-book sheet; used only by opt-in screen masks.
    pub recipe_book: Option<Texture>,
    /// Shared, source-versioned interaction/menu evidence. Optional for legacy
    /// research reproducibility; production callers install the same bank.
    pub interactions: Option<Arc<crate::gui_interaction::InteractionDetector>>,
}

impl GuiTextures {
    pub fn from_rgba(
        widgets: Vec<u8>,
        icons: Vec<u8>,
        inventory: Vec<u8>,
    ) -> Result<GuiTextures, String> {
        let t = |name: &str, rgba: Vec<u8>| -> Result<Texture, String> {
            if rgba.len() != 256 * 256 * 4 {
                return Err(format!(
                    "{name} must be 256x256 RGBA ({} bytes), got {}",
                    256 * 256 * 4,
                    rgba.len()
                ));
            }
            Ok(Texture {
                width: 256,
                height: 256,
                rgba,
            })
        };
        Ok(GuiTextures {
            widgets: t("widgets", widgets)?,
            icons: t("icons", icons)?,
            inventory: t("inventory", inventory)?,
            bars: None,
            font: None,
            recipe_book: None,
            interactions: None,
        })
    }

    /// Add the boss bar sheet (256x256) and the font sheet (128x128).
    pub fn with_extras(
        mut self,
        bars: Option<Vec<u8>>,
        font: Option<Vec<u8>>,
    ) -> Result<GuiTextures, String> {
        if let Some(b) = bars {
            if b.len() != 256 * 256 * 4 {
                return Err(format!("bars must be 256x256 RGBA, got {} bytes", b.len()));
            }
            self.bars = Some(Texture {
                width: 256,
                height: 256,
                rgba: b,
            });
        }
        if let Some(f) = font {
            if f.len() != 128 * 128 * 4 {
                return Err(format!("font must be 128x128 RGBA, got {} bytes", f.len()));
            }
            self.font = Some(Texture {
                width: 128,
                height: 128,
                rgba: f,
            });
        }
        Ok(self)
    }

    pub fn with_recipe_book(mut self, rgba: Option<Vec<u8>>) -> Result<Self, String> {
        if let Some(rgba) = rgba {
            if rgba.len() != 256 * 256 * 4 {
                return Err("recipe book must be 256x256 RGBA".into());
            }
            self.recipe_book = Some(Texture {
                width: 256,
                height: 256,
                rgba,
            });
        }
        Ok(self)
    }

    /// Required HUD sheets and optional local extras from a folder.
    pub fn load(dir: &Path) -> Result<GuiTextures, String> {
        let read = |n: &str| {
            std::fs::read(dir.join(n)).map_err(|e| format!("{}: {e}", dir.join(n).display()))
        };
        GuiTextures::from_rgba(
            read("widgets.rgba")?,
            read("icons.rgba")?,
            read("inventory.rgba")?,
        )?
        .with_extras(read("bars.rgba").ok(), read("ascii.rgba").ok())?
        .with_recipe_book(read("recipe_book.rgba").ok())
    }

    fn sheet(&self, s: Sheet) -> Option<&Texture> {
        match s {
            Sheet::Widgets => Some(&self.widgets),
            Sheet::Icons => Some(&self.icons),
            Sheet::Inventory => Some(&self.inventory),
            Sheet::Bars => self.bars.as_ref(),
        }
    }
}

// ================================================================ Window (Yarn Window.java 371-397)

/// `Window.calculateScaleFactor`: grow from 1 while the scale is not the chosen one (0 = Auto) and the scaled window
/// stays at least 320x240; the forced Unicode font bumps an odd result.
pub fn gui_scale_factor(fb_w: u32, fb_h: u32, gui_scale: u32, force_unicode: bool) -> u32 {
    let mut i = 1u32;
    while i != gui_scale && i < fb_w && i < fb_h && fb_w / (i + 1) >= 320 && fb_h / (i + 1) >= 240 {
        i += 1;
    }
    if force_unicode && !i.is_multiple_of(2) {
        i += 1;
    }
    i
}

/// `Window.setScaleFactor`: the scaled window size is rounded up.
pub fn scaled_size(fb_w: u32, fb_h: u32, scale: u32) -> (u32, u32) {
    (fb_w.div_ceil(scale.max(1)), fb_h.div_ceil(scale.max(1)))
}

// ================================================================ pieces and layout (Yarn InGameHud.java)

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PieceId {
    None = 0,
    Hotbar = 1,
    SelectedSlot = 2,
    Offhand = 3,
    HotbarItem = 4,
    Crosshair = 5,
    XpBar = 6,
    Health = 7,
    Armor = 8,
    Food = 9,
    Air = 10,
    EffectIcon = 11,
    // phase 2
    ChatLine = 12,
    ItemName = 13,
    XpLevel = 14,
    Title = 15,
    Subtitle = 16,
    BossBar = 17,
    BossName = 18,
    MountHealth = 19,
    JumpBar = 20,
    DebugText = 21,
    // phase 3
    ActionBar = 22,
    SoundCaption = 23,
    /// Opt-in screen exclusion; dynamic contents are unknown, not fire evidence.
    InventoryPanel = 24,
    MenuButton = 25,
    RecipeBookPanel = 26,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PixelClass {
    None = 0,
    Opaque = 1,
    Translucent = 2,
    Unknown = 3,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Hand {
    /// The offhand slot drawn left of the hotbar (right-handed player).
    Left,
    /// The offhand slot drawn right of the hotbar (left-handed player).
    Right,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Sheet {
    Widgets,
    Icons,
    Inventory,
    Bars,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Effect {
    pub beneficial: bool,
    pub ambient: bool,
}

/// What the HUD shows, for composing synthetic frames (tests, demos). Detection never needs it.
#[derive(Clone, Debug, PartialEq)]
pub struct HudState {
    pub hud_hidden: bool,
    pub selected_slot: u8,
    pub offhand: Option<Hand>,
    /// Slots holding an item (the item itself is unknown content).
    pub items: [bool; 9],
    pub armor: u8,
    pub max_health: f32,
    pub absorption: f32,
    pub health: f32,
    pub hardcore: bool,
    pub poisoned: bool,
    pub food: u8,
    /// Air bubbles shown (`None`: not underwater).
    pub air: Option<u8>,
    pub status_bars: bool,
    pub xp_bar: bool,
    pub xp_progress: f32,
    pub effects: Vec<Effect>,
    /// Chat lines shown, newest (bottom) first.
    pub chat: Vec<String>,
    /// The held-item name shown above the bars after switching items.
    pub item_name: Option<String>,
    /// XP level (0: the number is not drawn).
    pub xp_level: u32,
    pub title: Option<String>,
    pub subtitle: Option<String>,
    pub boss_bars: Vec<BossBar>,
    /// Hearts of a ridden living mount (0: not riding one); replaces the food row.
    pub mount_hearts: u32,
    pub mount_health: f32,
    /// Jump power of a jumping mount; replaces the XP bar.
    pub jump_bar: Option<f32>,
    /// F3 lines, left and right column.
    pub debug_left: Vec<String>,
    pub debug_right: Vec<String>,
    /// Action bar message (bed, dismount, jukebox), centred above the hotbar without a shadow.
    pub action_bar: Option<String>,
    pub action_bar_color: [u8; 3],
    /// Opacity while it fades out over its last 20 ticks (1: fully shown).
    pub action_bar_alpha: f32,
    /// Sound captions (Accessibility > Show Subtitles), oldest (bottom) first.
    pub captions: Vec<Caption>,
}

/// Which side a caption's sound comes from (no arrow when it is in front).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CaptionArrow {
    Left,
    Right,
}

/// One sound caption: its text, its grey (255 when new, fading to 75 over 3 s) and its arrow.
#[derive(Clone, Debug, PartialEq)]
pub struct Caption {
    pub text: String,
    pub grey: u8,
    pub arrow: Option<CaptionArrow>,
}

/// A boss bar: colour index (pink, blue, red, green, yellow, purple, white = 0..6), progress 0..1, name.
#[derive(Clone, Debug, PartialEq)]
pub struct BossBar {
    pub color: u8,
    pub progress: f32,
    pub name: String,
}

impl Default for HudState {
    fn default() -> HudState {
        HudState {
            hud_hidden: false,
            selected_slot: 0,
            offhand: None,
            items: [false; 9],
            armor: 0,
            max_health: 20.0,
            absorption: 0.0,
            health: 20.0,
            hardcore: false,
            poisoned: false,
            food: 20,
            air: None,
            status_bars: true,
            xp_bar: true,
            xp_progress: 0.5,
            effects: Vec::new(),
            chat: Vec::new(),
            item_name: None,
            xp_level: 0,
            title: None,
            subtitle: None,
            boss_bars: Vec::new(),
            mount_hearts: 0,
            mount_health: 0.0,
            jump_bar: None,
            debug_left: Vec::new(),
            debug_right: Vec::new(),
            action_bar: None,
            action_bar_color: [255, 255, 255],
            action_bar_alpha: 1.0,
            captions: Vec::new(),
        }
    }
}

/// One texture rectangle drawn at the piece's origin (plus `dx`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Layer {
    pub sheet: Sheet,
    pub u: u32,
    pub v: u32,
    pub w: u32,
    pub h: u32,
    /// Offset of this layer inside the piece rectangle.
    pub dx: i32,
    pub dy: i32,
}

/// A HUD piece at its place, in GUI pixels of the scaled window.
#[derive(Clone, Debug, PartialEq)]
pub struct Placed {
    pub piece: PieceId,
    pub index: u8,
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
    pub layers: Vec<Layer>,
    /// Part of the rectangle (relative) whose content cannot be predicted (item, effect sprite, inverted world).
    pub unknown: Option<(i32, i32, u32, u32)>,
}

fn lay(sheet: Sheet, u: u32, v: u32, w: u32, h: u32) -> Layer {
    Layer {
        sheet,
        u,
        v,
        w,
        h,
        dx: 0,
        dy: 0,
    }
}

fn place(piece: PieceId, index: u8, x: i32, y: i32, w: u32, h: u32, layers: Vec<Layer>) -> Placed {
    Placed {
        piece,
        index,
        x,
        y,
        w,
        h,
        layers,
        unknown: None,
    }
}

/// Heart row count and spacing (`renderStatusBars` 734-738).
fn heart_rows(max_health: f32, absorption: f32) -> (i32, i32) {
    let q = ((max_health + absorption.ceil()) / 2.0 / 10.0)
        .ceil()
        .max(1.0) as i32;
    (q, (10 - (q - 2)).max(3))
}

/// Everything the HUD draws for `st` in a `w x h` scaled window, in drawing order.
pub fn hud_layout(w: u32, h: u32, st: &HudState) -> Vec<Placed> {
    let mut out = Vec::new();
    if st.hud_hidden {
        return out;
    }
    let (w, h) = (w as i32, h as i32);
    let c = w / 2;
    // renderHotbar 468-501
    out.push(place(
        PieceId::Hotbar,
        0,
        c - 91,
        h - 22,
        182,
        22,
        vec![lay(Sheet::Widgets, 0, 0, 182, 22)],
    ));
    let slot = st.selected_slot.min(8) as i32;
    out.push(place(
        PieceId::SelectedSlot,
        slot as u8,
        c - 92 + 20 * slot,
        h - 23,
        24,
        22,
        vec![lay(Sheet::Widgets, 0, 22, 24, 22)],
    ));
    match st.offhand {
        Some(Hand::Left) => out.push(place(
            PieceId::Offhand,
            0,
            c - 120,
            h - 23,
            29,
            24,
            vec![lay(Sheet::Widgets, 24, 22, 29, 24)],
        )),
        Some(Hand::Right) => out.push(place(
            PieceId::Offhand,
            1,
            c + 91,
            h - 23,
            29,
            24,
            vec![lay(Sheet::Widgets, 53, 22, 29, 24)],
        )),
        None => {}
    }
    for m in 0..9 {
        let mut p = place(
            PieceId::HotbarItem,
            m as u8,
            c - 88 + 20 * m,
            h - 19,
            16,
            16,
            vec![],
        );
        p.unknown = Some((0, 0, 16, 16));
        out.push(p);
    }
    if let Some(hand) = st.offhand {
        let x = if hand == Hand::Left { c - 117 } else { c + 101 };
        let mut p = place(PieceId::HotbarItem, 9, x, h - 19, 16, 16, vec![]);
        p.unknown = Some((0, 0, 16, 16));
        out.push(p);
    }
    // renderCrosshair 366: drawn with an inverting blend, so its pixels are the inverted world
    let mut cross = place(
        PieceId::Crosshair,
        0,
        (w - 15) / 2,
        (h - 15) / 2,
        15,
        15,
        vec![lay(Sheet::Icons, 0, 0, 15, 15)],
    );
    cross.unknown = Some((0, 0, 15, 15));
    out.push(cross);

    if st.status_bars {
        // renderStatusBars 706-879
        let (q, r) = heart_rows(st.max_health, st.absorption);
        let o = h - 39;
        let (m, n) = (c - 91, c + 91);
        let armor_y = o - (q - 1) * r - 10;
        if st.armor > 0 {
            for i in 0..10 {
                let a = st.armor as i32;
                let u = if i * 2 + 1 < a {
                    34
                } else if i * 2 + 1 == a {
                    25
                } else {
                    16
                };
                out.push(place(
                    PieceId::Armor,
                    i as u8,
                    m + i * 8,
                    armor_y,
                    9,
                    9,
                    vec![lay(Sheet::Icons, u, 9, 9, 9)],
                ));
            }
        }
        let cells = ((st.max_health + st.absorption.ceil()) / 2.0).ceil() as i32;
        let health = st.health.ceil() as i32;
        let p_abs = st.absorption.ceil() as i32;
        let mut u_abs = p_abs;
        let yx: u32 = if st.poisoned { 52 } else { 16 };
        let ad: u32 = if st.hardcore { 5 } else { 0 };
        let mut hearts = Vec::new();
        for xx in (0..cells).rev() {
            let aa = (xx + 1 + 9) / 10 - 1;
            let mut layers = vec![lay(Sheet::Icons, 16, 9 * ad, 9, 9)];
            if u_abs > 0 {
                if u_abs == p_abs && p_abs % 2 == 1 {
                    layers.push(lay(Sheet::Icons, yx + 153, 9 * ad, 9, 9));
                    u_abs -= 1;
                } else {
                    layers.push(lay(Sheet::Icons, yx + 144, 9 * ad, 9, 9));
                    u_abs -= 2;
                }
            } else if xx * 2 + 1 < health {
                layers.push(lay(Sheet::Icons, yx + 36, 9 * ad, 9, 9));
            } else if xx * 2 + 1 == health {
                layers.push(lay(Sheet::Icons, yx + 45, 9 * ad, 9, 9));
            }
            hearts.push(place(
                PieceId::Health,
                xx as u8,
                m + xx % 10 * 8,
                o - aa * r,
                9,
                9,
                layers,
            ));
        }
        hearts.reverse();
        out.extend(hearts);
        let k = st.food as i32;
        // the food row is replaced by the mount's hearts when riding a living mount (827-857, 881-915)
        for zx in 0..if st.mount_hearts == 0 { 10 } else { 0 } {
            let mut layers = vec![lay(Sheet::Icons, 16, 27, 9, 9)];
            if zx * 2 + 1 < k {
                layers.push(lay(Sheet::Icons, 52, 27, 9, 9));
            } else if zx * 2 + 1 == k {
                layers.push(lay(Sheet::Icons, 61, 27, 9, 9));
            }
            out.push(place(
                PieceId::Food,
                zx as u8,
                n - zx * 8 - 9,
                o,
                9,
                9,
                layers,
            ));
        }
        // renderMountHealth 881-915: rows of 10 from the food row upward
        let mount_rows = (st.mount_hearts as i32 + 9) / 10;
        let mount_hp = st.mount_health.ceil() as i32;
        for idx in 0..st.mount_hearts as i32 {
            let (row, p) = (idx / 10, idx % 10);
            let nn = row * 20;
            let mut layers = vec![lay(Sheet::Icons, 52, 9, 9, 9)];
            if p * 2 + 1 + nn < mount_hp {
                layers.push(lay(Sheet::Icons, 88, 9, 9, 9));
            } else if p * 2 + 1 + nn == mount_hp {
                layers.push(lay(Sheet::Icons, 97, 9, 9, 9));
            }
            out.push(place(
                PieceId::MountHealth,
                idx as u8,
                n - p * 8 - 9,
                o - row * 10,
                9,
                9,
                layers,
            ));
        }
        if let Some(b) = st.air {
            // t = o - 10, minus 10 for the food row, minus (getHeartRows(mount) - 1) * 10 (859-875)
            let air_y = if st.mount_hearts == 0 {
                o - 10
            } else {
                o - 10 * mount_rows
            };
            for ae in 0..(b.min(10) as i32) {
                out.push(place(
                    PieceId::Air,
                    ae as u8,
                    n - ae * 8 - 9,
                    air_y,
                    9,
                    9,
                    vec![lay(Sheet::Icons, 16, 18, 9, 9)],
                ));
            }
        }
    }
    if let Some(jump) = st.jump_bar {
        // renderMountJumpBar 525-538, drawn instead of the XP bar (188-193)
        let fill = (jump.clamp(0.0, 1.0) * 183.0) as u32;
        let mut layers = vec![lay(Sheet::Icons, 0, 84, 182, 5)];
        if fill > 0 {
            layers.push(lay(Sheet::Icons, 0, 89, fill, 5));
        }
        out.push(place(PieceId::JumpBar, 0, c - 91, h - 29, 182, 5, layers));
    } else if st.xp_bar {
        // renderExperienceBar 540-553: fill is (int)(progress * 183) wide
        let fill = (st.xp_progress.clamp(0.0, 1.0) * 183.0) as u32;
        let mut layers = vec![lay(Sheet::Icons, 0, 64, 182, 5)];
        if fill > 0 {
            layers.push(lay(Sheet::Icons, 0, 69, fill, 5));
        }
        out.push(place(PieceId::XpBar, 0, c - 91, h - 29, 182, 5, layers));
    }
    // BossBarHud 29-60: bars.png, 182x5 from y = 12, every 19 GUI px
    for (nb, b) in st.boss_bars.iter().enumerate() {
        let v = b.color.min(6) as u32 * 10;
        let fill = (b.progress.clamp(0.0, 1.0) * 183.0) as u32;
        let mut layers = vec![lay(Sheet::Bars, 0, v, 182, 5)];
        if fill > 0 {
            layers.push(lay(Sheet::Bars, 0, v + 5, fill, 5));
        }
        out.push(place(
            PieceId::BossBar,
            nb as u8,
            c - 91,
            12 + 19 * nb as i32,
            182,
            5,
            layers,
        ));
    }
    // renderStatusEffectOverlay 404-459
    let (mut i, mut j) = (0, 0);
    for (idx, e) in st.effects.iter().enumerate() {
        let (x, y) = if e.beneficial {
            i += 1;
            (w - 25 * i, 1)
        } else {
            j += 1;
            (w - 25 * j, 27)
        };
        let u = if e.ambient { 165 } else { 141 };
        let mut p = place(
            PieceId::EffectIcon,
            idx as u8,
            x,
            y,
            24,
            24,
            vec![lay(Sheet::Inventory, u, 166, 24, 24)],
        );
        p.unknown = Some((3, 3, 18, 18));
        out.push(p);
    }
    out
}

/// The piece's own picture: its layers composited over transparency (`out = src over dst`).
fn composite(tex: &GuiTextures, p: &Placed) -> Vec<[u8; 4]> {
    let (w, h) = (p.w as usize, p.h as usize);
    let mut img = vec![[0u8; 4]; w * h];
    for l in &p.layers {
        let Some(t) = tex.sheet(l.sheet) else {
            continue;
        };
        for ly in 0..l.h as i64 {
            for lx in 0..l.w as i64 {
                let (x, y) = (lx + l.dx as i64, ly + l.dy as i64);
                if x < 0 || y < 0 || x as usize >= w || y as usize >= h {
                    continue;
                }
                let (x, y) = (x as usize, y as usize);
                let s = t.texel(l.u as i64 + lx, l.v as i64 + ly);
                if s[3] == 0 {
                    continue;
                }
                let d = img[y * w + x];
                let sa = s[3] as f64 / 255.0;
                let da = d[3] as f64 / 255.0;
                let oa = sa + da * (1.0 - sa);
                let mut o = [0u8; 4];
                for k in 0..3 {
                    o[k] = ((s[k] as f64 * sa + d[k] as f64 * da * (1.0 - sa)) / oa.max(1e-9))
                        .round() as u8;
                }
                o[3] = (oa * 255.0).round() as u8;
                img[y * w + x] = o;
            }
        }
    }
    img
}

// ================================================================ mapping between GUI and video pixels

/// Where the scaled GUI sits in the video: video = origin + gui * scale.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GuiFit {
    /// Video pixels per GUI pixel.
    pub scale: f64,
    pub origin_x: f64,
    pub origin_y: f64,
    pub scaled_width: u32,
    pub scaled_height: u32,
}

/// Last checked geometry for one ordered stream/worker. Never stores a mask,
/// selected slot, item contents or panel decision. Do not share between workers.
/// Perf-lab experiment switches, see `detect_prepared`'s hint check.
pub static HINT_ROLLING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
pub static HINT_MIRROR: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);
#[derive(Debug, Default)]
pub struct GuiFitHint {
    previous: Option<(usize, usize, GuiFit, f64, f64)>,
    reused: bool,
}
impl GuiFitHint {
    /// Reset only the per-frame diagnostic, retaining checked geometry.
    pub fn begin_frame(&mut self) {
        self.reused = false;
    }
    pub fn reset(&mut self) {
        self.previous = None;
        self.reused = false;
    }
    pub fn reused(&self) -> bool {
        self.reused
    }
    fn at_size(&self, width: usize, height: usize) -> Option<(GuiFit, f64, f64)> {
        self.previous
            .filter(|&(w, h, _, _, _)| w == width && h == height)
            .map(|(_, _, fit, centre, edges)| (fit, centre, edges))
    }
}

impl GuiFit {
    /// The mapping of a `fb_w x fb_h` window at `gui_scale`, recorded and resized uniformly by `k`.
    pub fn framebuffer(fb_w: u32, fb_h: u32, gui_scale: u32, k: f64) -> GuiFit {
        let (sw, sh) = scaled_size(fb_w, fb_h, gui_scale);
        GuiFit {
            scale: gui_scale as f64 * k,
            origin_x: 0.0,
            origin_y: 0.0,
            scaled_width: sw,
            scaled_height: sh,
        }
    }

    /// The scaled window a `vw x vh` video implies at this scale (rounded up like `setScaleFactor`).
    fn for_video(scale: f64, vw: usize, vh: usize, origin_x: f64, origin_y: f64) -> GuiFit {
        let sw = (vw as f64 / scale - 1e-6).ceil().max(1.0) as u32;
        let sh = (vh as f64 / scale - 1e-6).ceil().max(1.0) as u32;
        GuiFit {
            scale,
            origin_x,
            origin_y,
            scaled_width: sw,
            scaled_height: sh,
        }
    }
}

/// Per-pixel truth of a composed frame.
#[derive(Clone, Debug, PartialEq)]
pub struct Truth {
    pub piece: Vec<u8>,
    pub class: Vec<u8>,
}

/// Draw the HUD of `st` onto an RGB frame the way the game would (alpha blending, nearest GUI pixel per video pixel),
/// returning the truth. Item boxes, effect sprites and the crosshair are unknown content in the truth too.
pub fn compose_hud(
    frame: &mut [u8],
    w: usize,
    h: usize,
    tex: &GuiTextures,
    st: &HudState,
    fit: &GuiFit,
) -> Truth {
    let mut truth = Truth {
        piece: vec![0; w * h],
        class: vec![0; w * h],
    };
    for p in hud_layout(fit.scaled_width, fit.scaled_height, st) {
        let img = composite(tex, &p);
        let (x0, y0, x1, y1) =
            video_rect(fit, p.x as f64, p.y as f64, p.w as f64, p.h as f64, w, h);
        for y in y0..y1 {
            let gy = ((y as f64 + 0.5 - fit.origin_y) / fit.scale).floor() as i64 - p.y as i64;
            if gy < 0 || gy >= p.h as i64 {
                continue;
            }
            for x in x0..x1 {
                let gx = ((x as f64 + 0.5 - fit.origin_x) / fit.scale).floor() as i64 - p.x as i64;
                if gx < 0 || gx >= p.w as i64 {
                    continue;
                }
                let i = y * w + x;
                let px = &mut frame[i * 3..i * 3 + 3];
                let in_unknown = p.unknown.is_some_and(|(ux, uy, uw, uh)| {
                    gx >= ux as i64
                        && gy >= uy as i64
                        && gx < (ux as i64 + uw as i64)
                        && gy < (uy as i64 + uh as i64)
                });
                if in_unknown {
                    match p.piece {
                        PieceId::Crosshair => {
                            let c = img[gy as usize * p.w as usize + gx as usize];
                            if c[3] > 0 {
                                for v in px.iter_mut() {
                                    *v = 255 - *v;
                                }
                            }
                        }
                        PieceId::HotbarItem => {
                            let slot = p.index as usize;
                            if slot < 9
                                && st.items[slot]
                                && (2..14).contains(&gx)
                                && (2..14).contains(&gy)
                            {
                                px.copy_from_slice(&[180, 60 + 15 * slot as u8, 40]);
                            }
                        }
                        _ => px.copy_from_slice(&[60, 140, 200]),
                    }
                    truth.piece[i] = p.piece as u8;
                    truth.class[i] = PixelClass::Unknown as u8;
                    continue;
                }
                let c = img[gy as usize * p.w as usize + gx as usize];
                if c[3] == 0 {
                    continue;
                }
                let a = c[3] as f64 / 255.0;
                for k in 0..3 {
                    px[k] = (c[k] as f64 * a + px[k] as f64 * (1.0 - a)).round() as u8;
                }
                truth.piece[i] = p.piece as u8;
                truth.class[i] = if c[3] == 255 {
                    PixelClass::Opaque
                } else {
                    PixelClass::Translucent
                } as u8;
            }
        }
    }
    compose_text(frame, w, h, tex, st, fit, &mut truth);
    truth
}

/// Video pixel bounds (clamped, exclusive end) covering a GUI rectangle, one pixel of margin.
fn video_rect(
    fit: &GuiFit,
    gx: f64,
    gy: f64,
    gw: f64,
    gh: f64,
    w: usize,
    h: usize,
) -> (usize, usize, usize, usize) {
    let x0 = (fit.origin_x + gx * fit.scale).floor() - 1.0;
    let y0 = (fit.origin_y + gy * fit.scale).floor() - 1.0;
    let x1 = (fit.origin_x + (gx + gw) * fit.scale).ceil() + 1.0;
    let y1 = (fit.origin_y + (gy + gh) * fit.scale).ceil() + 1.0;
    let c = |v: f64, m: usize| v.clamp(0.0, m as f64) as usize;
    (c(x0, w), c(y0, h), c(x1, w), c(y1, h))
}

// ================================================================ detection

/// Thresholds (all documented; defaults validated on synthetic frames, see the plan).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GuiOptions {
    /// Smallest video-pixels-per-GUI-pixel that is checked: below it a GUI pixel is smaller than a video pixel and the
    /// textures cannot be confirmed, so the frame is reported unreliable instead of guessed.
    pub min_scale: f64,
    /// Correlation (-1..1) the hotbar must reach for the GUI to be accepted at all.
    pub hotbar_min_score: f64,
    /// Correlation (-1..1) any other piece must reach to be reported.
    pub piece_min_score: f64,
    /// A video pixel "touches" a GUI pixel only if it overlaps it by more than this share of a video pixel (0..0.5):
    /// slivers thinner than that come from the last digits of the fitted scale, not from the picture.
    pub edge_tolerance_px: f64,
    /// Text: the brightest channel a text pixel must reach (0..255) before its shadow is looked for.
    pub text_min_bright: f64,
    /// Text: how far (levels, per channel) the shadow may be from exactly a quarter of the text colour.
    pub text_shadow_tolerance: f64,
    /// Text: how many text pixels with their shadow a line needs before it is reported.
    pub text_min_hits: usize,
    /// Text: like `edge_tolerance_px`, for text strokes (one GUI pixel wide, so the last digits of a scale that does not
    /// divide the video evenly push most of them across a pixel edge): overlaps thinner than this are ignored.
    pub text_edge_tolerance_px: f64,
    /// Action bar: how far (levels of luma) a pixel may be from the line's colour and still count as ink; each channel
    /// may be three times as far (video halves chroma, smearing a thin coloured stroke). The line has no shadow, so this
    /// only feeds the glyph parse, which is the real evidence. Too wide and bright world behind the text reads as ink.
    pub action_bar_color_tolerance: f64,
    /// Action bar: the share of the parsed glyphs' ink that may disagree with the picture (stray or missing pixels,
    /// from compression or bright world behind the text) for the line to be accepted.
    pub action_bar_max_mismatch: f64,
    /// Action bar: the fewest non-space glyphs a line needs (one or two glyphs are too easy to match by chance).
    pub action_bar_min_glyphs: usize,
    /// Action bar: the loosest tolerance (levels of luma) a line already found at `action_bar_color_tolerance` is
    /// re-read at (1.5x, 2x, 3x that, up to this): video smears a thin coloured stroke over varied ground, so the tight
    /// pass can lose a glyph or two at the ends. A re-read may only keep or widen the same centred line, and wins
    /// only if it reads at least as cleanly.
    pub action_bar_reread_tolerance: f64,
    /// Action bar: what each non-space glyph costs, in ink pixels, when readings of the band are compared (a reading
    /// scores the ink it explains minus its mismatches minus this per glyph; spaces are free). Letters explain 8-15
    /// pixels; a '.' or ''' laid over a bright world speck explains one or two, so with a cost above that, padding a
    /// line or filling a word gap with specks never pays.
    pub action_bar_glyph_cost: f64,
    /// Captions: the brightest a pixel inside a caption box may be (levels, max channel) when it is not text. The box
    /// is black at alpha 204, so the world shows at 0.2: at most 51, plus compression.
    pub caption_dim_max: f64,
    /// Captions: how far (levels of luma) a text pixel may be from its line's grey.
    pub caption_ink_tolerance: f64,
    /// Captions: the share of a box's GUI pixels that must be dim or text for the box to be accepted.
    pub caption_min_dim_share: f64,
}

impl Default for GuiOptions {
    fn default() -> GuiOptions {
        GuiOptions {
            min_scale: 1.0,
            hotbar_min_score: 0.8,
            piece_min_score: 0.8,
            edge_tolerance_px: 0.05,
            text_min_bright: 96.0,
            text_shadow_tolerance: 10.0,
            text_min_hits: 8,
            text_edge_tolerance_px: 0.3,
            action_bar_color_tolerance: 8.0,
            action_bar_max_mismatch: 0.15,
            action_bar_min_glyphs: 3,
            action_bar_glyph_cost: 4.0,
            action_bar_reread_tolerance: 24.0,
            caption_dim_max: 72.0,
            caption_ink_tolerance: 24.0,
            caption_min_dim_share: 0.95,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct PieceHit {
    pub piece: PieceId,
    pub index: u8,
    /// The piece's rectangle in video pixels.
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
    pub score: f64,
    /// The text read from the picture (action bar), when the piece is read glyph by glyph.
    pub text: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct GuiMask {
    pub width: usize,
    pub height: usize,
    /// `PieceId` per pixel (0 = no GUI).
    pub piece: Vec<u8>,
    /// `PixelClass` per pixel.
    pub class: Vec<u8>,
    pub fit: Option<GuiFit>,
    /// Whether the vanilla HUD/hotbar fit was confirmed. Independent source
    /// panels may still supply neutral regions when this is false.
    pub reliable: bool,
    pub hits: Vec<PieceHit>,
    pub notes: Vec<String>,
}

/// A template: luma of the piece's opaque pixels, at GUI pixel coordinates relative to the piece.
struct Template {
    pts: Vec<(f64, f64, f64)>,
    sum: f64,
    squares: f64,
    bounds: [f64; 4],
    grid: Option<SampleGrid>,
}

// Sampling geometry is immutable. Large templates revisit the same columns
// and rows thousands of times per fit; transform each coordinate only once.
// These are scratch-space limits, not assumptions about Minecraft layouts.
const SAMPLE_COLUMNS: usize = 512;
const SAMPLE_ROWS: usize = 128;
struct SampleGrid {
    columns: Vec<f64>,
    rows: Vec<f64>,
    points: Vec<(u16, u16)>,
}
impl SampleGrid {
    fn new(pts: &[(f64, f64, f64)]) -> Option<Self> {
        if pts.len() < 32 {
            return None;
        }
        let (mut columns, mut rows) = (Vec::new(), Vec::new());
        let (mut xs, mut ys) = (HashMap::new(), HashMap::new());
        let mut points = Vec::with_capacity(pts.len());
        for &(u, v, _) in pts {
            let xi = *xs.entry(u.to_bits()).or_insert_with(|| {
                columns.push(u);
                (columns.len() - 1) as u16
            });
            let yi = *ys.entry(v.to_bits()).or_insert_with(|| {
                rows.push(v);
                (rows.len() - 1) as u16
            });
            if columns.len() > SAMPLE_COLUMNS || rows.len() > SAMPLE_ROWS {
                return None;
            }
            points.push((xi, yi));
        }
        Some(Self {
            columns,
            rows,
            points,
        })
    }

    fn sums(
        &self,
        lum: &LumaRows<'_>,
        pts: &[(f64, f64, f64)],
        x: f64,
        y: f64,
        s: f64,
    ) -> (f64, f64, f64) {
        if self.columns.len() <= 32 && self.rows.len() <= 32 {
            self.sums_sized::<32, 32>(lum, pts, x, y, s)
        } else {
            self.sums_sized::<SAMPLE_COLUMNS, SAMPLE_ROWS>(lum, pts, x, y, s)
        }
    }

    fn sums_sized<const C: usize, const R: usize>(
        &self,
        lum: &LumaRows<'_>,
        pts: &[(f64, f64, f64)],
        x: f64,
        y: f64,
        s: f64,
    ) -> (f64, f64, f64) {
        let mut columns = [0; C];
        let mut rows: [&[f64]; R] = [&[]; R];
        for (dest, &u) in columns.iter_mut().zip(&self.columns) {
            *dest = (x + u * s) as usize;
        }
        for (dest, &v) in rows.iter_mut().zip(&self.rows) {
            *dest = lum.row((y + v * s) as usize);
        }
        let (mut sb, mut sbb, mut sab) = (0., 0., 0.);
        for (&(xi, yi), &(_, _, a)) in self.points.iter().zip(pts) {
            let b = rows[yi as usize][columns[xi as usize]];
            sb += b;
            sbb += b * b;
            sab += a * b;
        }
        (sb, sbb, sab)
    }
}
impl Template {
    fn new(pts: Vec<(f64, f64, f64)>) -> Self {
        let (mut sum, mut squares) = (0., 0.);
        let mut bounds = [
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        ];
        for &(u, v, a) in &pts {
            sum += a;
            squares += a * a;
            bounds[0] = bounds[0].min(u);
            bounds[1] = bounds[1].min(v);
            bounds[2] = bounds[2].max(u);
            bounds[3] = bounds[3].max(v);
        }
        let grid = SampleGrid::new(&pts);
        Self {
            pts,
            sum,
            squares,
            bounds,
            grid,
        }
    }
}

/// Per-frame row cache: calculate identical luminance only where templates
/// sample it, rather than allocating/converting the entire video frame.
struct LumaRows<'a> {
    rgb: &'a [u8],
    width: usize,
    rows: Vec<OnceCell<Vec<f64>>>,
}
impl<'a> LumaRows<'a> {
    fn new(rgb: &'a [u8], width: usize, height: usize) -> Self {
        Self {
            rgb,
            width,
            rows: (0..height).map(|_| OnceCell::new()).collect(),
        }
    }
    fn at(&self, x: usize, y: usize) -> f64 {
        self.row(y)[x]
    }
    fn row(&self, y: usize) -> &[f64] {
        self.rows[y].get_or_init(|| {
            self.rgb[y * self.width * 3..(y + 1) * self.width * 3]
                .as_chunks::<3>()
                .0
                .iter()
                .map(|p| luma(p[0], p[1], p[2]))
                .collect()
        })
    }
}

struct CompiledRow {
    y: usize,
    points: Vec<(usize, f64)>,
}
struct CompiledTemplate {
    rows: Vec<CompiledRow>,
    inside: usize,
    sum: f64,
    variance: f64,
    valid: bool,
}
impl CompiledTemplate {
    fn new(t: &Template, x: f64, y: f64, s: f64, w: usize, h: usize) -> Self {
        let mut rows: Vec<CompiledRow> = Vec::new();
        let (mut count, mut inside, mut sum, mut squares) = (0, 0, 0., 0.);
        for &(u, v, a) in t.pts.iter().step_by(3) {
            count += 1;
            let px = x + u * s;
            let py = y + v * s;
            if px < 0. || py < 0. || px >= w as f64 || py >= h as f64 {
                continue;
            }
            let py = py as usize;
            if rows.last().is_none_or(|r| r.y != py) {
                rows.push(CompiledRow {
                    y: py,
                    points: Vec::new(),
                });
            }
            rows.last_mut().unwrap().points.push((px as usize, a));
            inside += 1;
            sum += a;
            squares += a * a;
        }
        let variance = squares - sum * sum / inside.max(1) as f64;
        let valid =
            count > 0 && inside as f64 >= 0.6 * count as f64 && variance > 1e-9 * inside as f64;
        Self {
            rows,
            inside,
            sum,
            variance,
            valid,
        }
    }
    fn score(&self, lum: &LumaRows<'_>) -> Option<f64> {
        if !self.valid {
            return None;
        }
        let (mut sum, mut squares, mut product) = (0., 0., 0.);
        for r in &self.rows {
            let row = lum.row(r.y);
            for &(x, a) in &r.points {
                let b = row[x];
                sum += b;
                squares += b * b;
                product += a * b;
            }
        }
        let m = self.inside as f64;
        let variance = squares - sum * sum / m;
        if variance <= 1e-6 * m {
            return None;
        }
        Some((product - self.sum * sum / m) / (self.variance * variance).sqrt())
    }
}

struct CoarsePlan {
    width: usize,
    height: usize,
    scales: Vec<(f64, Vec<CompiledTemplate>)>,
}
impl CoarsePlan {
    fn new(w: usize, h: usize, min: f64, hotbar: &HotbarTemplates) -> Self {
        let mut scales = Vec::new();
        let mut s = min;
        while s <= w as f64 / 182. {
            let f = GuiFit::for_video(s, w, h, 0., 0.);
            let x = (f.scaled_width as i32 / 2 - 91) as f64 * s;
            let y = (f.scaled_height as i32 - 22) as f64 * s;
            let templates = hotbar
                .flat
                .iter()
                .map(|t| CompiledTemplate::new(t, x - s, y - s, s, w, h))
                .collect();
            scales.push((s, templates));
            s *= 1.005;
        }
        Self {
            width: w,
            height: h,
            scales,
        }
    }
}

struct HotbarTemplates {
    hotbar: Placed,
    flat: Vec<Template>,
    edges: Vec<Template>,
}

#[derive(Hash, PartialEq, Eq)]
enum ShapeLayers {
    Empty,
    One(Layer),
    Two([Layer; 2]),
    Many(Vec<Layer>),
}
impl From<&[Layer]> for ShapeLayers {
    fn from(layers: &[Layer]) -> Self {
        match layers {
            [] => Self::Empty,
            [one] => Self::One(*one),
            [one, two] => Self::Two([*one, *two]),
            many => Self::Many(many.to_vec()),
        }
    }
}

#[derive(Hash, PartialEq, Eq)]
struct ShapeKey {
    width: u32,
    height: u32,
    layers: ShapeLayers,
    unknown: Option<(i32, i32, u32, u32)>,
}
type ShapeCache = RwLock<HashMap<ShapeKey, Arc<Template>>>;
fn piece_template(tex: &GuiTextures, p: &Placed, cache: Option<&ShapeCache>) -> Arc<Template> {
    let build = || {
        template(
            &composite(tex, p),
            p.w as usize,
            p.h as usize,
            false,
            p.unknown,
        )
    };
    let Some(cache) = cache else {
        return Arc::new(build());
    };
    let key = ShapeKey {
        width: p.w,
        height: p.h,
        layers: p.layers.as_slice().into(),
        unknown: p.unknown,
    };
    if let Some(t) = cache.read().unwrap_or_else(|e| e.into_inner()).get(&key) {
        return t.clone();
    }
    cache
        .write()
        .unwrap_or_else(|e| e.into_inner())
        .entry(key)
        .or_insert_with(|| Arc::new(build()))
        .clone()
}
impl HotbarTemplates {
    fn new(tex: &GuiTextures) -> Self {
        let hotbar = hud_layout(
            320,
            240,
            &HudState {
                status_bars: false,
                xp_bar: false,
                ..HudState::default()
            },
        )
        .into_iter()
        .find(|p| p.piece == PieceId::Hotbar)
        .expect("hotbar layout");
        let pairs: Vec<_> = (0..9)
            .map(|slot| {
                let mut hot = lay(Sheet::Widgets, 0, 0, 182, 22);
                (hot.dx, hot.dy) = (1, 1);
                let mut sel = lay(Sheet::Widgets, 0, 22, 24, 22);
                (sel.dx, sel.dy) = (20 * slot, 0);
                composite(
                    tex,
                    &place(PieceId::Hotbar, 0, 0, 0, 184, 24, vec![hot, sel]),
                )
            })
            .collect();
        let flat = pairs
            .iter()
            .map(|img| template(img, 184, 24, true, None))
            .collect();
        let edges = pairs
            .iter()
            .map(|img| corners(&template(img, 184, 24, false, None)))
            .collect();
        Self {
            hotbar,
            flat,
            edges,
        }
    }
}

/// Reusable GUI templates. `detect` is stateless; `detect_with_hint` accepts
/// explicitly owned prior geometry, verified against the current frame.
pub struct GuiDetector {
    textures: GuiTextures,
    options: GuiOptions,
    hotbar: HotbarTemplates,
    coarse: Mutex<Option<Arc<CoarsePlan>>>,
    shapes: ShapeCache,
}
#[derive(Debug, Default)]
pub struct GuiTimings {
    pub fit_ms: f64,
    pub pieces_ms: f64,
    pub text_ms: f64,
    /// Thread CPU cycles of the same three stages (perf lab).
    pub fit_cycles: u64,
    pub pieces_cycles: u64,
    pub text_cycles: u64,
}
impl GuiDetector {
    pub fn new(textures: GuiTextures, options: GuiOptions) -> Result<Self, String> {
        check_options(&options)?;
        let hotbar = HotbarTemplates::new(&textures);
        Ok(Self {
            textures,
            options,
            hotbar,
            coarse: Mutex::new(None),
            shapes: RwLock::new(HashMap::new()),
        })
    }
    pub fn textures(&self) -> &GuiTextures {
        &self.textures
    }
    fn plan(&self, width: usize, height: usize) -> Arc<CoarsePlan> {
        let mut cache = self.coarse.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(plan) = cache
            .as_ref()
            .filter(|p| p.width == width && p.height == height)
        {
            return plan.clone();
        }
        let plan = Arc::new(CoarsePlan::new(
            width,
            height,
            self.options.min_scale,
            &self.hotbar,
        ));
        *cache = Some(plan.clone());
        plan
    }
    /// Optional prewarm: all cached data is geometry/template-only.
    pub fn prepare(&self, width: usize, height: usize) {
        let _ = self.plan(width, height);
        if let Some(detector) = &self.textures.interactions {
            let _ = detector.prepare(width, height);
        }
    }
    pub fn detect(&self, frame: &[u8], width: usize, height: usize) -> Result<GuiMask, String> {
        if width == 0
            || height == 0
            || width.checked_mul(height).and_then(|n| n.checked_mul(3)) != Some(frame.len())
        {
            return Err("invalid GUI frame dimensions".into());
        }
        let plan = self.plan(width, height);
        let mut mask = detect_prepared(
            frame,
            width,
            height,
            &self.textures,
            &self.options,
            &self.hotbar,
            Some(&plan),
            Some(&self.shapes),
            None,
            None,
        )?;
        self.merge_interactions(frame, width, height, &mut mask)?;
        Ok(mask)
    }
    /// Verify the last successful fit on this frame before using it. If its
    /// current opaque hotbar evidence is weak, run the original full search.
    pub fn detect_with_hint(
        &self,
        frame: &[u8],
        width: usize,
        height: usize,
        hint: &mut GuiFitHint,
    ) -> Result<GuiMask, String> {
        hint.begin_frame();
        if width == 0
            || height == 0
            || width.checked_mul(height).and_then(|n| n.checked_mul(3)) != Some(frame.len())
        {
            hint.reset();
            return Err("invalid GUI frame dimensions".into());
        }
        let plan = self.plan(width, height);
        let mut times = GuiTimings::default();
        let result = detect_prepared(
            frame,
            width,
            height,
            &self.textures,
            &self.options,
            &self.hotbar,
            Some(&plan),
            Some(&self.shapes),
            Some(&mut times),
            Some(hint),
        )
        .and_then(|mut mask| {
            let timer = crate::profile::start(9);
            self.merge_interactions(frame, width, height, &mut mask)?;
            drop(timer);
            Ok(mask)
        });
        crate::profile::record(6, times.fit_ms, times.fit_cycles);
        crate::profile::record(7, times.pieces_ms, times.pieces_cycles);
        crate::profile::record(8, times.text_ms, times.text_cycles);
        match &result {
            Ok(mask) if mask.fit.is_none() => hint.reset(),
            Ok(_) => {}
            Err(_) => hint.reset(),
        }
        result
    }
    fn merge_interactions(
        &self,
        frame: &[u8],
        width: usize,
        height: usize,
        mask: &mut GuiMask,
    ) -> Result<(), String> {
        if let Some(detector) = &self.textures.interactions {
            let hud_scale = mask.fit.filter(|_| mask.reliable).map(|fit| fit.scale);
            detector
                .detect_with_scale(frame, width, height, hud_scale)?
                .merge_neutral_panel(mask)?;
        }
        Ok(())
    }
    pub fn detect_timed(
        &self,
        frame: &[u8],
        width: usize,
        height: usize,
    ) -> Result<(GuiMask, GuiTimings), String> {
        if width == 0
            || height == 0
            || width.checked_mul(height).and_then(|n| n.checked_mul(3)) != Some(frame.len())
        {
            return Err("invalid GUI frame dimensions".into());
        }
        let plan = self.plan(width, height);
        let begin = std::time::Instant::now();
        let mut times = GuiTimings::default();
        let mut mask = detect_prepared(
            frame,
            width,
            height,
            &self.textures,
            &self.options,
            &self.hotbar,
            Some(&plan),
            Some(&self.shapes),
            Some(&mut times),
            None,
        )?;
        if !mask.reliable {
            times.fit_ms = begin.elapsed().as_secs_f64() * 1000.;
        }
        self.merge_interactions(frame, width, height, &mut mask)?;
        Ok((mask, times))
    }
}

fn luma(r: u8, g: u8, b: u8) -> f64 {
    0.299 * r as f64 + 0.587 * g as f64 + 0.114 * b as f64
}

/// Opaque pixels of a piece picture; `flat_only` keeps those whose 8 neighbours are identical (robust to blur and
/// sub-pixel misalignment), falling back to all opaque pixels when too few are flat.
fn template(
    img: &[[u8; 4]],
    w: usize,
    h: usize,
    flat_only: bool,
    skip: Option<(i32, i32, u32, u32)>,
) -> Template {
    let skipped = |x: usize, y: usize| {
        skip.is_some_and(|(ux, uy, uw, uh)| {
            (x as i32) >= ux
                && (y as i32) >= uy
                && (x as i32) < ux + uw as i32
                && (y as i32) < uy + uh as i32
        })
    };
    let opaque: Vec<(usize, usize)> = (0..h)
        .flat_map(|y| (0..w).map(move |x| (x, y)))
        .filter(|&(x, y)| img[y * w + x][3] == 255 && !skipped(x, y))
        .collect();
    let flat: Vec<(usize, usize)> = opaque
        .iter()
        .copied()
        .filter(|&(x, y)| {
            (-1i64..=1).all(|dy| {
                (-1i64..=1).all(|dx| {
                    let (nx, ny) = (x as i64 + dx, y as i64 + dy);
                    nx >= 0
                        && ny >= 0
                        && (nx as usize) < w
                        && (ny as usize) < h
                        && img[ny as usize * w + nx as usize] == img[y * w + x]
                })
            })
        })
        .collect();
    let chosen = if flat_only && flat.len() >= 40 {
        flat
    } else {
        opaque
    };
    let pts = chosen.into_iter().map(|(x, y)| {
        let c = img[y * w + x];
        (x as f64 + 0.5, y as f64 + 0.5, luma(c[0], c[1], c[2]))
    });
    Template::new(pts.collect())
}

/// The same points sampled near the four corners of each GUI pixel instead of its centre: any scale or offset error moves
/// a sample across a pixel edge, so the correlation peaks sharply at the true fit (centre sampling forgives a third of a
/// GUI pixel and leaves a plateau).
fn corners(t: &Template) -> Template {
    let mut pts = Vec::with_capacity(t.pts.len() * 4);
    for &(u, v, a) in &t.pts {
        for (du, dv) in [(-0.35, -0.35), (0.35, -0.35), (-0.35, 0.35), (0.35, 0.35)] {
            pts.push((u + du, v + dv, a));
        }
    }
    Template::new(pts)
}

/// Zero-normalised cross-correlation of a template placed with its GUI origin at video (`x`, `y`), `s` video px per GUI
/// px. `None` when fewer than 60% of the points fall inside the frame or either side is flat.
#[allow(clippy::too_many_arguments)]
/// One-place patch cache for `score`'s all-in-frame path: the sampled luma
/// values `b` and their sums depend only on the sampled coordinates, so
/// consecutive templates with the same point coordinates at the same place
/// reuse them. Every value is produced by the same expressions, in the same
/// order, as `score`; clipped or sub-sampled cases fall back to `score`.
#[derive(Default)]
struct PatchSampler {
    key: Option<(u64, u64, u64)>,
    coords: Vec<(f64, f64)>,
    samples: Vec<f64>,
    sb: f64,
    sbb: f64,
}
impl PatchSampler {
    fn score(
        &mut self,
        lum: &LumaRows<'_>,
        w: usize,
        h: usize,
        t: &Template,
        x: f64,
        y: f64,
        s: f64,
    ) -> Option<f64> {
        let in_frame = !t.pts.is_empty()
            && x + t.bounds[0] * s >= 0.
            && y + t.bounds[1] * s >= 0.
            && x + t.bounds[2] * s < w as f64
            && y + t.bounds[3] * s < h as f64;
        if !in_frame {
            return score(lum, w, h, t, x, y, s, 1);
        }
        let key = (x.to_bits(), y.to_bits(), s.to_bits());
        let same_coords = self.key == Some(key)
            && self.coords.len() == t.pts.len()
            && self
                .coords
                .iter()
                .zip(&t.pts)
                .all(|(&(cu, cv), &(u, v, _))| {
                    cu.to_bits() == u.to_bits() && cv.to_bits() == v.to_bits()
                });
        if !same_coords {
            self.key = Some(key);
            self.coords.clear();
            self.samples.clear();
            let (mut sb, mut sbb) = (0., 0.);
            for &(u, v, _) in &t.pts {
                let b = lum.at((x + u * s) as usize, (y + v * s) as usize);
                self.coords.push((u, v));
                self.samples.push(b);
                sb += b;
                sbb += b * b;
            }
            self.sb = sb;
            self.sbb = sbb;
        }
        let mut sab = 0.;
        for (&(_, _, a), &b) in t.pts.iter().zip(&self.samples) {
            sab += a * b;
        }
        let m = t.pts.len() as f64;
        let va = t.squares - t.sum * t.sum / m;
        let vb = self.sbb - self.sb * self.sb / m;
        if va <= 1e-9 * m || vb <= 1e-6 * m {
            return None;
        }
        Some((sab - t.sum * self.sb / m) / (va * vb).sqrt())
    }
}

fn score(
    lum: &LumaRows<'_>,
    w: usize,
    h: usize,
    t: &Template,
    x: f64,
    y: f64,
    s: f64,
    step: usize,
) -> Option<f64> {
    // All-in-frame templates have invariant reference sums. Preserve the exact
    // point order for observed sums and dot products; clipped cases use the
    // original per-point boundary arithmetic below.
    if step == 1
        && !t.pts.is_empty()
        && x + t.bounds[0] * s >= 0.
        && y + t.bounds[1] * s >= 0.
        && x + t.bounds[2] * s < w as f64
        && y + t.bounds[3] * s < h as f64
    {
        let (sb, sbb, sab) = if let Some(grid) = &t.grid {
            grid.sums(lum, &t.pts, x, y, s)
        } else {
            let (mut sb, mut sbb, mut sab) = (0., 0., 0.);
            for &(u, v, a) in &t.pts {
                let b = lum.at((x + u * s) as usize, (y + v * s) as usize);
                sb += b;
                sbb += b * b;
                sab += a * b;
            }
            (sb, sbb, sab)
        };
        let m = t.pts.len() as f64;
        let va = t.squares - t.sum * t.sum / m;
        let vb = sbb - sb * sb / m;
        if va <= 1e-9 * m || vb <= 1e-6 * m {
            return None;
        }
        return Some((sab - t.sum * sb / m) / (va * vb).sqrt());
    }
    let (mut n, mut inside, mut sa, mut sb, mut saa, mut sbb, mut sab) =
        (0usize, 0usize, 0.0, 0.0, 0.0, 0.0, 0.0);
    for &(u, v, a) in t.pts.iter().step_by(step.max(1)) {
        n += 1;
        let px = x + u * s;
        let py = y + v * s;
        if px < 0.0 || py < 0.0 || px >= w as f64 || py >= h as f64 {
            continue;
        }
        inside += 1;
        let b = lum.at(px as usize, py as usize);
        sa += a;
        sb += b;
        saa += a * a;
        sbb += b * b;
        sab += a * b;
    }
    if n == 0 || (inside as f64) < 0.6 * n as f64 {
        return None;
    }
    let m = inside as f64;
    let va = saa - sa * sa / m;
    let vb = sbb - sb * sb / m;
    if va <= 1e-9 * m || vb <= 1e-6 * m {
        return None;
    }
    Some((sab - sa * sb / m) / (va * vb).sqrt())
}

fn check_options(o: &GuiOptions) -> Result<(), String> {
    if !(o.min_scale.is_finite() && o.min_scale > 0.0) {
        return Err(format!("min_scale must be > 0, got {}", o.min_scale));
    }
    for (name, v) in [
        ("hotbar_min_score", o.hotbar_min_score),
        ("piece_min_score", o.piece_min_score),
    ] {
        if !(v.is_finite() && (-1.0..=1.0).contains(&v)) {
            return Err(format!("{name} must be in -1..1, got {v}"));
        }
    }
    if !(o.text_min_bright.is_finite() && (0.0..=255.0).contains(&o.text_min_bright)) {
        return Err(format!(
            "text_min_bright must be in 0..255, got {}",
            o.text_min_bright
        ));
    }
    if !(o.text_shadow_tolerance.is_finite() && (0.0..=64.0).contains(&o.text_shadow_tolerance)) {
        return Err(format!(
            "text_shadow_tolerance must be in 0..64, got {}",
            o.text_shadow_tolerance
        ));
    }
    if !(o.text_edge_tolerance_px.is_finite() && (0.0..0.5).contains(&o.text_edge_tolerance_px)) {
        return Err(format!(
            "text_edge_tolerance_px must be in 0..0.5, got {}",
            o.text_edge_tolerance_px
        ));
    }
    if o.text_min_hits == 0 {
        return Err("text_min_hits must be at least 1".into());
    }
    if !(o.action_bar_color_tolerance.is_finite()
        && (0.0..=128.0).contains(&o.action_bar_color_tolerance))
    {
        return Err(format!(
            "action_bar_color_tolerance must be in 0..128, got {}",
            o.action_bar_color_tolerance
        ));
    }
    if !(o.action_bar_max_mismatch.is_finite() && (0.0..1.0).contains(&o.action_bar_max_mismatch)) {
        return Err(format!(
            "action_bar_max_mismatch must be in 0..1, got {}",
            o.action_bar_max_mismatch
        ));
    }
    if !(o.action_bar_glyph_cost.is_finite() && (0.0..=64.0).contains(&o.action_bar_glyph_cost)) {
        return Err(format!(
            "action_bar_glyph_cost must be in 0..64, got {}",
            o.action_bar_glyph_cost
        ));
    }
    if !(o.action_bar_reread_tolerance.is_finite()
        && (0.0..=128.0).contains(&o.action_bar_reread_tolerance))
    {
        return Err(format!(
            "action_bar_reread_tolerance must be in 0..128, got {}",
            o.action_bar_reread_tolerance
        ));
    }
    for (name, v) in [
        ("caption_dim_max", o.caption_dim_max),
        ("caption_ink_tolerance", o.caption_ink_tolerance),
    ] {
        if !(v.is_finite() && (0.0..=255.0).contains(&v)) {
            return Err(format!("{name} must be in 0..255, got {v}"));
        }
    }
    if !(o.caption_min_dim_share.is_finite() && (0.0..=1.0).contains(&o.caption_min_dim_share)) {
        return Err(format!(
            "caption_min_dim_share must be in 0..1, got {}",
            o.caption_min_dim_share
        ));
    }
    if o.action_bar_min_glyphs == 0 {
        return Err("action_bar_min_glyphs must be at least 1".into());
    }
    if !(o.edge_tolerance_px.is_finite() && (0.0..0.5).contains(&o.edge_tolerance_px)) {
        return Err(format!(
            "edge_tolerance_px must be in 0..0.5, got {}",
            o.edge_tolerance_px
        ));
    }
    Ok(())
}

/// Find the vanilla HUD in an RGB24 frame and label every pixel. Never fails on content, only on bad input.
pub fn detect_gui(
    frame: &[u8],
    w: usize,
    h: usize,
    tex: &GuiTextures,
    opts: &GuiOptions,
) -> Result<GuiMask, String> {
    let prepared = HotbarTemplates::new(tex);
    detect_prepared(frame, w, h, tex, opts, &prepared, None, None, None, None)
}

#[allow(clippy::too_many_arguments)] // Explicit frame geometry and independent detector inputs.
fn detect_prepared(
    frame: &[u8],
    w: usize,
    h: usize,
    tex: &GuiTextures,
    opts: &GuiOptions,
    prepared: &HotbarTemplates,
    coarse_plan: Option<&CoarsePlan>,
    shape_cache: Option<&ShapeCache>,
    mut times: Option<&mut GuiTimings>,
    mut hint: Option<&mut GuiFitHint>,
) -> Result<GuiMask, String> {
    let begin = std::time::Instant::now();
    let cycles = crate::profile::thread_cycles();
    if w == 0 || h == 0 || frame.len() != w * h * 3 {
        return Err(format!(
            "frame must be {w}x{h} RGB24 ({} bytes), got {}",
            w * h * 3,
            frame.len()
        ));
    }
    check_options(opts)?;
    let lum = LumaRows::new(frame, w, h);
    let mut mask = GuiMask {
        width: w,
        height: h,
        piece: vec![0; w * h],
        class: vec![0; w * h],
        fit: None,
        reliable: false,
        hits: Vec::new(),
        notes: Vec::new(),
    };

    // --- scale fit on the hotbar frame
    let hotbar = &prepared.hotbar;
    let flat_t = &prepared.flat;
    let all_t = &prepared.edges;
    let best_slot = |t: &[Template], x: f64, y: f64, s: f64, step: usize| -> Option<f64> {
        t.iter()
            .filter_map(|t| score(&lum, w, h, t, x - s, y - s, s, step))
            .reduce(f64::max)
    };
    let max_scale = w as f64 / 182.0;
    if max_scale < opts.min_scale {
        mask.notes.push(format!(
            "the frame is too small for a hotbar at scale >= {}",
            opts.min_scale
        ));
        return Ok(mask);
    }
    let anchor = |s: f64| -> (f64, f64, GuiFit) {
        let f = GuiFit::for_video(s, w, h, 0.0, 0.0);
        let (sw, sh) = (f.scaled_width as i32, f.scaled_height as i32);
        ((sw / 2 - 91) as f64 * s, (sh - 22) as f64 * s, f)
    };
    const TIE: f64 = 1e-3;
    let misfit_of = |se: f64| {
        let frac = |d: f64| (d / se - (d / se).round()).abs();
        if (se - se.round()).abs() < 1e-9 {
            -1.0
        } else {
            frac(w as f64).max(frac(h as f64))
        }
    };
    // A hint is only a proposed geometry. Re-check all current selection variants
    // against opaque centre and edge samples; weak or missing evidence falls back.
    let checked_hint = hint.as_ref().and_then(|hint| hint.at_size(w, h)).and_then(
        |(fit, reference_centre, reference_edges)| {
            if !fit.scale.is_finite() || fit.scale < opts.min_scale || fit.scale > max_scale {
                crate::profile::count(22, 1);
                return None;
            }
            let x = fit.origin_x + (fit.scaled_width as i32 / 2 - 91) as f64 * fit.scale;
            let y = fit.origin_y + (fit.scaled_height as i32 - 22) as f64 * fit.scale;
            if fit.origin_x != 0. || fit.origin_y != 0. {
                crate::profile::count(22, 1);
                return None;
            }
            let (fit, centre, edges, x, y, slot) = flat_t
                .iter()
                .zip(all_t)
                .enumerate()
                .filter_map(|(slot, (flat, edge))| {
                    let centre =
                        score(&lum, w, h, flat, x - fit.scale, y - fit.scale, fit.scale, 1)?;
                    if centre < opts.hotbar_min_score.max(reference_centre - TIE) {
                        return None;
                    }
                    let edges =
                        score(&lum, w, h, edge, x - fit.scale, y - fit.scale, fit.scale, 1)?;
                    (edges >= reference_edges - TIE && reference_edges > 0.)
                        .then_some((fit, centre, edges, x, y, slot))
                })
                .max_by(|a, b| a.1.total_cmp(&b.1))
                .or_else(|| {
                    crate::profile::count(23, 1);
                    None
                })?;
            if HINT_MIRROR.load(std::sync::atomic::Ordering::Relaxed) {
                // Perf-lab: decide among the exact-scale candidates with the same
                // rule, order and tie-breaks the full fit applies to its own
                // candidate list (edge-sensitive score with TIE, then misfit),
                // and keep the hint only when that rule picks the hinted scale.
                let mut exact: Option<(f64, f64, f64)> = None; // score, misfit, s
                let mut cands: Vec<f64> = Vec::new();
                for dim in [w as f64, h as f64] {
                    let lo = (dim / (fit.scale * 1.01)).floor().max(1.) as u32;
                    let hi = (dim / (fit.scale * 0.99)).ceil() as u32;
                    cands.extend((lo..=hi).map(|n| dim / n as f64));
                }
                for se in cands {
                    let (cx, cy, _) = anchor(se);
                    let Some(v) = score(&lum, w, h, &all_t[slot], cx - se, cy - se, se, 1) else {
                        continue;
                    };
                    let misfit = misfit_of(se);
                    if exact.is_none_or(|e| v > e.0 + TIE || (v >= e.0 - TIE && misfit < e.1)) {
                        exact = Some((v, misfit, se));
                    }
                }
                if exact.is_none_or(|e| e.2 != fit.scale) {
                    crate::profile::count(25, 1);
                    return None;
                }
                return Some((fit, centre, edges, x, y));
            }
            // The same exact-scale candidates and tie preference as full fitting.
            // A high score alone can hide a slightly wrong cached scale.
            for dim in [w as f64, h as f64] {
                let lo = (dim / (fit.scale * 1.01)).floor().max(1.) as u32;
                let hi = (dim / (fit.scale * 0.99)).ceil() as u32;
                for n in lo..=hi {
                    let se = dim / n as f64;
                    if se == fit.scale {
                        continue;
                    }
                    let (cx, cy, _) = anchor(se);
                    let c = best_slot(flat_t, cx, cy, se, 1)?;
                    if c > centre + 3e-3 {
                        crate::profile::count(24, 1);
                        return None;
                    }
                    let v = score(&lum, w, h, &all_t[slot], cx - se, cy - se, se, 1)?;
                    if c >= centre - 3e-3
                        && (v > edges + TIE
                            || (v >= edges - TIE && misfit_of(se) < misfit_of(fit.scale)))
                    {
                        crate::profile::count(if v > edges + TIE { 25 } else { 26 }, 1);
                        return None;
                    }
                }
            }
            Some((fit, centre, edges, x, y))
        },
    );
    let best = if let Some((fit, centre, edges, x, y)) = checked_hint {
        crate::profile::count(1, 1);
        if let Some(hint) = hint.as_deref_mut() {
            hint.reused = true;
            // Perf-lab switch: compare the next frame against this frame's
            // scores rather than against the last full fit's, so a slowly
            // changing scene keeps its verified geometry.
            if HINT_ROLLING.load(std::sync::atomic::Ordering::Relaxed) {
                hint.previous = Some((w, h, fit, centre, edges));
            }
        }
        Some((centre, edges, fit.scale, x, y))
    } else {
        crate::profile::count(21, 1);
        // coarse: 0.5% steps of scale, every 3rd template point
        let mut coarse: Vec<(f64, f64)> = Vec::new();
        if let Some(plan) = coarse_plan {
            for (s, templates) in &plan.scales {
                if let Some(v) = templates
                    .iter()
                    .filter_map(|t| t.score(&lum))
                    .reduce(f64::max)
                {
                    coarse.push((v, *s));
                }
            }
        } else {
            let mut s = opts.min_scale;
            while s <= max_scale {
                let (x, y, _) = anchor(s);
                if let Some(v) = best_slot(flat_t, x, y, s, 3) {
                    coarse.push((v, s));
                }
                s *= 1.005;
            }
        }
        coarse.sort_by(|a, b| b.0.total_cmp(&a.0));
        // fine: every opaque hotbar pixel sampled near its corners (edge-sensitive, so the peak is sharp). The footage is
        // uncropped (user-confirmed), so the anchor is exact up to the rounding of the video size: the offset stays 0 unless
        // a shift is clearly better. Plateaus of equal correlation are resolved to their centre.
        let mut best: Option<(f64, f64, f64, f64, f64)> = None; // score, edge score, s, x, y
        for &(_, s0) in coarse.iter().take(5) {
            let (x0, y0, _) = anchor(s0);
            let Some((slot, _)) = flat_t
                .iter()
                .enumerate()
                .map(|(i, t)| {
                    (
                        i,
                        score(&lum, w, h, t, x0 - s0, y0 - s0, s0, 1).unwrap_or(-1.0),
                    )
                })
                .max_by(|a, b| a.1.total_cmp(&b.1))
            else {
                continue;
            };
            let t = &all_t[slot];
            let at_s = |s: f64, dx: f64, dy: f64| -> Option<f64> {
                let (x, y, _) = anchor(s);
                score(&lum, w, h, t, x + dx - s, y + dy - s, s, 1)
            };
            let centre_scale = |dx: f64, dy: f64, lo: f64, hi: f64, step: f64| -> Option<f64> {
                let mut all: Vec<(f64, f64)> = Vec::new();
                let mut s = lo;
                while s <= hi {
                    if let Some(v) = at_s(s, dx, dy) {
                        all.push((v, s));
                    }
                    s *= step;
                }
                let top = all.iter().map(|a| a.0).reduce(f64::max)?;
                let tied: Vec<f64> = all
                    .iter()
                    .filter(|a| a.0 >= top - TIE)
                    .map(|a| a.1)
                    .collect();
                Some(tied.iter().sum::<f64>() / tied.len() as f64)
            };
            let Some(s1) = centre_scale(0.0, 0.0, s0 * 0.985, s0 * 1.015, 1.0005) else {
                continue;
            };
            let at0 = at_s(s1, 0.0, 0.0).unwrap_or(-1.0);
            let mut offs: Vec<(f64, f64, f64)> = Vec::new();
            for dy in -4..=4 {
                for dx in -4..=4 {
                    let (dx, dy) = (dx as f64 * 0.25, dy as f64 * 0.25);
                    if let Some(v) = at_s(s1, dx, dy) {
                        offs.push((v, dx, dy));
                    }
                }
            }
            let top = offs.iter().map(|o| o.0).fold(at0, f64::max);
            let (odx, ody) = if top <= at0 + TIE {
                (0.0, 0.0)
            } else {
                let tied: Vec<&(f64, f64, f64)> =
                    offs.iter().filter(|o| o.0 >= top - TIE).collect();
                let n = tied.len() as f64;
                (
                    tied.iter().map(|o| o.1).sum::<f64>() / n,
                    tied.iter().map(|o| o.2).sum::<f64>() / n,
                )
            };
            let s2 = centre_scale(odx, ody, s1 * 0.997, s1 * 1.003, 1.0001).unwrap_or(s1);
            // exact candidates: an uncropped video of a W-wide scaled window has scale exactly videoW / W (and videoH / H),
            // so near-ties are resolved towards a scale where both divide evenly instead of averaging two of them
            // (the scaled size is ceil(framebuffer / scale), so often only one of them divides: 1280x720 at scale 3 is
            // 426.67 x 240). A whole scale is preferred among near-ties: a native-resolution recording has exactly the
            // GUI scale.
            let mut exact: Option<(f64, f64, f64)> = None; // score, misfit, s
            let (wf, hf) = (w as f64, h as f64);
            let mut cands: Vec<f64> = Vec::new();
            for dim in [wf, hf] {
                let lo = (dim / (s2 * 1.01)).floor().max(1.0) as u32;
                let hi = (dim / (s2 * 0.99)).ceil() as u32;
                cands.extend((lo..=hi).map(|n| dim / n as f64));
            }
            for se in cands {
                let Some(v) = at_s(se, 0.0, 0.0) else {
                    continue;
                };
                let misfit = misfit_of(se);
                if exact.is_none_or(|e| v > e.0 + TIE || (v >= e.0 - TIE && misfit < e.1)) {
                    exact = Some((v, misfit, se));
                }
            }
            let cont = at_s(s2, odx, ody).unwrap_or(-1.0);
            let (s2, odx, ody, edge) = match exact {
                Some((v, _, se)) if v >= cont - TIE => (se, 0.0, 0.0, v),
                _ => (s2, odx, ody, cont),
            };
            let (x, y, _) = anchor(s2);
            // accept on the centre-sampled correlation (robust to resampling), not on the edge-sensitive one
            if let Some(v) = best_slot(flat_t, x + odx, y + ody, s2, 1) {
                // seeds can end on neighbouring scales that score alike here (a scale 0.4 % off moves the hotbar's edges
                // by under a pixel): among near-ties the edge-sensitive score, which does see it, decides
                const NEAR: f64 = 3e-3;
                let better = best.is_none_or(|b| v > b.0 + NEAR || (v >= b.0 - NEAR && edge > b.1));
                if better {
                    best = Some((v, edge, s2, x + odx, y + ody));
                }
            }
        }
        best
    };
    let Some((hot_score, hot_edges, s, hx, hy)) = best.filter(|b| b.0 >= opts.hotbar_min_score)
    else {
        mask.notes.push(format!(
            "no vanilla hotbar found at any scale between {:.2} and {:.2} video px per GUI px (best correlation {:.2})",
            opts.min_scale,
            max_scale,
            best.map_or(f64::NAN, |b| b.0)
        ));
        return Ok(mask);
    };
    let (_, _, f) = anchor(s);
    let (sw, sh) = (f.scaled_width as i32, f.scaled_height as i32);
    let fit = checked_hint.map_or_else(
        || {
            GuiFit::for_video(
                s,
                w,
                h,
                hx - (sw / 2 - 91) as f64 * s,
                hy - (sh - 22) as f64 * s,
            )
        },
        |(fit, _, _, _, _)| fit,
    );
    mask.fit = Some(fit);
    if let Some(hint) = hint {
        if !hint.reused {
            if let Some((_, _, previous, _, _)) = hint.previous {
                crate::profile::count(if previous == fit { 27 } else { 28 }, 1);
            }
            hint.previous = Some((w, h, fit, hot_score, hot_edges));
        }
    }
    mask.reliable = true;
    if let Some(t) = times.as_deref_mut() {
        t.fit_ms = begin.elapsed().as_secs_f64() * 1000.;
        t.fit_cycles = crate::profile::thread_cycles() - cycles;
    }
    let begin = std::time::Instant::now();
    let cycles = crate::profile::thread_cycles();

    // --- the pieces, each confirmed against its texture at its place
    let mut fitted_hotbar = hotbar.clone();
    (fitted_hotbar.x, fitted_hotbar.y) = (sw / 2 - 91, sh - 22);
    let mut accepted: Vec<(Placed, f64)> = vec![(fitted_hotbar, hot_score)];
    let at = |p: &Placed| -> (f64, f64) {
        (
            fit.origin_x + p.x as f64 * fit.scale,
            fit.origin_y + p.y as f64 * fit.scale,
        )
    };
    let base = hud_layout(
        fit.scaled_width,
        fit.scaled_height,
        &HudState {
            status_bars: false,
            xp_bar: false,
            ..HudState::default()
        },
    );
    // best of several candidates (each a placed piece variant), offsets in GUI px.
    // Variants of one piece sit at the same place and sample the same pixels; the
    // patch is sampled once per place and only the template side changes.
    let resolve = |cands: &[Placed]| -> Vec<Arc<Template>> {
        cands
            .iter()
            .map(|c| piece_template(tex, c, shape_cache))
            .collect()
    };
    // `templates[i]` is candidate i's template; piece variants are the same at
    // every cell, so loops resolve them once and pass them to every cell.
    let best_of_with = |mut cands: Vec<Placed>,
                        templates: &[Arc<Template>],
                        dys: &[i32]|
     -> Option<(Placed, f64)> {
        debug_assert_eq!(templates.len(), cands.len());
        let mut scores = vec![vec![None; dys.len()]; cands.len()];
        let mut sampler = PatchSampler::default();
        for (k, &dy) in dys.iter().enumerate() {
            for (index, c) in cands.iter().enumerate() {
                let x = fit.origin_x + c.x as f64 * fit.scale;
                let y = fit.origin_y + (c.y + dy) as f64 * fit.scale;
                scores[index][k] = sampler.score(&lum, w, h, &templates[index], x, y, fit.scale);
            }
        }
        // Same selection order as scoring each candidate in turn: first maximum wins.
        let mut top: Option<(usize, i32, f64)> = None;
        for (index, row) in scores.iter().enumerate() {
            for (k, &dy) in dys.iter().enumerate() {
                if let Some(v) = row[k] {
                    if top.as_ref().is_none_or(|b| v > b.2) {
                        top = Some((index, dy, v));
                    }
                }
            }
        }
        top.filter(|b| b.2 >= opts.piece_min_score)
            .map(|(index, dy, v)| {
                let mut p = cands.swap_remove(index);
                p.y += dy;
                (p, v)
            })
    };
    let best_of = |cands: Vec<Placed>, dys: &[i32]| -> Option<(Placed, f64)> {
        let templates = resolve(&cands);
        best_of_with(cands, &templates, dys)
    };
    let (c, sh_) = (sw / 2, sh);
    // selected slot: 9 places
    let sel: Vec<Placed> = (0..9)
        .map(|i| {
            place(
                PieceId::SelectedSlot,
                i as u8,
                c - 92 + 20 * i,
                sh_ - 23,
                24,
                22,
                vec![lay(Sheet::Widgets, 0, 22, 24, 22)],
            )
        })
        .collect();
    let slot = best_of(sel, &[0]);
    if let Some(x) = slot.clone() {
        accepted.push(x);
    }
    let off = best_of(
        vec![
            place(
                PieceId::Offhand,
                0,
                c - 120,
                sh_ - 23,
                29,
                24,
                vec![lay(Sheet::Widgets, 24, 22, 29, 24)],
            ),
            place(
                PieceId::Offhand,
                1,
                c + 91,
                sh_ - 23,
                29,
                24,
                vec![lay(Sheet::Widgets, 53, 22, 29, 24)],
            ),
        ],
        &[0],
    );
    let offhand_side = off.as_ref().map(|o| o.0.index);
    if let Some(x) = off {
        accepted.push(x);
    }
    for p in base
        .iter()
        .filter(|p| p.piece == PieceId::HotbarItem || p.piece == PieceId::Crosshair)
    {
        accepted.push((p.clone(), 1.0));
    }
    if let Some(side) = offhand_side {
        let x = if side == 0 { c - 117 } else { c + 101 };
        let mut p = place(PieceId::HotbarItem, 9, x, sh_ - 19, 16, 16, vec![]);
        p.unknown = Some((0, 0, 16, 16));
        accepted.push((p, 1.0));
    }

    // XP bar: background with any fill length
    let xp_cands: Vec<Placed> = (0..=183u32)
        .step_by(1)
        .map(|fill| {
            let mut layers = vec![lay(Sheet::Icons, 0, 64, 182, 5)];
            if fill > 0 {
                layers.push(lay(Sheet::Icons, 0, 69, fill, 5));
            }
            place(PieceId::XpBar, 0, c - 91, sh_ - 29, 182, 5, layers)
        })
        .collect();
    // the jump bar of a jumping mount takes the XP bar's place (InGameHud 188-193, 525-538)
    let jump_cands: Vec<Placed> = (0..=183u32)
        .map(|fill| {
            let mut layers = vec![lay(Sheet::Icons, 0, 84, 182, 5)];
            if fill > 0 {
                layers.push(lay(Sheet::Icons, 0, 89, fill, 5));
            }
            place(PieceId::JumpBar, 0, c - 91, sh_ - 29, 182, 5, layers)
        })
        .collect();
    match (best_of(xp_cands, &[0]), best_of(jump_cands, &[0])) {
        (Some(x), Some(j)) => accepted.push(if j.1 > x.1 { j } else { x }),
        (Some(x), None) | (None, Some(x)) => accepted.push(x),
        (None, None) => {}
    }

    // hearts (rows), armor, food, air
    let o = sh_ - 39;
    let (m, n) = (c - 91, c + 91);
    let heart_variants = |x: i32, y: i32, idx: u8| -> Vec<Placed> {
        let mut v = Vec::new();
        for ad in [0u32, 5] {
            for cont in [16u32, 25] {
                v.push(place(
                    PieceId::Health,
                    idx,
                    x,
                    y,
                    9,
                    9,
                    vec![lay(Sheet::Icons, cont, 9 * ad, 9, 9)],
                ));
                for yx in [16u32, 52, 88] {
                    for fill in [yx + 36, yx + 45, yx + 144, yx + 153] {
                        v.push(place(
                            PieceId::Health,
                            idx,
                            x,
                            y,
                            9,
                            9,
                            vec![
                                lay(Sheet::Icons, cont, 9 * ad, 9, 9),
                                lay(Sheet::Icons, fill, 9 * ad, 9, 9),
                            ],
                        ));
                    }
                }
            }
        }
        v
    };
    let mut best_rows: (usize, i32, Vec<(Placed, f64)>) = (0, 1, Vec::new());
    let heart_templates = resolve(&heart_variants(0, 0, 0));
    // A cell's result depends only on its place and index; the bottom row is
    // the same cell for every row-count hypothesis, so remember it.
    let mut heart_cells: HashMap<(i32, i32, u8), Option<(Placed, f64)>> = HashMap::new();
    for q in 1..=4 {
        let r = (10 - (q - 2)).max(3);
        let mut found = Vec::new();
        for row in 0..q {
            for col in 0..10 {
                let idx = (row * 10 + col) as u8;
                let (x, y) = (m + col * 8, o - row * r);
                let cell = heart_cells
                    .entry((x, y, idx))
                    .or_insert_with(|| {
                        best_of_with(heart_variants(x, y, idx), &heart_templates, &[-2, -1, 0, 1])
                    })
                    .clone();
                if let Some(x) = cell {
                    found.push(x);
                }
            }
        }
        let top_row_hit = found.iter().any(|(p, _)| p.index as i32 >= (q - 1) * 10);
        if top_row_hit && found.len() > best_rows.0 {
            best_rows = (found.len(), q, found);
        }
    }
    let (heart_count, q, hearts) = best_rows;
    accepted.extend(hearts);
    if heart_count > 0 {
        let r = (10 - (q - 2)).max(3);
        let armor_y = o - (q - 1) * r - 10;
        let mut armor_templates = None;
        for i in 0..10 {
            let cands: Vec<Placed> = [16u32, 25, 34]
                .iter()
                .map(|&u| {
                    place(
                        PieceId::Armor,
                        i as u8,
                        m + i * 8,
                        armor_y,
                        9,
                        9,
                        vec![lay(Sheet::Icons, u, 9, 9, 9)],
                    )
                })
                .collect();
            let templates = armor_templates.get_or_insert_with(|| resolve(&cands));
            if let Some(x) = best_of_with(cands, templates, &[0]) {
                accepted.push(x);
            }
        }
        let mut food_found = 0;
        let mut food_templates = None;
        for zx in 0..10 {
            let x = n - zx * 8 - 9;
            let mut cands = Vec::new();
            for cont in [16u32, 133] {
                cands.push(place(
                    PieceId::Food,
                    zx as u8,
                    x,
                    o,
                    9,
                    9,
                    vec![lay(Sheet::Icons, cont, 27, 9, 9)],
                ));
                for abx in [16u32, 52] {
                    for fill in [abx + 36, abx + 45] {
                        cands.push(place(
                            PieceId::Food,
                            zx as u8,
                            x,
                            o,
                            9,
                            9,
                            vec![
                                lay(Sheet::Icons, cont, 27, 9, 9),
                                lay(Sheet::Icons, fill, 27, 9, 9),
                            ],
                        ));
                    }
                }
            }
            let templates = food_templates.get_or_insert_with(|| resolve(&cands));
            if let Some(x) = best_of_with(cands, templates, &[-1, 0, 1]) {
                accepted.push(x);
                food_found += 1;
            }
        }
        if food_found == 0 {
            // riding a living mount: its hearts replace the food row, rows of 10 upward (881-915)
            let mut mount_templates = None;
            'rows: for row in 0..4 {
                let mut in_row = 0;
                for pp in 0..10 {
                    let x = n - pp * 8 - 9;
                    let idx = (row * 10 + pp) as u8;
                    let mut cands = vec![place(
                        PieceId::MountHealth,
                        idx,
                        x,
                        o - row * 10,
                        9,
                        9,
                        vec![lay(Sheet::Icons, 52, 9, 9, 9)],
                    )];
                    for fill in [88u32, 97] {
                        cands.push(place(
                            PieceId::MountHealth,
                            idx,
                            x,
                            o - row * 10,
                            9,
                            9,
                            vec![
                                lay(Sheet::Icons, 52, 9, 9, 9),
                                lay(Sheet::Icons, fill, 9, 9, 9),
                            ],
                        ));
                    }
                    let templates = mount_templates.get_or_insert_with(|| resolve(&cands));
                    if let Some(x) = best_of_with(cands, templates, &[0]) {
                        accepted.push(x);
                        in_row += 1;
                    }
                }
                if in_row == 0 {
                    break 'rows;
                }
            }
        }
        if food_found > 0 {
            let mut air_templates = None;
            for ae in 0..10 {
                let x = n - ae * 8 - 9;
                let cands: Vec<Placed> = [16u32, 25]
                    .iter()
                    .map(|&u| {
                        place(
                            PieceId::Air,
                            ae as u8,
                            x,
                            o - 10,
                            9,
                            9,
                            vec![lay(Sheet::Icons, u, 18, 9, 9)],
                        )
                    })
                    .collect();
                let templates = air_templates.get_or_insert_with(|| resolve(&cands));
                if let Some(x) = best_of_with(cands, templates, &[0]) {
                    accepted.push(x);
                }
            }
        }
    }

    // status effect backgrounds: beneficial row y = 1, harmful row y = 27, from the right edge
    let mut effect_idx = 0u8;
    let mut effect_templates = None;
    for y in [1, 27] {
        for i in 1..=8 {
            let x = sw - 25 * i;
            let cands: Vec<Placed> = [141u32, 165]
                .iter()
                .map(|&u| {
                    let mut p = place(
                        PieceId::EffectIcon,
                        effect_idx,
                        x,
                        y,
                        24,
                        24,
                        vec![lay(Sheet::Inventory, u, 166, 24, 24)],
                    );
                    p.unknown = Some((3, 3, 18, 18));
                    p
                })
                .collect();
            let templates = effect_templates.get_or_insert_with(|| resolve(&cands));
            match best_of_with(cands, templates, &[0]) {
                Some(x) => {
                    accepted.push(x);
                    effect_idx += 1;
                }
                None => break,
            }
        }
    }

    // boss bars (BossBarHud 29-60): bars.png, every colour, any fill, from y = 12 every 19 GUI px
    let mut boss_found = 0usize;
    if tex.bars.is_some() {
        for nb in 0..6 {
            let y = 12 + 19 * nb;
            let mut cands = Vec::new();
            for color in 0..7u32 {
                for fill in 0..=183u32 {
                    let mut layers = vec![lay(Sheet::Bars, 0, color * 10, 182, 5)];
                    if fill > 0 {
                        layers.push(lay(Sheet::Bars, 0, color * 10 + 5, fill, 5));
                    }
                    cands.push(place(PieceId::BossBar, nb as u8, c - 91, y, 182, 5, layers));
                }
            }
            match best_of(cands, &[0]) {
                Some(x) => {
                    accepted.push(x);
                    boss_found += 1;
                }
                None => break,
            }
        }
    }

    // --- label pixels, in drawing order (later pieces cover earlier ones)
    let order = |p: PieceId| -> u8 {
        match p {
            PieceId::Hotbar => 0,
            PieceId::SelectedSlot => 1,
            PieceId::Offhand => 2,
            PieceId::HotbarItem => 3,
            PieceId::Crosshair => 4,
            _ => 5,
        }
    };
    accepted.sort_by_key(|(p, _)| order(p.piece));
    for (p, sc) in &accepted {
        label(&mut mask, tex, p, &fit, opts.edge_tolerance_px);
        let (x, y) = at(p);
        mask.hits.push(PieceHit {
            piece: p.piece,
            index: p.index,
            x: x.floor() as i32,
            y: y.floor() as i32,
            w: (p.w as f64 * fit.scale).round() as u32,
            h: (p.h as f64 * fit.scale).round() as u32,
            score: *sc,
            text: None,
        });
    }
    if let Some(t) = times.as_deref_mut() {
        t.pieces_ms = begin.elapsed().as_secs_f64() * 1000.;
        t.pieces_cycles = crate::profile::thread_cycles() - cycles;
    }
    let begin = std::time::Instant::now();
    let cycles = crate::profile::thread_cycles();
    detect_text(
        frame,
        w,
        h,
        &fit,
        opts,
        boss_found,
        tex.font.as_ref(),
        &mut mask,
    );
    match tex.font.as_ref() {
        Some(font) => {
            detect_action_bar(frame, w, h, &fit, opts, font, &mut mask);
            detect_captions(frame, w, h, &fit, opts, font, &mut mask);
        }
        None => mask
            .notes
            .push("no font texture: the action bar and captions are not checked".into()),
    }
    if let Some(t) = times {
        t.text_ms = begin.elapsed().as_secs_f64() * 1000.;
        t.text_cycles = crate::profile::thread_cycles() - cycles;
    }
    Ok(mask)
}

/// Class of one GUI pixel of a piece: `None` outside or transparent.
fn gui_class(img: &[[u8; 4]], p: &Placed, gx: i64, gy: i64) -> PixelClass {
    if gx < 0 || gy < 0 || gx >= p.w as i64 || gy >= p.h as i64 {
        return PixelClass::None;
    }
    if let Some((ux, uy, uw, uh)) = p.unknown {
        if gx >= ux as i64
            && gy >= uy as i64
            && gx < (ux as i64 + uw as i64)
            && gy < (uy as i64 + uh as i64)
        {
            return PixelClass::Unknown;
        }
    }
    match img[gy as usize * p.w as usize + gx as usize][3] {
        0 => PixelClass::None,
        255 => PixelClass::Opaque,
        _ => PixelClass::Translucent,
    }
}

/// Label the video pixels a piece touches: the piece where any touched GUI pixel is drawn; the class when every touched
/// GUI pixel has the same class, else unknown (edges, the scale rounding band).
fn label(mask: &mut GuiMask, tex: &GuiTextures, p: &Placed, fit: &GuiFit, tol: f64) {
    let img = composite(tex, p);
    let (w, h) = (mask.width, mask.height);
    let (x0, y0, x1, y1) = video_rect(fit, p.x as f64, p.y as f64, p.w as f64, p.h as f64, w, h);
    for y in y0..y1 {
        let ga = (y as f64 + tol - fit.origin_y) / fit.scale - p.y as f64;
        let gb = (y as f64 + 1.0 - tol - fit.origin_y) / fit.scale - p.y as f64;
        let (gy0, gy1) = (ga.floor() as i64, (gb - 1e-9).floor() as i64);
        for x in x0..x1 {
            let ha = (x as f64 + tol - fit.origin_x) / fit.scale - p.x as f64;
            let hb = (x as f64 + 1.0 - tol - fit.origin_x) / fit.scale - p.x as f64;
            let (gx0, gx1) = (ha.floor() as i64, (hb - 1e-9).floor() as i64);
            let mut any = false;
            let mut first: Option<PixelClass> = None;
            let mut mixed = false;
            for gy in gy0..=gy1 {
                for gx in gx0..=gx1 {
                    let c = gui_class(&img, p, gx, gy);
                    if c != PixelClass::None {
                        any = true;
                    }
                    match first {
                        None => first = Some(c),
                        Some(f) if f != c => mixed = true,
                        _ => {}
                    }
                }
            }
            if !any {
                continue;
            }
            let i = y * w + x;
            mask.piece[i] = p.piece as u8;
            mask.class[i] = if mixed {
                PixelClass::Unknown
            } else {
                first.unwrap_or(PixelClass::Unknown)
            } as u8;
        }
    }
}

// ================================================================ phase 2: text (PLAN-GUI-MASK.md 3.3)

/// `ChatHud.getWidth(1.0)`: the default chat width option.
const CHAT_WIDTH: i32 = 320;
/// Lines the chat can show (focused height `floor(1.0 * 160 + 20) / 9` = 20).
const CHAT_LINES: i32 = 20;

/// Cell and advance of a glyph of `font/ascii.png` (16x16 cells of 8x8): advance = rightmost opaque column + 2
/// (glyph width + 1), a space advances 4. Only used to compose synthetic text.
fn glyph(font: &Texture, ch: char) -> (i64, i64, i32) {
    let c = if (' '..='~').contains(&ch) {
        ch as u32
    } else {
        '?' as u32
    };
    let (cx, cy) = ((c % 16 * 8) as i64, (c / 16 * 8) as i64);
    if c == 32 {
        return (cx, cy, 4);
    }
    let mut width = 0;
    for x in 0..8 {
        for y in 0..8 {
            if font.texel(cx + x, cy + y)[3] > 0 {
                width = width.max(x as i32 + 1);
            }
        }
    }
    (cx, cy, width + 1)
}

fn text_width(font: &Texture, s: &str) -> i32 {
    s.chars().map(|c| glyph(font, c).2).sum()
}

/// Fill a GUI rectangle in an RGB frame (alpha blended), setting the truth where a pixel's centre falls inside.
#[allow(clippy::too_many_arguments)]
fn fill_gui(
    frame: &mut [u8],
    w: usize,
    h: usize,
    fit: &GuiFit,
    rect: (f64, f64, f64, f64),
    rgba: [u8; 4],
    truth: &mut Truth,
    piece: PieceId,
    class: PixelClass,
) {
    let (gx, gy, gw, gh) = rect;
    let (x0, y0, x1, y1) = video_rect(fit, gx, gy, gw, gh, w, h);
    let a = rgba[3] as f64 / 255.0;
    for y in y0..y1 {
        let cy = (y as f64 + 0.5 - fit.origin_y) / fit.scale;
        if cy < gy || cy >= gy + gh {
            continue;
        }
        for x in x0..x1 {
            let cx = (x as f64 + 0.5 - fit.origin_x) / fit.scale;
            if cx < gx || cx >= gx + gw {
                continue;
            }
            let i = y * w + x;
            for k in 0..3 {
                frame[i * 3 + k] =
                    (rgba[k] as f64 * a + frame[i * 3 + k] as f64 * (1.0 - a)).round() as u8;
            }
            truth.piece[i] = piece as u8;
            truth.class[i] = class as u8;
        }
    }
}

/// `TextRenderer.draw` / `drawWithShadow`: the shadow first, one text unit down-right, at a quarter of the colour.
#[allow(clippy::too_many_arguments)]
fn draw_text(
    frame: &mut [u8],
    w: usize,
    h: usize,
    fit: &GuiFit,
    font: &Texture,
    truth: &mut Truth,
    piece: PieceId,
    x: i32,
    y: i32,
    unit: i32,
    text: &str,
    rgb: [u8; 3],
    shadow: bool,
) {
    draw_text_alpha(
        frame, w, h, fit, font, truth, piece, x, y, unit, text, rgb, 255, shadow,
    );
}

/// `draw_text` at an opacity below 1 (a fading line) is labelled translucent.
#[allow(clippy::too_many_arguments)]
fn draw_text_alpha(
    frame: &mut [u8],
    w: usize,
    h: usize,
    fit: &GuiFit,
    font: &Texture,
    truth: &mut Truth,
    piece: PieceId,
    x: i32,
    y: i32,
    unit: i32,
    text: &str,
    rgb: [u8; 3],
    alpha: u8,
    shadow: bool,
) {
    let class = if alpha == 255 {
        PixelClass::Opaque
    } else {
        PixelClass::Translucent
    };
    let quarter = [rgb[0] / 4, rgb[1] / 4, rgb[2] / 4];
    let passes: Vec<(i32, [u8; 3])> = if shadow {
        vec![(unit, quarter), (0, rgb)]
    } else {
        vec![(0, rgb)]
    };
    for (d, col) in passes {
        let mut cx = x;
        for ch in text.chars() {
            let (gx0, gy0, adv) = glyph(font, ch);
            for py in 0..8 {
                for px in 0..8 {
                    if font.texel(gx0 + px, gy0 + py)[3] > 0 {
                        let rect = (
                            (cx + px as i32 * unit + d) as f64,
                            (y + py as i32 * unit + d) as f64,
                            unit as f64,
                            unit as f64,
                        );
                        fill_gui(
                            frame,
                            w,
                            h,
                            fit,
                            rect,
                            [col[0], col[1], col[2], alpha],
                            truth,
                            piece,
                            class,
                        );
                    }
                }
            }
            cx += adv * unit;
        }
    }
}

/// The HUD's text for a synthetic frame, in drawing order (InGameHud 142-338, BossBarHud, DebugHud, ChatHud).
fn compose_text(
    frame: &mut [u8],
    w: usize,
    h: usize,
    tex: &GuiTextures,
    st: &HudState,
    fit: &GuiFit,
    truth: &mut Truth,
) {
    let Some(font) = tex.font.as_ref() else {
        return;
    };
    if st.hud_hidden {
        return;
    }
    let (sw, sh) = (fit.scaled_width as i32, fit.scaled_height as i32);
    let white = [255u8, 255, 255];
    for (nb, b) in st.boss_bars.iter().enumerate() {
        let tw = text_width(font, &b.name);
        draw_text(
            frame,
            w,
            h,
            fit,
            font,
            truth,
            PieceId::BossName,
            sw / 2 - tw / 2,
            12 + 19 * nb as i32 - 9,
            1,
            &b.name,
            white,
            true,
        );
    }
    if st.xp_level > 0 && st.xp_bar && st.jump_bar.is_none() {
        let s = st.xp_level.to_string();
        let (k, l) = ((sw - text_width(font, &s)) / 2, sh - 35);
        for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            draw_text(
                frame,
                w,
                h,
                fit,
                font,
                truth,
                PieceId::XpLevel,
                k + dx,
                l + dy,
                1,
                &s,
                [0, 0, 0],
                false,
            );
        }
        draw_text(
            frame,
            w,
            h,
            fit,
            font,
            truth,
            PieceId::XpLevel,
            k,
            l,
            1,
            &s,
            [128, 255, 32],
            false,
        );
    }
    if let Some(name) = &st.item_name {
        let tw = text_width(font, name);
        let y = if st.status_bars { sh - 59 } else { sh - 45 };
        draw_text(
            frame,
            w,
            h,
            fit,
            font,
            truth,
            PieceId::ItemName,
            (sw - tw) / 2,
            y,
            1,
            name,
            white,
            true,
        );
    }
    // action bar (InGameHud 229-257): translate(W/2, H-68), text at (-width/2, -4), no shadow, no background
    if let Some(t) = &st.action_bar {
        let alpha = (st.action_bar_alpha.clamp(0.0, 1.0) * 255.0).round() as u8;
        if alpha > 0 {
            draw_text_alpha(
                frame,
                w,
                h,
                fit,
                font,
                truth,
                PieceId::ActionBar,
                sw / 2 + (-text_width(font, t) / 2),
                sh - 72,
                1,
                t,
                st.action_bar_color,
                alpha,
                false,
            );
        }
    }
    // sound captions (SubtitlesHud 39-101): equal boxes of width 2l+2 at the right, stacked up from y = H-35
    if !st.captions.is_empty() {
        let maxw = st
            .captions
            .iter()
            .map(|c| text_width(font, &c.text))
            .max()
            .unwrap_or(0);
        let l = (maxw + text_width(font, "< > ")) / 2;
        for (i, c) in st.captions.iter().enumerate() {
            let (cx, cy) = (sw - l - 2, sh - 30 - 10 * i as i32);
            fill_gui(
                frame,
                w,
                h,
                fit,
                (
                    (cx - l - 1) as f64,
                    (cy - 5) as f64,
                    (2 * l + 2) as f64,
                    10.0,
                ),
                [0, 0, 0, 204],
                truth,
                PieceId::SoundCaption,
                PixelClass::Translucent,
            );
            let grey = [c.grey; 3];
            let arrow = match c.arrow {
                Some(CaptionArrow::Right) => Some((">", cx + l - text_width(font, ">"))),
                Some(CaptionArrow::Left) => Some(("<", cx - l)),
                None => None,
            };
            if let Some((a, x)) = arrow {
                draw_text(
                    frame,
                    w,
                    h,
                    fit,
                    font,
                    truth,
                    PieceId::SoundCaption,
                    x,
                    cy - 4,
                    1,
                    a,
                    grey,
                    false,
                );
            }
            draw_text(
                frame,
                w,
                h,
                fit,
                font,
                truth,
                PieceId::SoundCaption,
                cx + (-text_width(font, &c.text) / 2),
                cy - 4,
                1,
                &c.text,
                grey,
                false,
            );
        }
    }
    let grey_box = [80u8, 80, 80, 0x90];
    for (i, line) in st.debug_left.iter().enumerate() {
        let (y, k) = (2 + 9 * i as i32, text_width(font, line));
        fill_gui(
            frame,
            w,
            h,
            fit,
            (1.0, (y - 1) as f64, (k + 2) as f64, 9.0),
            grey_box,
            truth,
            PieceId::DebugText,
            PixelClass::Translucent,
        );
        draw_text(
            frame,
            w,
            h,
            fit,
            font,
            truth,
            PieceId::DebugText,
            2,
            y,
            1,
            line,
            [224, 224, 224],
            false,
        );
    }
    for (i, line) in st.debug_right.iter().enumerate() {
        let (y, k) = (2 + 9 * i as i32, text_width(font, line));
        let x = sw - 2 - k;
        fill_gui(
            frame,
            w,
            h,
            fit,
            ((x - 1) as f64, (y - 1) as f64, (k + 2) as f64, 9.0),
            grey_box,
            truth,
            PieceId::DebugText,
            PixelClass::Translucent,
        );
        draw_text(
            frame,
            w,
            h,
            fit,
            font,
            truth,
            PieceId::DebugText,
            x,
            y,
            1,
            line,
            [224, 224, 224],
            false,
        );
    }
    if let Some(t) = &st.title {
        let l = text_width(font, t);
        draw_text(
            frame,
            w,
            h,
            fit,
            font,
            truth,
            PieceId::Title,
            sw / 2 + 4 * (-l / 2),
            sh / 2 - 40,
            4,
            t,
            white,
            true,
        );
    }
    if let Some(t) = &st.subtitle {
        let m = text_width(font, t);
        draw_text(
            frame,
            w,
            h,
            fit,
            font,
            truth,
            PieceId::Subtitle,
            sw / 2 + 2 * (-m / 2),
            sh / 2 + 10,
            2,
            t,
            white,
            true,
        );
    }
    for (m, line) in st.chat.iter().enumerate().take(10) {
        let base = sh - 40 - 9 * m as i32;
        fill_gui(
            frame,
            w,
            h,
            fit,
            (0.0, (base - 9) as f64, (CHAT_WIDTH + 6) as f64, 9.0),
            [0, 0, 0, 127],
            truth,
            PieceId::ChatLine,
            PixelClass::Translucent,
        );
        draw_text(
            frame,
            w,
            h,
            fit,
            font,
            truth,
            PieceId::ChatLine,
            2,
            base - 8,
            1,
            line,
            white,
            true,
        );
    }
}

/// Mean colour of the middle half of a GUI pixel `unit` GUI px wide (the nearest video pixel when that is empty).
fn gui_px(
    frame: &[u8],
    w: usize,
    h: usize,
    fit: &GuiFit,
    gx: i32,
    gy: i32,
    unit: i32,
) -> Option<[f64; 3]> {
    let s = fit.scale * unit as f64;
    let (vx, vy) = (
        fit.origin_x + gx as f64 * fit.scale,
        fit.origin_y + gy as f64 * fit.scale,
    );
    if vx < 0.0 || vy < 0.0 || vx + s > w as f64 || vy + s > h as f64 {
        return None;
    }
    let range = |a: f64| -> (usize, usize) {
        let lo = (a + 0.25 * s - 0.5).ceil().max(0.0) as usize;
        let hi = (a + 0.75 * s - 0.5).floor().max(0.0) as usize;
        if lo <= hi {
            (lo, hi)
        } else {
            let c = (a + 0.5 * s).floor() as usize;
            (c, c)
        }
    };
    let ((x0, x1), (y0, y1)) = (range(vx), range(vy));
    let mut sum = [0.0; 3];
    let mut n = 0.0;
    for y in y0..=y1.min(h - 1) {
        for x in x0..=x1.min(w - 1) {
            for k in 0..3 {
                sum[k] += frame[(y * w + x) * 3 + k] as f64;
            }
            n += 1.0;
        }
    }
    (n > 0.0).then(|| [sum[0] / n, sum[1] / n, sum[2] / n])
}

fn brightest(a: [f64; 3]) -> f64 {
    a.iter().cloned().fold(0.0, f64::max)
}

/// One text pixel and its shadow (TextRenderer 238-244, 451): visible, and the pixel one unit down-right is a quarter.
fn is_text(a: [f64; 3], b: [f64; 3], o: &GuiOptions) -> bool {
    brightest(a) >= o.text_min_bright
        && (0..3).all(|k| (b[k] - a[k] / 4.0).abs() <= o.text_shadow_tolerance)
}

type TextHit = (i32, i32, [f64; 3]);

/// Text pixels (with their shadow) in a band of 8 text rows starting at `y0`, columns `x0..x1` on the `unit` grid.
#[allow(clippy::too_many_arguments)]
fn scan_text(
    frame: &[u8],
    w: usize,
    h: usize,
    fit: &GuiFit,
    o: &GuiOptions,
    x0: i32,
    x1: i32,
    y0: i32,
    unit: i32,
) -> Vec<TextHit> {
    let mut hits = Vec::new();
    // The shadow sample of cell (gx, gy) is the text sample of cell (gx+1, gy+1):
    // sample the 9-row grid once and pair neighbouring cells. Same `gui_px` values.
    let columns: Vec<i32> = (x0..x1 + unit).step_by(unit as usize).collect();
    let rows: Vec<i32> = (y0..y0 + 9 * unit).step_by(unit as usize).collect();
    let samples: Vec<Option<[f64; 3]>> = rows
        .iter()
        .flat_map(|&gy| columns.iter().map(move |&gx| (gx, gy)))
        .map(|(gx, gy)| gui_px(frame, w, h, fit, gx, gy, unit))
        .collect();
    let stride = columns.len();
    for (j, &gy) in rows.iter().enumerate().take(8) {
        for (i, &gx) in columns.iter().enumerate() {
            if gx >= x1 {
                break;
            }
            let (Some(a), Some(b)) = (samples[j * stride + i], samples[(j + 1) * stride + i + 1])
            else {
                continue;
            };
            if is_text(a, b, o) {
                hits.push((gx, gy, a));
            }
        }
    }
    hits
}

/// Every pixel of an accepted line drawn in its dominant colour, plus the shadows one unit down-right.
#[allow(clippy::too_many_arguments)]
fn line_pixels(
    frame: &[u8],
    w: usize,
    h: usize,
    fit: &GuiFit,
    o: &GuiOptions,
    hits: &[TextHit],
    y0: i32,
    unit: i32,
) -> Vec<(i32, i32)> {
    let mut chans: [Vec<f64>; 3] = [Vec::new(), Vec::new(), Vec::new()];
    for &(_, _, a) in hits {
        for k in 0..3 {
            chans[k].push(a[k]);
        }
    }
    let dom: Vec<f64> = chans
        .iter_mut()
        .map(|c| {
            c.sort_by(f64::total_cmp);
            c[c.len() / 2]
        })
        .collect();
    let lo = hits.iter().map(|h| h.0).min().unwrap_or(0) - 2 * unit;
    let hi = hits.iter().map(|h| h.0).max().unwrap_or(0) + 3 * unit;
    let mut out: Vec<(i32, i32)> = hits.iter().map(|h| (h.0, h.1)).collect();
    for gy in (y0..y0 + 8 * unit).step_by(unit as usize) {
        for gx in (lo..hi).step_by(unit as usize) {
            if let Some(a) = gui_px(frame, w, h, fit, gx, gy, unit) {
                if (0..3).all(|k| (a[k] - dom[k]).abs() <= 2.0 * o.text_shadow_tolerance)
                    && brightest(a) >= o.text_min_bright
                {
                    out.push((gx, gy));
                }
            }
        }
    }
    let shadows: Vec<(i32, i32)> = out
        .iter()
        .filter_map(|&(gx, gy)| {
            let a = gui_px(frame, w, h, fit, gx, gy, unit)?;
            let b = gui_px(frame, w, h, fit, gx + unit, gy + unit, unit)?;
            (0..3)
                .all(|k| (b[k] - a[k] / 4.0).abs() <= o.text_shadow_tolerance)
                .then_some((gx + unit, gy + unit))
        })
        .collect();
    out.extend(shadows);
    out.sort_unstable();
    out.dedup();
    out
}

/// Label a GUI rectangle: pixels fully inside get `class`, pixels it only touches become `unknown` of that piece
/// (without taking a pixel another piece already owns).
fn paint(
    mask: &mut GuiMask,
    fit: &GuiFit,
    rect: (f64, f64, f64, f64),
    piece: PieceId,
    class: PixelClass,
    tol: f64,
) {
    let (gx, gy, gw, gh) = rect;
    let (w, h) = (mask.width, mask.height);
    let (x0, y0, x1, y1) = video_rect(fit, gx, gy, gw, gh, w, h);
    for y in y0..y1 {
        let ya = (y as f64 + tol - fit.origin_y) / fit.scale;
        let yb = (y as f64 + 1.0 - tol - fit.origin_y) / fit.scale;
        if yb <= gy || ya >= gy + gh {
            continue;
        }
        for x in x0..x1 {
            let xa = (x as f64 + tol - fit.origin_x) / fit.scale;
            let xb = (x as f64 + 1.0 - tol - fit.origin_x) / fit.scale;
            if xb <= gx || xa >= gx + gw {
                continue;
            }
            let i = y * w + x;
            let inside = xa >= gx && xb <= gx + gw && ya >= gy && yb <= gy + gh;
            if inside {
                mask.piece[i] = piece as u8;
                mask.class[i] = class as u8;
            } else if mask.piece[i] == 0 || mask.piece[i] == piece as u8 {
                mask.piece[i] = piece as u8;
                if mask.class[i] == PixelClass::None as u8 {
                    mask.class[i] = PixelClass::Unknown as u8;
                }
            }
        }
    }
}

/// Record an accepted text line: its box (if it has a background) unknown, its pixels opaque, a hit.
#[allow(clippy::too_many_arguments)]
fn accept_line(
    mask: &mut GuiMask,
    fit: &GuiFit,
    o: &GuiOptions,
    piece: PieceId,
    index: u8,
    pixels: &[(i32, i32)],
    unit: i32,
    boxed: Option<(f64, f64, f64, f64)>,
    hits: usize,
) {
    if let Some(b) = boxed {
        paint(
            mask,
            fit,
            b,
            piece,
            PixelClass::Unknown,
            o.text_edge_tolerance_px,
        );
    }
    for &(gx, gy) in pixels {
        paint(
            mask,
            fit,
            (gx as f64, gy as f64, unit as f64, unit as f64),
            piece,
            PixelClass::Opaque,
            o.text_edge_tolerance_px,
        );
    }
    let (gx0, gx1, gy0, gy1) = match boxed {
        Some((bx, by, bw, bh)) => (bx as i32, (bx + bw) as i32, by as i32, (by + bh) as i32),
        None => (
            pixels.iter().map(|p| p.0).min().unwrap_or(0),
            pixels.iter().map(|p| p.0).max().unwrap_or(0) + unit,
            pixels.iter().map(|p| p.1).min().unwrap_or(0),
            pixels.iter().map(|p| p.1).max().unwrap_or(0) + unit,
        ),
    };
    mask.hits.push(PieceHit {
        piece,
        index,
        x: (fit.origin_x + gx0 as f64 * fit.scale).floor() as i32,
        y: (fit.origin_y + gy0 as f64 * fit.scale).floor() as i32,
        w: ((gx1 - gx0) as f64 * fit.scale).round() as u32,
        h: ((gy1 - gy0) as f64 * fit.scale).round() as u32,
        score: hits as f64,
        text: None,
    });
}

fn centre(hits: &[TextHit], unit: i32) -> f64 {
    let lo = hits.iter().map(|h| h.0).min().unwrap_or(0) as f64;
    let hi = (hits.iter().map(|h| h.0).max().unwrap_or(0) + unit) as f64;
    (lo + hi) / 2.0
}

fn is_black(
    frame: &[u8],
    w: usize,
    h: usize,
    fit: &GuiFit,
    gx: i32,
    gy: i32,
    o: &GuiOptions,
) -> bool {
    gui_px(frame, w, h, fit, gx, gy, 1)
        .is_some_and(|b| brightest(b) <= 3.0 * o.text_shadow_tolerance)
}

/// Shadowed text in the places the game draws it, the XP number, and F3 lines.
#[allow(clippy::too_many_arguments)] // Explicit frame geometry and independent detector inputs.
fn detect_text(
    frame: &[u8],
    w: usize,
    h: usize,
    fit: &GuiFit,
    o: &GuiOptions,
    boss_bars: usize,
    font: Option<&Texture>,
    mask: &mut GuiMask,
) {
    let (sw, sh) = (fit.scaled_width as i32, fit.scaled_height as i32);
    let half = sw as f64 / 2.0;
    // chat (ChatHud 40-97): text from x = 2, lines upward from y = H-48 every 9 GUI px
    for m in 0..CHAT_LINES {
        let base = sh - 40 - 9 * m;
        if base - 9 < 0 {
            break;
        }
        let hits = scan_text(frame, w, h, fit, o, 0, sw, base - 8, 1);
        if hits.len() >= o.text_min_hits && hits.iter().map(|h| h.0).min().unwrap_or(i32::MAX) <= 4
        {
            let px = line_pixels(frame, w, h, fit, o, &hits, base - 8, 1);
            let right = px.iter().map(|p| p.0).max().unwrap_or(2) + 2;
            let boxed = (0.0, (base - 9) as f64, right as f64, 9.0);
            accept_line(
                mask,
                fit,
                o,
                PieceId::ChatLine,
                m as u8,
                &px,
                1,
                Some(boxed),
                hits.len(),
            );
        }
    }
    // held-item name (InGameHud 569-601): centred at y = H-59, or H-45 without status bars
    for y0 in [sh - 59, sh - 45] {
        let hits = scan_text(frame, w, h, fit, o, 0, sw, y0, 1);
        let centred = (centre(&hits, 1) - half).abs() <= 4.0;
        if hits.len() >= o.text_min_hits
            && centred
            && hits.iter().map(|h| h.0).min().unwrap_or(0) > 6
        {
            let px = line_pixels(frame, w, h, fit, o, &hits, y0, 1);
            accept_line(mask, fit, o, PieceId::ItemName, 0, &px, 1, None, hits.len());
            break;
        }
    }
    // title x4 at y = H/2-40 and subtitle x2 at y = H/2+10, centred (InGameHud 259-299)
    for (piece, unit, y0) in [
        (PieceId::Title, 4, sh / 2 - 40),
        (PieceId::Subtitle, 2, sh / 2 + 10),
    ] {
        let x0 = (sw / 2).rem_euclid(unit);
        let hits = scan_text(frame, w, h, fit, o, x0, sw, y0, unit);
        // A legal anchor and a quarter-colour edge are not enough: flame
        // plateaus can mimic a centered shadowed line. Require glyph-height
        // support on at least four separate text rows before masking it.
        // Ambiguous low-height punctuation alone is left unknown/unmasked.
        let supported_rows: std::collections::BTreeSet<_> = hits.iter().map(|p| p.1).collect();
        if hits.len() >= o.text_min_hits
            && supported_rows.len() >= 4
            && (centre(&hits, unit) - half).abs() <= 2.0 * unit as f64 + 2.0
            && font.is_some_and(|font| {
                centred_scaled_glyphs(frame, w, h, fit, o, font, &hits, x0, y0, unit)
            })
        {
            let px = line_pixels(frame, w, h, fit, o, &hits, y0, unit);
            accept_line(mask, fit, o, piece, 0, &px, unit, None, hits.len());
        }
    }
    // boss names, 9 GUI px above each boss bar found (BossBarHud 41)
    for nb in 0..boss_bars as i32 {
        let y0 = 12 + 19 * nb - 9;
        let hits = scan_text(frame, w, h, fit, o, 0, sw, y0, 1);
        if hits.len() >= o.text_min_hits && (centre(&hits, 1) - half).abs() <= 4.0 {
            let px = line_pixels(frame, w, h, fit, o, &hits, y0, 1);
            accept_line(
                mask,
                fit,
                o,
                PieceId::BossName,
                nb as u8,
                &px,
                1,
                None,
                hits.len(),
            );
        }
    }
    // XP number (InGameHud 555-566): green 0x80FF20 over black copies offset by one pixel, centred at y = H-35
    let green = [128.0, 255.0, 32.0];
    let mut xp: Vec<(i32, i32)> = Vec::new();
    for gy in sh - 36..sh - 26 {
        for gx in (sw / 2 - 30).max(0)..(sw / 2 + 30).min(sw) {
            let Some(a) = gui_px(frame, w, h, fit, gx, gy, 1) else {
                continue;
            };
            let is_green = (0..3).all(|k| (a[k] - green[k]).abs() <= 3.0 * o.text_shadow_tolerance);
            if is_green
                && [(1, 0), (-1, 0), (0, 1), (0, -1)]
                    .iter()
                    .any(|&(dx, dy)| is_black(frame, w, h, fit, gx + dx, gy + dy, o))
            {
                xp.push((gx, gy));
            }
        }
    }
    if xp.len() >= 3 {
        let hits: Vec<TextHit> = xp.iter().map(|&(x, y)| (x, y, green)).collect();
        if (centre(&hits, 1) - half).abs() <= 4.0 {
            let mut px = xp.clone();
            for &(gx, gy) in &xp {
                for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                    if is_black(frame, w, h, fit, gx + dx, gy + dy, o) {
                        px.push((gx + dx, gy + dy));
                    }
                }
            }
            px.sort_unstable();
            px.dedup();
            accept_line(mask, fit, o, PieceId::XpLevel, 0, &px, 1, None, xp.len());
        }
    }
    // F3 (DebugHud 134-153): grey 0xE0E0E0 text, no shadow, rows from y = 2 every 9 GUI px, left from x = 2 and
    // right-aligned at W-2, each on a 0x90505050 box
    let f3 = [224.0, 224.0, 224.0];
    let mut idx = 0u8;
    for left in [true, false] {
        for row in 0..30 {
            let y = 2 + 9 * row;
            if y + 8 > sh {
                break;
            }
            let (x0, x1) = if left { (2, sw / 2) } else { (sw / 2, sw - 2) };
            let mut px = Vec::new();
            for gy in y..y + 8 {
                for gx in x0..x1 {
                    // exactly the neutral F3 grey (colour alone is weak: snow and quartz are bright grey too)
                    let grey = gui_px(frame, w, h, fit, gx, gy, 1).is_some_and(|a| {
                        (0..3).all(|k| (a[k] - f3[k]).abs() <= 2.0 * o.text_shadow_tolerance)
                            && brightest(a) - a.iter().cloned().fold(255.0, f64::min) <= 6.0
                    });
                    if grey {
                        px.push((gx, gy));
                    }
                }
            }
            if px.len() < o.text_min_hits {
                break;
            }
            let lo = px.iter().map(|p| p.0).min().unwrap_or(0);
            let hi = px.iter().map(|p| p.0).max().unwrap_or(0) + 1;
            // a line starts at x = 2 (left) or ends at W-2 (right) (DebugHud 147, 160), and text is thin strokes:
            // a solid bright patch is not a line
            let anchored = if left { lo <= 3 } else { hi >= sw - 3 };
            let density = px.len() as f64 / ((hi - lo) as f64 * 8.0);
            if !anchored || density > 0.6 {
                break;
            }
            let boxed = (lo as f64 - 1.0, y as f64 - 1.0, (hi - lo + 2) as f64, 9.0);
            let n = px.len();
            accept_line(
                mask,
                fit,
                o,
                PieceId::DebugText,
                idx,
                &px,
                1,
                Some(boxed),
                n,
            );
            idx = idx.saturating_add(1);
        }
    }
}

// ================================================================ action bar

/// One printable glyph as column bitmasks (bit r = row r of its 8x8 cell), `advance` columns long (the last one is
/// the empty gap), and its ink pixel count.
struct GlyphCols {
    ch: char,
    cols: Vec<u8>,
    ink: u32,
}

/// A plausible screen location plus shadow pairs must still read as actual
/// font glyphs. Orange block edges may otherwise occupy the subtitle band.
#[allow(clippy::too_many_arguments)]
fn centred_scaled_glyphs(
    frame: &[u8],
    w: usize,
    h: usize,
    fit: &GuiFit,
    o: &GuiOptions,
    font: &Texture,
    hits: &[TextHit],
    x0: i32,
    y0: i32,
    unit: i32,
) -> bool {
    let sw = fit.scaled_width as i32;
    let colour: [f64; 3] = std::array::from_fn(|k| {
        let mut values: Vec<_> = hits.iter().map(|p| p.2[k]).collect();
        values.sort_by(f64::total_cmp);
        values[values.len() / 2]
    });
    let tol = o.action_bar_color_tolerance;
    let ink: Vec<u16> = (x0..sw)
        .step_by(unit as usize)
        .map(|x| {
            (0..10).fold(0u16, |bits, r| {
                let yes = gui_px(frame, w, h, fit, x, y0 + (r - 1) * unit, unit).is_some_and(|a| {
                    (luma3(a) - luma3(colour)).abs() <= tol
                        && (0..3).all(|k| (a[k] - colour[k]).abs() <= 3. * tol)
                });
                if yes {
                    bits | (1 << r)
                } else {
                    bits
                }
            })
        })
        .collect();
    let half = (sw / 2 - x0) / unit;
    let first = (hits.iter().map(|p| p.0).min().unwrap_or(x0) - x0) / unit;
    let glyphs = glyph_columns(font);
    let costs = GlyphCosts::new(&ink, &glyphs);
    for start in (first - 1).max(1)..=(first + 1).min(half - 1) {
        if let Some(p) = parse_centred(&costs, half, start, o.action_bar_glyph_cost) {
            let count = p.glyphs.iter().filter(|&&g| glyphs[g].ch != ' ').count();
            if count >= 2
                && p.ink >= 20
                && p.mismatch as f64 / p.ink as f64 <= o.action_bar_max_mismatch
            {
                return true;
            }
        }
    }
    false
}

fn glyph_columns(font: &Texture) -> Vec<GlyphCols> {
    (' '..='~')
        .map(|ch| {
            let (cx, cy, adv) = glyph(font, ch);
            let cols: Vec<u8> = (0..adv as i64)
                .map(|x| {
                    if ch == ' ' || x >= 8 {
                        return 0;
                    }
                    (0..8).fold(0u8, |m, r| {
                        if font.texel(cx + x, cy + r)[3] > 0 {
                            m | 1 << r
                        } else {
                            m
                        }
                    })
                })
                .collect();
            let ink = cols.iter().map(|c| c.count_ones()).sum();
            GlyphCols { ch, cols, ink }
        })
        .collect()
}

/// Luma of a sampled colour. Video keeps luma at full resolution but halves chroma (4:2:0), which smears the colour of
/// a one-pixel stroke into its neighbours, so ink is matched on luma with only a loose colour check.
fn luma3(a: [f64; 3]) -> f64 {
    0.299 * a[0] + 0.587 * a[1] + 0.114 * a[2]
}

/// The best reading of the band as a centred glyph sequence: (start column, glyph indices, mismatches, glyph ink).
struct Parse {
    start: i32,
    glyphs: Vec<usize>,
    mismatch: u32,
    ink: u32,
}

/// Integer pixel/glyph comparisons depend on the absolute band column, not
/// the proposed line start or parser state. Reuse them only within this band
/// and colour hypothesis; current-frame pixels and font remain the inputs.
struct GlyphCosts<'a> {
    ink: &'a [u16],
    font: &'a [GlyphCols],
    rows: Vec<OnceCell<Vec<(u32, u32)>>>,
}
impl<'a> GlyphCosts<'a> {
    fn new(ink: &'a [u16], font: &'a [GlyphCols]) -> Self {
        Self {
            ink,
            font,
            rows: (0..ink.len()).map(|_| OnceCell::new()).collect(),
        }
    }
    fn row(&self, position: usize) -> &[(u32, u32)] {
        self.rows[position].get_or_init(|| {
            self.font
                .iter()
                .map(|gc| {
                    let (mut mismatch, mut hit) = (0, 0);
                    for (j, &c) in gc.cols.iter().enumerate() {
                        let col = self.ink.get(position + j).copied().unwrap_or(0);
                        let c = (c as u16) << 1;
                        mismatch += (col ^ c).count_ones();
                        hit += (col & c).count_ones();
                    }
                    (mismatch, hit)
                })
                .collect()
        })
    }
}

/// Read `ink` (one column bitmask per GUI column: bit 0 the row above the band, bits 1..8 its 8 rows, bit 9 the row
/// below) as glyphs, left to right from `s`, for a line whose width `tw` puts it centred: `s = W/2 - tw/2`
/// (InGameHud 247), so `tw` is `2(W/2 - s)` or one more. A line starts and ends with a glyph and never has two spaces in
/// a row (vanilla messages do not), and the font leaves a free frame around it: the columns just outside must be free
/// of ink and ink in the rows above and below counts as mismatch, so text over a bright blob is not read at all rather
/// than read wrong.
fn parse_centred(costs: &GlyphCosts<'_>, half: i32, s: i32, glyph_cost: f64) -> Option<Parse> {
    let (ink, font) = (costs.ink, costs.font);
    let k = half - s;
    if k < 1 {
        return None;
    }
    let len = (2 * k + 1) as usize;
    if s < 1 || s as usize + len > ink.len() {
        return None;
    }
    // dp[i][last glyph was a space] = (mismatches, glyph ink, previous position, previous state, glyph) and the path's
    // gain: ink the glyphs explain that is really there, minus mismatches, minus `glyph_cost` per non-space glyph
    // (spaces are free: a gap over bright world is a space, not punctuation made of world specks)
    type Cell = Option<(u32, u32, usize, usize, usize)>;
    let mut dp: Vec<[Cell; 2]> = vec![[None, None]; len + 1];
    let mut gain: Vec<[f64; 2]> = vec![[f64::NEG_INFINITY; 2]; len + 1];
    // start as if after a space, so a line cannot begin with one
    dp[0][1] = Some((0, 0, 0, 0, 0));
    gain[0][1] = 0.0;
    for i in 0..len {
        if dp[i].iter().all(Option::is_none) {
            continue;
        }
        let comparisons = costs.row(s as usize + i);
        for st in 0..2 {
            let Some((m0, k0, _, _, _)) = dp[i][st] else {
                continue;
            };
            for (g, gc) in font.iter().enumerate() {
                let space = gc.ch == ' ';
                if space && st == 1 {
                    continue;
                }
                let a = gc.cols.len();
                if i + a > len {
                    continue;
                }
                let (m, hit) = comparisons[g];
                let ns = space as usize;
                let gn = gain[i][st] + hit as f64 - m as f64 - if space { 0.0 } else { glyph_cost };
                if gn > gain[i + a][ns] {
                    gain[i + a][ns] = gn;
                    dp[i + a][ns] = Some((m0 + m, k0 + gc.ink, i, st, g));
                }
            }
        }
    }
    let ratio = |d: &(u32, u32, usize, usize, usize)| d.0 as f64 / d.1.max(1) as f64;
    // the line ends on a glyph; the columns just outside it are free (the left one is checked by the caller), and
    // only their rows above and below the band can still disagree
    let (e, d) = [2 * k as usize, len]
        .into_iter()
        .filter(|&e| ink.get(s as usize + e).is_some_and(|c| c & 0x1fe == 0))
        .filter_map(|e| dp[e][0].map(|d| (e, d)))
        .map(|(e, mut d)| {
            d.0 += ink[s as usize - 1].count_ones() + ink[s as usize + e].count_ones();
            (e, d)
        })
        .min_by(|a, b| ratio(&a.1).total_cmp(&ratio(&b.1)))?;
    let (mismatch, ink_total) = (d.0, d.1);
    let (mut i, mut st) = (e, 0usize);
    let mut glyphs = Vec::new();
    while i > 0 {
        let (_, _, prev, pst, g) = dp[i][st]?;
        glyphs.push(g);
        i = prev;
        st = pst;
    }
    glyphs.reverse();
    Some(Parse {
        start: s,
        glyphs,
        mismatch,
        ink: ink_total,
    })
}

/// The action bar (InGameHud 229-257): one line centred at y = H-72, no shadow and no background. The colour alone
/// proves nothing, so a line is accepted only when its pixels read as real glyphs of the font; the glyphs read are
/// the hit's text. A fading line (colour blended with the world) does not read and is left alone.
fn detect_action_bar(
    frame: &[u8],
    w: usize,
    h: usize,
    fit: &GuiFit,
    o: &GuiOptions,
    font: &Texture,
    mask: &mut GuiMask,
) {
    let (sw, sh) = (fit.scaled_width as i32, fit.scaled_height as i32);
    let y0 = sh - 72;
    if y0 < 0 || sw < 8 {
        return;
    }
    let half = sw / 2;
    // the band's 8 rows plus the free row above and below (index 0 and 9)
    let band: Vec<[Option<[f64; 3]>; 10]> = (0..sw)
        .map(|gx| std::array::from_fn(|r| gui_px(frame, w, h, fit, gx, y0 + r as i32 - 1, 1)))
        .collect();
    // candidate line colours: the most common bright colours in the band, in fine bins (8 levels) because the line is
    // one flat colour that piles up in a bin while the world spreads over many (a coarse bin's median is the world's)
    let mut bins: std::collections::HashMap<(u8, u8, u8), Vec<[f64; 3]>> = Default::default();
    for col in &band {
        for a in col[1..9].iter().flatten() {
            if brightest(*a) >= o.text_min_bright {
                let key = (a[0] as u8 >> 3, a[1] as u8 >> 3, a[2] as u8 >> 3);
                bins.entry(key).or_default().push(*a);
            }
        }
    }
    let mut bins: Vec<_> = bins.into_iter().collect();
    bins.sort_by(|a, b| b.1.len().cmp(&a.1.len()).then(a.0.cmp(&b.0)));
    let glyphs = glyph_columns(font);
    let non_space = |q: &Parse| q.glyphs.iter().filter(|&&g| glyphs[g].ch != ' ').count();
    // the whole line explains the most ink (a centred fragment of it reads cleanly too), but every glyph costs: tiny
    // glyphs ('.', ''') laid over world specks would otherwise pad the line
    let gain = |q: &Parse| {
        q.ink as f64 - q.mismatch as f64 - o.action_bar_glyph_cost * non_space(q) as f64
    };
    // the best centred reading of the band in `colour` at `tol`, starting at most at `s_max`
    let read = |colour: [f64; 3], tol: f64, s_max: i32| -> Option<(Parse, f64)> {
        let is_ink = |a: Option<[f64; 3]>| {
            a.is_some_and(|a| {
                (luma3(a) - luma3(colour)).abs() <= tol
                    && (0..3).all(|k| (a[k] - colour[k]).abs() <= 3.0 * tol)
            })
        };
        let ink: Vec<u16> = band
            .iter()
            .map(|col| (0..10).fold(0u16, |m, r| if is_ink(col[r]) { m | 1 << r } else { m }))
            .collect();
        let costs = GlyphCosts::new(&ink, &glyphs);
        let mut best: Option<(Parse, f64)> = None;
        for s in 1..=s_max.min(half - 1) {
            // glyphs are left-aligned in their cells, so a line starts on an inked column after a free one
            if ink[s as usize] & 0x1fe == 0 || ink[s as usize - 1] & 0x1fe != 0 {
                continue;
            }
            // and ends with a glyph whose last column is inked, just before its one empty column
            let k = (half - s) as usize;
            let inked = |c: usize| ink.get(s as usize + c).is_some_and(|m| m & 0x1fe != 0);
            if !inked(2 * k - 2) && !inked(2 * k - 1) {
                continue;
            }
            let Some(p) = parse_centred(&costs, half, s, o.action_bar_glyph_cost) else {
                continue;
            };
            let ratio = p.mismatch as f64 / p.ink.max(1) as f64;
            if non_space(&p) < o.action_bar_min_glyphs || ratio > o.action_bar_max_mismatch {
                continue;
            }
            if best.as_ref().is_none_or(|b| gain(&p) > gain(&b.0)) {
                best = Some((p, ratio));
            }
        }
        best
    };
    // strict: the line must read at the tight tolerance first (bright world cannot pass for text there). Bright
    // world often outnumbers the line's pixels, so several colour bins are tried.
    let mut strict: Option<(Parse, f64, [f64; 3])> = None;
    for (_, members) in bins.iter().take(8) {
        if members.len() < 4 * o.action_bar_min_glyphs {
            break;
        }
        let colour: [f64; 3] = std::array::from_fn(|k| {
            let mut v: Vec<f64> = members.iter().map(|a| a[k]).collect();
            v.sort_by(f64::total_cmp);
            v[v.len() / 2]
        });
        if let Some((p, ratio)) = read(colour, o.action_bar_color_tolerance, half - 1) {
            if strict.as_ref().is_none_or(|b| gain(&p) > gain(&b.0)) {
                strict = Some((p, ratio, colour));
            }
        }
    }
    let Some((p0, r0, colour)) = strict else {
        return;
    };
    // re-read the found line at looser tolerances (video smears a thin coloured stroke over varied ground, losing a
    // glyph or two at the tight one), only as the same centred line or a wider one; the cleanest reading wins
    let mut best = Some((p0, r0));
    for f in [1.5, 2.0, 3.0] {
        let tol = o.action_bar_color_tolerance * f;
        if tol > o.action_bar_reread_tolerance {
            break;
        }
        let s_max = best.as_ref().map_or(0, |b| b.0.start);
        if let Some((p, ratio)) = read(colour, tol, s_max) {
            let b = best.as_ref().unwrap();
            if ratio < b.1 - 0.005 || (ratio <= b.1 + 0.005 && gain(&p) > gain(&b.0)) {
                best = Some((p, ratio));
            }
        }
    }
    let Some((p, ratio)) = best else {
        return;
    };
    let mut x = p.start;
    for &g in &p.glyphs {
        for (j, &c) in glyphs[g].cols.iter().enumerate() {
            for r in 0..8 {
                if c >> r & 1 == 1 {
                    paint(
                        mask,
                        fit,
                        ((x + j as i32) as f64, (y0 + r) as f64, 1.0, 1.0),
                        PieceId::ActionBar,
                        PixelClass::Opaque,
                        o.text_edge_tolerance_px,
                    );
                }
            }
        }
        x += glyphs[g].cols.len() as i32;
    }
    let text: String = p.glyphs.iter().map(|&g| glyphs[g].ch).collect();
    mask.hits.push(PieceHit {
        piece: PieceId::ActionBar,
        index: 0,
        x: (fit.origin_x + p.start as f64 * fit.scale).floor() as i32,
        y: (fit.origin_y + y0 as f64 * fit.scale).floor() as i32,
        w: ((x - p.start) as f64 * fit.scale).round() as u32,
        h: (8.0 * fit.scale).round() as u32,
        score: 1.0 - ratio,
        text: Some(text.trim_end().to_string()),
    });
}

// ================================================================ sound captions

/// One caption line in its box band (10 GUI rows: bit r of a column is row `y_box + r`).
struct CaptionLine {
    ink: Vec<u16>,
    /// Column of a `<` arrow set aside, if any.
    left: Option<i32>,
    /// A `>` arrow at its fixed place was set aside.
    right: bool,
    /// First and last inked column of the text.
    a: i32,
    b: i32,
    /// The line's grey (luma).
    grey: f64,
}

/// The cols of glyph `g` at `x` match the band's 8 text rows (bits 1..8) within one pixel.
fn glyph_at(ink: &[u16], x: i32, g: &GlyphCols) -> bool {
    x >= 0
        && g.cols
            .iter()
            .enumerate()
            .map(|(j, &c)| {
                let col = ink.get((x + j as i32) as usize).copied().unwrap_or(0x1fe);
                (((col >> 1) & 0xff) as u8 ^ c).count_ones()
            })
            .sum::<u32>()
            <= 1
}

/// Sound captions (SubtitlesHud 39-101): boxes of one width `2l+2` at GUI x `[W-2l-3, W-1)`, rows
/// `[H-35-10i, H-25-10i)` from the oldest (i = 0) up, black at alpha 204; grey unshadowed text centred on
/// `c = W-l-2`, an optional `<` at the box's left or `>` ending at W-3. Accepted only when every line reads as font
/// glyphs about one centre and that centre gives the widest line's width back (`2l` = width + 18 halved).
fn detect_captions(
    frame: &[u8],
    w: usize,
    h: usize,
    fit: &GuiFit,
    o: &GuiOptions,
    font: &Texture,
    mask: &mut GuiMask,
) {
    let (sw, sh) = (fit.scaled_width as i32, fit.scaled_height as i32);
    if sw < 40 || sh < 40 {
        return;
    }
    let px = |gx: i32, gy: i32| gui_px(frame, w, h, fit, gx, gy, 1);
    let spread = |a: [f64; 3]| brightest(a) - a.iter().cloned().fold(255.0, f64::min);
    let neutral_bright = |a: [f64; 3]| spread(a) <= o.caption_ink_tolerance && brightest(a) >= 64.0;
    let dim = |a: [f64; 3]| brightest(a) <= o.caption_dim_max;
    let glyphs = glyph_columns(font);
    let find = |ch: char| glyphs.iter().find(|g| g.ch == ch).expect("printable glyph");
    let (lt, gt) = (find('<'), find('>'));
    let mut lines: Vec<CaptionLine> = Vec::new();
    for i in 0..30 {
        let y_box = sh - 35 - 10 * i;
        if y_box < 0 {
            break;
        }
        // the box reaches the right edge less one column: the pixels there are dim or text, and mostly dim (text
        // strokes are a minority of any box area)
        let (mut ok, mut dark) = (0, 0);
        for gy in y_box..y_box + 10 {
            for gx in sw - 12..sw - 1 {
                if let Some(a) = px(gx, gy) {
                    ok += (dim(a) || neutral_bright(a)) as usize;
                    dark += dim(a) as usize;
                }
            }
        }
        if (ok as f64) < o.caption_min_dim_share * 110.0 || dark < 55 {
            break;
        }
        // the box is the run of dim-or-text columns reaching the right edge; ink left of it is world
        // (a box column: its top and bottom rows never hold text, so they are dim; the rest is dim or text)
        let box_col = |x: i32| {
            [0, 9].iter().all(|&r| px(x, y_box + r).is_some_and(dim))
                && (1..9)
                    .filter(|&r| px(x, y_box + r).is_some_and(|a| dim(a) || neutral_bright(a)))
                    .count()
                    >= 7
        };
        let mut run = sw - 1;
        while run > 0 && box_col(run - 1) {
            run -= 1;
        }
        if run > sw - 12 {
            break;
        }
        // the line's grey: the most common bright neutral luma bin inside the box
        let mut bins: std::collections::HashMap<u8, Vec<f64>> = Default::default();
        for gy in y_box + 1..y_box + 9 {
            for gx in run..sw - 1 {
                if let Some(a) = px(gx, gy).filter(|&a| neutral_bright(a)) {
                    let l = luma3(a);
                    bins.entry((l as u8) >> 3).or_default().push(l);
                }
            }
        }
        let Some(mut top) = bins.into_values().max_by_key(|v| v.len()) else {
            break;
        };
        if top.len() < 4 {
            break;
        }
        top.sort_by(f64::total_cmp);
        let grey = top[top.len() / 2];
        let mut ink: Vec<u16> = (0..sw)
            .map(|gx| {
                (0..10).fold(0u16, |m, r| match px(gx, y_box + r) {
                    Some(a)
                        if neutral_bright(a)
                            && (luma3(a) - grey).abs() <= o.caption_ink_tolerance =>
                    {
                        m | 1 << r
                    }
                    _ => m,
                })
            })
            .collect();
        // and it stops one column short of the right edge
        for x in (0..run).chain(sw - 1..sw) {
            ink[x as usize] = 0;
        }
        // set the arrows aside: `>` ends at W-3 (x = W-7); a `<` is the first glyph, with a gap after it
        let right = glyph_at(&ink, sw - 7, gt);
        if right {
            for x in sw - 7..sw - 2 {
                ink[x as usize] = 0;
            }
        }
        let mut left = None;
        if let Some(a) = (sw / 2..sw).find(|&x| ink[x as usize] & 0x1fe != 0) {
            let gap = (a + 5..a + 8).all(|x| ink.get(x as usize).is_none_or(|c| c & 0x1fe == 0));
            if gap && glyph_at(&ink, a, lt) {
                left = Some(a);
                for x in a..a + 5 {
                    ink[x as usize] = 0;
                }
            }
        }
        let inked: Vec<i32> = (sw / 2..sw)
            .filter(|&x| ink[x as usize] & 0x1fe != 0)
            .collect();
        let (Some(&a), Some(&b)) = (inked.first(), inked.last()) else {
            break;
        };
        lines.push(CaptionLine {
            ink,
            left,
            right,
            a,
            b,
            grey,
        });
    }
    if lines.is_empty() {
        return;
    }
    // the widest line gives the centre; each line must read as glyphs centred on it
    let widest = lines.iter().max_by_key(|l| l.b - l.a).expect("a line");
    let c0 = widest.a + (widest.b - widest.a + 2) / 2;
    // centre, the lines read there with their mismatch rates, and the ink they explain
    type Reading = (i32, Vec<(Parse, f64)>, f64);
    let mut best: Option<Reading> = None;
    for c in [c0, c0 - 1, c0 + 1] {
        let mut read = Vec::new();
        let mut total = 0.0;
        for l in &lines {
            let costs = GlyphCosts::new(&l.ink, &glyphs);
            let Some(p) = parse_centred(&costs, c, l.a, o.action_bar_glyph_cost) else {
                break;
            };
            let ratio = p.mismatch as f64 / p.ink.max(1) as f64;
            let n = p.glyphs.iter().filter(|&&g| glyphs[g].ch != ' ').count();
            if ratio > o.action_bar_max_mismatch || n < o.action_bar_min_glyphs {
                break;
            }
            total += p.ink as f64 - p.mismatch as f64;
            read.push((p, ratio));
        }
        let better = best
            .as_ref()
            .is_none_or(|b| read.len() > b.1.len() || (read.len() == b.1.len() && total > b.2));
        if !read.is_empty() && better {
            best = Some((c, read, total));
        }
    }
    let Some((c, read, _)) = best else {
        return;
    };
    // geometry: l = W-2-c, and the widest line read must give l back (j = width + 18, l = j/2)
    let l = sw - 2 - c;
    let width = |p: &Parse| {
        p.glyphs
            .iter()
            .map(|&g| glyphs[g].cols.len() as i32)
            .sum::<i32>()
    };
    let maxw = read.iter().map(|(p, _)| width(p)).max().unwrap_or(0);
    let x_box = sw - 2 * l - 3;
    if (maxw + text_width(font, "< > ")) / 2 != l || x_box < 0 {
        mask.notes.push(format!(
            "caption-like lines rejected: centre {c} gives a box {l} GUI px half-wide, the widest text is {maxw}"
        ));
        return;
    }
    // each box is dim or text all over, and a `<` sits at its left edge
    let mut n_ok = 0;
    for (i, line) in lines.iter().enumerate().take(read.len()) {
        if line.left.is_some_and(|x| x != x_box + 1) {
            break;
        }
        let y_box = sh - 35 - 10 * i as i32;
        let (mut good, mut all) = (0usize, 0usize);
        for gy in y_box..y_box + 10 {
            for gx in x_box..sw - 1 {
                all += 1;
                let fits = px(gx, gy).is_some_and(|a| {
                    dim(a)
                        || (neutral_bright(a)
                            && (luma3(a) - line.grey).abs() <= o.caption_ink_tolerance)
                });
                good += fits as usize;
            }
        }
        if (good as f64) < o.caption_min_dim_share * all as f64 {
            break;
        }
        n_ok += 1;
    }
    for (i, (p, ratio)) in read.iter().take(n_ok).enumerate() {
        let line = &lines[i];
        let y_box = sh - 35 - 10 * i as i32;
        paint(
            mask,
            fit,
            (x_box as f64, y_box as f64, (2 * l + 2) as f64, 10.0),
            PieceId::SoundCaption,
            PixelClass::Translucent,
            o.edge_tolerance_px,
        );
        let mut placed: Vec<(i32, &GlyphCols)> = Vec::new();
        let mut x = p.start;
        for &g in &p.glyphs {
            placed.push((x, &glyphs[g]));
            x += glyphs[g].cols.len() as i32;
        }
        if let Some(xl) = line.left {
            placed.push((xl, lt));
        }
        if line.right {
            placed.push((sw - 7, gt));
        }
        for (gx, g) in placed {
            for (j, &col) in g.cols.iter().enumerate() {
                for r in 0..8 {
                    if col >> r & 1 == 1 {
                        paint(
                            mask,
                            fit,
                            ((gx + j as i32) as f64, (y_box + 1 + r) as f64, 1.0, 1.0),
                            PieceId::SoundCaption,
                            PixelClass::Opaque,
                            o.text_edge_tolerance_px,
                        );
                    }
                }
            }
        }
        let text: String = p.glyphs.iter().map(|&g| glyphs[g].ch).collect();
        mask.hits.push(PieceHit {
            piece: PieceId::SoundCaption,
            index: i as u8,
            x: (fit.origin_x + x_box as f64 * fit.scale).floor() as i32,
            y: (fit.origin_y + y_box as f64 * fit.scale).floor() as i32,
            w: ((2 * l + 2) as f64 * fit.scale).round() as u32,
            h: (10.0 * fit.scale).round() as u32,
            score: 1.0 - ratio,
            text: Some(text.trim_end().to_string()),
        });
    }
}

#[cfg(test)]
mod correlation_parity {
    use super::*;
    #[test]
    fn glyph_costs_keep_tie_order_and_do_not_cross_ink_hypotheses() {
        let font: Vec<_> = [
            (' ', vec![0; 4]),
            ('A', vec![7, 5, 7, 0]),
            ('B', vec![7, 7, 5, 0]),
            ('C', vec![7, 5, 7, 0]),
        ]
        .into_iter()
        .map(|(ch, cols)| {
            let ink = cols.iter().map(|c: &u8| c.count_ones()).sum();
            GlyphCols { ch, cols, ink }
        })
        .collect();
        for expected in [[1, 2], [2, 1]] {
            let mut ink = vec![0; 24];
            for (position, &g) in expected.iter().enumerate() {
                for (j, &column) in font[g].cols.iter().enumerate() {
                    ink[8 + position * 4 + j] = (column as u16) << 1;
                }
            }
            let costs = GlyphCosts::new(&ink, &font);
            // Nearby proposed starts share costs, but must not alter the
            // winning reading or replace the first glyph in an exact tie.
            let _ = parse_centred(&costs, 12, 7, 3.5);
            for _ in 0..2 {
                let p = parse_centred(&costs, 12, 8, 3.5).unwrap();
                assert_eq!(p.glyphs, expected);
                assert_eq!((p.start, p.mismatch, p.ink), (8, 0, 16));
            }
        }
    }

    #[test]
    fn plausible_nearby_wrong_hint_does_not_override_the_current_peak() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../data/assets/gui");
        let detector =
            GuiDetector::new(GuiTextures::load(&dir).unwrap(), GuiOptions::default()).unwrap();
        let (w, h) = (640, 480);
        let mut rgb: Vec<u8> = (0..w * h * 3)
            .map(|i| ((i * 17 + i / 73) % 256) as u8)
            .collect();
        compose_hud(
            &mut rgb,
            w,
            h,
            detector.textures(),
            &HudState::default(),
            &GuiFit::framebuffer(640, 480, 2, 1.),
        );
        let expected = detector.detect(&rgb, w, h).unwrap();
        let wrong = GuiFit::for_video(2.00313, w, h, 0., 0.);
        let mut hint = GuiFitHint {
            previous: Some((w, h, wrong, 0.8, 0.1)),
            reused: false,
        };
        let result = detector.detect_with_hint(&rgb, w, h, &mut hint).unwrap();
        assert!(!hint.reused());
        assert_eq!(result.fit, expected.fit);
        assert_eq!(result.class, expected.class);
        assert_eq!(result.piece, expected.piece);
    }

    #[test]
    fn compiled_grid_preserves_ordered_score_bits_and_clipping() {
        let (w, h) = (180, 120);
        let frame: Vec<_> = (0..w * h * 3)
            .map(|i| ((i * 37 + i / 17) % 256) as u8)
            .collect();
        let lum = LumaRows::new(&frame, w, h);
        let mut compiled = corners(&Template::new(
            (0..14)
                .flat_map(|v| {
                    (0..32).filter_map(move |u| {
                        (u % 5 != 0).then_some((
                            u as f64 + 0.5,
                            v as f64 + 0.5,
                            ((u * 19 + v * 31) % 255) as f64,
                        ))
                    })
                })
                .collect(),
        ));
        assert!(compiled.grid.is_some());
        let grid = compiled.grid.take();
        for (x, y, s) in [
            (0., 0., 1.),
            (1.125, 2.875, 2.5),
            (3.9, 4.1, 0.375),
            (-2., 1., 1.5),
            (170., 110., 1.),
        ] {
            for step in [1, 3] {
                let expected = score(&lum, w, h, &compiled, x, y, s, step).map(f64::to_bits);
                compiled.grid = grid.as_ref().map(|g| SampleGrid {
                    columns: g.columns.clone(),
                    rows: g.rows.clone(),
                    points: g.points.clone(),
                });
                assert_eq!(
                    score(&lum, w, h, &compiled, x, y, s, step).map(f64::to_bits),
                    expected
                );
                compiled.grid = None;
            }
        }
        assert!(
            SampleGrid::new(&(0..1100).map(|i| (i as f64, 0., 1.)).collect::<Vec<_>>()).is_none()
        );
        assert!(
            SampleGrid::new(&(0..1100).map(|i| (0., i as f64, 1.)).collect::<Vec<_>>()).is_none()
        );
    }

    #[test]
    fn inline_shape_keys_preserve_layer_identity_and_order() {
        let a = lay(Sheet::Widgets, 0, 0, 16, 16);
        let b = lay(Sheet::Widgets, 16, 0, 16, 16);
        for layers in [vec![], vec![a], vec![a, b], vec![a, b, a]] {
            assert!(
                ShapeLayers::from(layers.as_slice())
                    == ShapeLayers::from(layers.clone().as_slice())
            );
        }
        assert!(ShapeLayers::from([a, b].as_slice()) != ShapeLayers::from([b, a].as_slice()));
    }

    #[test]
    fn cached_and_in_frame_paths_match_dense_reference_bits() {
        let (w, h) = (40, 32);
        let frame: Vec<_> = (0..w * h * 3)
            .map(|i| ((i * 37 + i / 17) % 256) as u8)
            .collect();
        let dense: Vec<_> = frame
            .as_chunks::<3>()
            .0
            .iter()
            .map(|p| luma(p[0], p[1], p[2]))
            .collect();
        let lum = LumaRows::new(&frame, w, h);
        let t = Template::new(
            (0..7)
                .flat_map(|y| {
                    (0..9).map(move |x| {
                        (
                            x as f64 + 0.15,
                            y as f64 + 0.85,
                            ((x * 19 + y * 31) % 255) as f64,
                        )
                    })
                })
                .collect(),
        );
        for (x, y, s) in [
            (1., 2., 1.),
            (-2., 1., 1.5),
            (35., 4., 1.),
            (2., 27., 0.8),
            (0., 0., 2.5),
        ] {
            for step in [1, 3] {
                let (mut n, mut inside, mut sa, mut sb, mut saa, mut sbb, mut sab) =
                    (0usize, 0usize, 0., 0., 0., 0., 0.);
                for &(u, v, a) in t.pts.iter().step_by(step) {
                    n += 1;
                    let px = x + u * s;
                    let py = y + v * s;
                    if px < 0. || py < 0. || px >= w as f64 || py >= h as f64 {
                        continue;
                    }
                    inside += 1;
                    let b = dense[py as usize * w + px as usize];
                    sa += a;
                    sb += b;
                    saa += a * a;
                    sbb += b * b;
                    sab += a * b;
                }
                let m = inside as f64;
                let va = saa - sa * sa / m;
                let vb = sbb - sb * sb / m;
                let reference = if n == 0
                    || (inside as f64) < 0.6 * n as f64
                    || va <= 1e-9 * m
                    || vb <= 1e-6 * m
                {
                    None
                } else {
                    Some((sab - sa * sb / m) / (va * vb).sqrt())
                };
                assert_eq!(
                    score(&lum, w, h, &t, x, y, s, step).map(f64::to_bits),
                    reference.map(f64::to_bits)
                );
                if step == 3 {
                    assert_eq!(
                        CompiledTemplate::new(&t, x, y, s, w, h)
                            .score(&lum)
                            .map(f64::to_bits),
                        reference.map(f64::to_bits)
                    );
                }
            }
        }
    }
}
