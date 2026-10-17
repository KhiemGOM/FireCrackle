//! Unified per-piece GUI mask, phase 1: GUI scale fit and the neutral HUD (see `FireCrackle/PLAN-GUI-MASK.md`).
//!
//! Metadata only: for every pixel, which HUD piece (if any) is drawn there and whether it is opaque, translucent (world
//! still visible, blended with a known colour) or unknown. Nothing is erased. Geometry is Yarn 1.16.5 `InGameHud` /
//! `Window` (line numbers in the plan); presence and the scale are read from the pixels by matching the vanilla
//! textures, never assumed. Only meant for footage the user confirmed to be vanilla 1.16.5.

use std::path::Path;

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
        })
    }

    /// `widgets.rgba`, `icons.rgba` and `inventory.rgba` from a folder.
    pub fn load(dir: &Path) -> Result<GuiTextures, String> {
        let read = |n: &str| {
            std::fs::read(dir.join(n)).map_err(|e| format!("{}: {e}", dir.join(n).display()))
        };
        GuiTextures::from_rgba(
            read("widgets.rgba")?,
            read("icons.rgba")?,
            read("inventory.rgba")?,
        )
    }

    fn sheet(&self, s: Sheet) -> &Texture {
        match s {
            Sheet::Widgets => &self.widgets,
            Sheet::Icons => &self.icons,
            Sheet::Inventory => &self.inventory,
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Sheet {
    Widgets,
    Icons,
    Inventory,
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
        }
    }
}

/// One texture rectangle drawn at the piece's origin (plus `dx`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
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
        for zx in 0..10 {
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
        if let Some(b) = st.air {
            // t = o - 10, minus 10 for the food row, plus 10 (no mount: getHeartRows(0) - 1 = -1)
            for ae in 0..(b.min(10) as i32) {
                out.push(place(
                    PieceId::Air,
                    ae as u8,
                    n - ae * 8 - 9,
                    o - 10,
                    9,
                    9,
                    vec![lay(Sheet::Icons, 16, 18, 9, 9)],
                ));
            }
        }
    }
    if st.xp_bar {
        // renderExperienceBar 540-553: fill is (int)(progress * 183) wide
        let fill = (st.xp_progress.clamp(0.0, 1.0) * 183.0) as u32;
        let mut layers = vec![lay(Sheet::Icons, 0, 64, 182, 5)];
        if fill > 0 {
            layers.push(lay(Sheet::Icons, 0, 69, fill, 5));
        }
        out.push(place(PieceId::XpBar, 0, c - 91, h - 29, 182, 5, layers));
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
        let t = tex.sheet(l.sheet);
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
}

impl Default for GuiOptions {
    fn default() -> GuiOptions {
        GuiOptions {
            min_scale: 1.0,
            hotbar_min_score: 0.8,
            piece_min_score: 0.8,
            edge_tolerance_px: 0.05,
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
    /// False when no vanilla hotbar was confirmed: then nothing is labelled.
    pub reliable: bool,
    pub hits: Vec<PieceHit>,
    pub notes: Vec<String>,
}

/// A template: luma of the piece's opaque pixels, at GUI pixel coordinates relative to the piece.
struct Template {
    pts: Vec<(f64, f64, f64)>,
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
    Template { pts: pts.collect() }
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
    Template { pts }
}

/// Zero-normalised cross-correlation of a template placed with its GUI origin at video (`x`, `y`), `s` video px per GUI
/// px. `None` when fewer than 60% of the points fall inside the frame or either side is flat.
#[allow(clippy::too_many_arguments)]
fn score(
    lum: &[f64],
    w: usize,
    h: usize,
    t: &Template,
    x: f64,
    y: f64,
    s: f64,
    step: usize,
) -> Option<f64> {
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
        let b = lum[py as usize * w + px as usize];
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
    if w == 0 || h == 0 || frame.len() != w * h * 3 {
        return Err(format!(
            "frame must be {w}x{h} RGB24 ({} bytes), got {}",
            w * h * 3,
            frame.len()
        ));
    }
    check_options(opts)?;
    let lum: Vec<f64> = frame
        .chunks_exact(3)
        .map(|p| luma(p[0], p[1], p[2]))
        .collect();
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
    .expect("the hotbar is always laid out");
    // the selected-slot highlight always covers part of the hotbar: fit the pair, one variant per slot
    // (canvas 184x24 starting one GUI pixel up-left of the hotbar, InGameHud 473-474)
    let pair = |slot: i32| -> Vec<[u8; 4]> {
        let mut hot = lay(Sheet::Widgets, 0, 0, 182, 22);
        (hot.dx, hot.dy) = (1, 1);
        let mut sel = lay(Sheet::Widgets, 0, 22, 24, 22);
        (sel.dx, sel.dy) = (20 * slot, 0);
        composite(
            tex,
            &place(PieceId::Hotbar, 0, 0, 0, 184, 24, vec![hot, sel]),
        )
    };
    let pairs: Vec<Vec<[u8; 4]>> = (0..9).map(pair).collect();
    let flat_t: Vec<Template> = pairs
        .iter()
        .map(|img| template(img, 184, 24, true, None))
        .collect();
    let all_t: Vec<Template> = pairs
        .iter()
        .map(|img| corners(&template(img, 184, 24, false, None)))
        .collect();
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
    // coarse: 0.5% steps of scale, every 3rd template point
    let mut coarse: Vec<(f64, f64)> = Vec::new();
    let mut s = opts.min_scale;
    while s <= max_scale {
        let (x, y, _) = anchor(s);
        if let Some(v) = best_slot(&flat_t, x, y, s, 3) {
            coarse.push((v, s));
        }
        s *= 1.005;
    }
    coarse.sort_by(|a, b| b.0.total_cmp(&a.0));
    // fine: every opaque hotbar pixel sampled near its corners (edge-sensitive, so the peak is sharp). The footage is
    // uncropped (user-confirmed), so the anchor is exact up to the rounding of the video size: the offset stays 0 unless
    // a shift is clearly better. Plateaus of equal correlation are resolved to their centre.
    const TIE: f64 = 1e-3;
    let mut best: Option<(f64, f64, f64, f64)> = None; // score, s, x, y
    for &(_, s0) in coarse.iter().take(5) {
        let (x0, y0, _) = anchor(s0);
        let Some(slot) = (0..9).max_by(|&a, &b| {
            let sa = score(&lum, w, h, &flat_t[a], x0 - s0, y0 - s0, s0, 1).unwrap_or(-1.0);
            let sb = score(&lum, w, h, &flat_t[b], x0 - s0, y0 - s0, s0, 1).unwrap_or(-1.0);
            sa.total_cmp(&sb)
        }) else {
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
            let tied: Vec<&(f64, f64, f64)> = offs.iter().filter(|o| o.0 >= top - TIE).collect();
            let n = tied.len() as f64;
            (
                tied.iter().map(|o| o.1).sum::<f64>() / n,
                tied.iter().map(|o| o.2).sum::<f64>() / n,
            )
        };
        let s2 = centre_scale(odx, ody, s1 * 0.997, s1 * 1.003, 1.0001).unwrap_or(s1);
        // exact candidates: an uncropped video of a W-wide scaled window has scale exactly videoW / W (and videoH / H),
        // so near-ties are resolved towards a scale where both divide evenly instead of averaging two of them
        let mut exact: Option<(f64, f64, f64)> = None; // score, misfit, s
        let (wf, hf) = (w as f64, h as f64);
        let lo_w = (wf / (s2 * 1.01)).floor().max(1.0) as u32;
        let hi_w = (wf / (s2 * 0.99)).ceil() as u32;
        for sw in lo_w..=hi_w {
            let se = wf / sw as f64;
            let Some(v) = at_s(se, 0.0, 0.0) else {
                continue;
            };
            let misfit = (hf / se - (hf / se).round()).abs();
            if exact.is_none_or(|e| v > e.0 + TIE || (v >= e.0 - TIE && misfit < e.1)) {
                exact = Some((v, misfit, se));
            }
        }
        let cont = at_s(s2, odx, ody).unwrap_or(-1.0);
        let (s2, odx, ody) = match exact {
            Some((v, _, se)) if v >= cont - TIE => (se, 0.0, 0.0),
            _ => (s2, odx, ody),
        };
        let (x, y, _) = anchor(s2);
        // accept on the centre-sampled correlation (robust to resampling), not on the edge-sensitive one
        if let Some(v) = best_slot(&flat_t, x + odx, y + ody, s2, 1) {
            if best.is_none_or(|b| v > b.0) {
                best = Some((v, s2, x + odx, y + ody));
            }
        }
    }
    let Some((hot_score, s, hx, hy)) = best.filter(|b| b.0 >= opts.hotbar_min_score) else {
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
    let fit = GuiFit::for_video(
        s,
        w,
        h,
        hx - (sw / 2 - 91) as f64 * s,
        hy - (sh - 22) as f64 * s,
    );
    mask.fit = Some(fit);
    mask.reliable = true;

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
    let shift = |mut p: Placed, dy: i32| {
        p.y += dy;
        p
    };
    // best of several candidates (each a placed piece variant), offsets in GUI px
    let best_of = |cands: Vec<Placed>, dys: &[i32]| -> Option<(Placed, f64)> {
        let mut top: Option<(Placed, f64)> = None;
        for c in cands {
            let img = composite(tex, &c);
            let t = template(&img, c.w as usize, c.h as usize, false, c.unknown);
            for &dy in dys {
                let p = shift(c.clone(), dy);
                let (x, y) = at(&p);
                if let Some(v) = score(&lum, w, h, &t, x, y, fit.scale, 1) {
                    if top.as_ref().is_none_or(|b| v > b.1) {
                        top = Some((p, v));
                    }
                }
            }
        }
        top.filter(|b| b.1 >= opts.piece_min_score)
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
    if let Some(x) = best_of(xp_cands, &[0]) {
        accepted.push(x);
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
    for q in 1..=4 {
        let r = (10 - (q - 2)).max(3);
        let mut found = Vec::new();
        for row in 0..q {
            for col in 0..10 {
                let idx = (row * 10 + col) as u8;
                if let Some(x) = best_of(
                    heart_variants(m + col * 8, o - row * r, idx),
                    &[-2, -1, 0, 1],
                ) {
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
        for i in 0..10 {
            let cands = [16u32, 25, 34]
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
            if let Some(x) = best_of(cands, &[0]) {
                accepted.push(x);
            }
        }
        let mut food_found = 0;
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
            if let Some(x) = best_of(cands, &[-1, 0, 1]) {
                accepted.push(x);
                food_found += 1;
            }
        }
        if food_found > 0 {
            for ae in 0..10 {
                let x = n - ae * 8 - 9;
                let cands = [16u32, 25]
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
                if let Some(x) = best_of(cands, &[0]) {
                    accepted.push(x);
                }
            }
        }
    }

    // status effect backgrounds: beneficial row y = 1, harmful row y = 27, from the right edge
    let mut effect_idx = 0u8;
    for y in [1, 27] {
        for i in 1..=8 {
            let x = sw - 25 * i;
            let cands = [141u32, 165]
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
            match best_of(cands, &[0]) {
                Some(x) => {
                    accepted.push(x);
                    effect_idx += 1;
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
        });
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
