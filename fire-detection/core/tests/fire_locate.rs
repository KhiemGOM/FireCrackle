//! Locating a fire block from a known camera and the fire's box on screen (the step after perspective reversal).
//! The box covers visible fire texels, so its top is unreliable (flame tips are transparent and animate): only the
//! left, right and bottom edges are compared, after clamping the candidate to the screen like the box is. Ways this
//! breaks: a floor fire also draws its four side planes (blockstate), so it must be scored with them; depth comes only
//! from the box width, so noise can slide it one block along the ray; a box off screen or of zero size has no answer.
use fire_core::camera::Camera;
use fire_core::fire_locate::{locate, predicted_box};
use fire_core::fire_model::Attach;

const W: usize = 2560;
const H: usize = 1440;

fn cam() -> Camera {
    Camera {
        pos: [-88.37, 81.62, 122.4],
        yaw: 18.5,
        pitch: 21.0,
        roll: 0.3,
        fov: 110.0,
    }
}

/// The box the label mod would log for a fully visible fire: its outline with the top cut down (transparent tips).
fn observed(pos: [i32; 3], attach: Attach) -> [f64; 4] {
    let b = predicted_box(&cam(), pos, attach, W, H).expect("on screen");
    [b[0], b[1] + 0.3 * (b[3] - b[1]), b[2], b[3]]
}

#[test]
fn a_floor_fire_is_found_at_its_block() {
    let pos = [-90, 79, 128];
    let found = locate(&cam(), observed(pos, Attach::Floor), W, H);
    assert_eq!(
        (found[0].pos, found[0].attach),
        (pos, Attach::Floor),
        "{:?}",
        &found[..3.min(found.len())]
    );
    assert!(found[0].error < 1e-6);
}

#[test]
fn a_side_fire_is_found_with_its_side() {
    let pos = [-91, 80, 127];
    let found = locate(&cam(), observed(pos, Attach::West), W, H);
    assert_eq!(
        (found[0].pos, found[0].attach),
        (pos, Attach::West),
        "{:?}",
        &found[..3.min(found.len())]
    );
}

#[test]
fn a_two_pixel_wobble_still_gives_the_block() {
    let pos = [-86, 79, 131];
    let b = observed(pos, Attach::Floor);
    let found = locate(
        &cam(),
        [b[0] + 2.0, b[1] - 1.0, b[2] - 2.0, b[3] + 1.5],
        W,
        H,
    );
    assert_eq!(found[0].pos, pos, "{:?}", &found[..3.min(found.len())]);
}

#[test]
fn candidates_are_ranked_and_nonsense_boxes_give_nothing() {
    let found = locate(&cam(), observed([-90, 79, 128], Attach::Floor), W, H);
    assert!(found.len() > 1);
    assert!(found.windows(2).all(|p| p[0].error <= p[1].error));
    assert!(
        locate(&cam(), [10.0, 10.0, 10.0, 10.0], W, H).is_empty(),
        "zero-size box"
    );
    assert!(
        locate(&cam(), [-500.0, 10.0, -400.0, 50.0], W, H).is_empty(),
        "off screen"
    );
}
