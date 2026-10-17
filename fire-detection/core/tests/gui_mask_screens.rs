use fire_core::gui_mask::*;
use std::path::Path;

fn textures() -> GuiTextures {
    GuiTextures::load(&Path::new(env!("CARGO_MANIFEST_DIR")).join("../data/assets/gui")).unwrap()
}
fn setup(scale: u32) -> (Vec<u8>, GuiMask, GuiFit, usize, usize) {
    let (w, h) = (640, 480);
    let fit = GuiFit::framebuffer(w as u32, h as u32, scale, 1.);
    (
        vec![31; w * h * 3],
        GuiMask {
            width: w,
            height: h,
            piece: vec![0; w * h],
            class: vec![0; w * h],
            fit: Some(fit),
            reliable: true,
            hits: vec![],
            notes: vec![],
        },
        fit,
        w,
        h,
    )
}
fn draw(
    frame: &mut [u8],
    w: usize,
    h: usize,
    fit: GuiFit,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    mut pixel: impl FnMut(i32, i32) -> [u8; 4],
) {
    for py in 0..h {
        for px in 0..w {
            let u = ((px as f64 + 0.5 - fit.origin_x) / fit.scale).floor() as i32 - x;
            let v = ((py as f64 + 0.5 - fit.origin_y) / fit.scale).floor() as i32 - y;
            if u < 0 || v < 0 || u >= width || v >= height {
                continue;
            }
            let c = pixel(u, v);
            let p = (py * w + px) * 3;
            if c[3] == 255 {
                frame[p..p + 3].copy_from_slice(&c[..3]);
            }
        }
    }
}
fn texel(tex: &Texture, u: i32, v: i32) -> [u8; 4] {
    let p = (v as usize * tex.width + u as usize) * 4;
    tex.rgba[p..p + 4].try_into().unwrap()
}

#[test]
fn inventory_body_is_neutral_with_dynamic_content() {
    let tex = textures();
    for scale in [1, 2] {
        let (mut frame, mut mask, fit, w, h) = setup(scale);
        let x = (fit.scaled_width as i32 - 176) / 2;
        let y = (fit.scaled_height as i32 - 166) / 2;
        draw(&mut frame, w, h, fit, x, y, 176, 166, |u, v| {
            texel(&tex.inventory, u, v)
        });
        // Arbitrary preview and slot contents do not enter border confirmation.
        draw(&mut frame, w, h, fit, x + 27, y + 10, 48, 65, |_, _| {
            [250, 70, 4, 255]
        });
        add_screen_masks(&frame, w, h, &tex, &mut mask).unwrap();
        assert!(mask.hits.iter().any(|p| p.piece == PieceId::InventoryPanel));
        let p = ((y + 40) as f64 * fit.scale) as usize * w + ((x + 40) as f64 * fit.scale) as usize;
        assert_eq!(mask.piece[p], PieceId::InventoryPanel as u8);
        assert_eq!(mask.class[p], PixelClass::Unknown as u8);
    }
}

#[test]
fn recipe_shifted_inventory_is_confirmed() {
    let tex = textures();
    let (mut frame, mut mask, fit, w, h) = setup(1);
    let x = (fit.scaled_width as i32 - 176) / 2 + 77;
    let y = (fit.scaled_height as i32 - 166) / 2;
    draw(&mut frame, w, h, fit, x, y, 176, 166, |u, v| {
        texel(&tex.inventory, u, v)
    });
    add_screen_masks(&frame, w, h, &tex, &mut mask).unwrap();
    assert!(mask.hits.iter().any(|p| p.piece == PieceId::InventoryPanel));
}

fn button(
    frame: &mut [u8],
    w: usize,
    h: usize,
    fit: GuiFit,
    tex: &GuiTextures,
    x: i32,
    y: i32,
    width: i32,
) {
    draw(frame, w, h, fit, x, y, width, 20, |u, v| {
        let tx = if u < width / 2 { u } else { 200 - width + u };
        texel(&tex.widgets, tx, 66 + v)
    });
}

#[test]
fn button_cluster_required_and_label_neutral() {
    let tex = textures();
    let (mut frame, mut mask, fit, w, h) = setup(1);
    let x = fit.scaled_width as i32 / 2 - 102;
    let y = fit.scaled_height as i32 / 4 + 8;
    button(&mut frame, w, h, fit, &tex, x, y, 204);
    add_screen_masks(&frame, w, h, &tex, &mut mask).unwrap();
    assert!(!mask.hits.iter().any(|p| p.piece == PieceId::MenuButton));
    button(&mut frame, w, h, fit, &tex, x, y + 24, 98);
    button(&mut frame, w, h, fit, &tex, x + 106, y + 24, 98);
    draw(&mut frame, w, h, fit, x + 10, y + 6, 180, 8, |_, _| {
        [230, 210, 250, 255]
    });
    add_screen_masks(&frame, w, h, &tex, &mut mask).unwrap();
    assert_eq!(
        mask.hits
            .iter()
            .filter(|p| p.piece == PieceId::MenuButton)
            .count(),
        3,
        "{:?}",
        mask.hits
    );
}

#[test]
fn no_confirmed_texture_or_scale_means_no_screen_mask() {
    let tex = textures();
    let (frame, mut mask, _, w, h) = setup(1);
    add_screen_masks(&frame, w, h, &tex, &mut mask).unwrap();
    assert!(mask.hits.is_empty());
    mask.reliable = false;
    add_screen_masks(&frame, w, h, &tex, &mut mask).unwrap();
    assert!(mask.hits.is_empty());
    assert!(add_screen_masks(&frame[..frame.len() - 1], w, h, &tex, &mut mask).is_err());
}
