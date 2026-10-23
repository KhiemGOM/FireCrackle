# How fire renders in Minecraft (what a 3D quad tool must place)

2026-10-23. Sources:
- **Fire blocks:** the game's own model files and `BakedQuadFactory` rules, read in 1.16.5. The fire models and
  blockstate are identical in 1.21.11. Implemented and tested in `fire_core::fire_model`.
- **Entity fire:** 1.16.5 `EntityRenderDispatcher.renderFire`, read from the game source, implemented in
  `fire_core::fire_model::entity_quads` and checked against the label log (section 2).

## 1. Fire block: block grid, integer coordinates

What it draws depends only on which neighbours can burn (the blockstate's `north/east/south/west/up` flags):

| Case | Planes drawn | Looks like |
|---|---|---|
| Nothing flammable around (fire sitting on a solid block) | 4 crossing floor planes, tilted ±22.5° and rescaled, **plus** 4 side planes | the classic "fire block" |
| One or more flammable side neighbours | one plane per flammable face, 0.01/16 of a block off that face (with a mirrored-UV variant) | fire hugging a wall |
| Flammable block above | 2 hanging planes, plus 2 from the alternate variant | fire licking a ceiling |
| Soul fire | the floor shape only | blue fire block |

In the tool these are six choices: floor, or any of the five faces (north, east, south, west, up). Picking floor
turns the others off. The default face is the one pointing away from the camera: the fire cell is in front of the
burning block, and its plane lies on that block's face.

**"A block on fire" is not its own thing.** A burning plank is fire blocks in the air cells next to it, each drawing a
plane hugging the plank's face. So to place a burning block you place fire blocks in its neighbouring cells with side
or up attachments, all on whole-block coordinates.

**Known ambiguity:** a side fire, and the neighbour's opposite-side fire, draw the same plane (0.0012 blocks apart).
From a picture they are the same.

Not modelled yet: fire with two or more flammable neighbours at once (several side planes together). The locator
doesn't offer those combinations.

## 2. Entity on fire: continuous position (verified)

`fire_model::entity_quads(feet, width, height, camera_yaw)` is the 1.16.5 `EntityRenderDispatcher.renderFire`, read
from the game source. With f = width × 1.4, the stack:
- is scaled by f and turned to face the camera about the vertical axis (−camera yaw);
- starts (−0.3 + ⌊height / f⌋ · 0.02) towards the camera;
- has layers 1.4 tall, each 0.45 higher, 0.9× as wide and 0.03 further from the camera (all in units of f), while
  the remaining height (starting at height / f) stays above 0;
- alternates sprites fire_0 / fire_1, mirrored on layers 0, 1, 4, 5, ….

**Checked against the label log** (`cargo run --release --bin fire_entity <joined.jsonl>`: camera from the frame's
fire blocks, the entity's feet fitted to its logged quads). Every type reproduces the logged corners to their
rounding:

| Recording | Fires checked | Types | Corner error p50 |
|---|---|---|---|
| quad1 | 119 | blaze, small fireball | 0.035–0.037 px |
| survival1 | 4,353 | blaze, small fireball, fireball, player, cow, item, piglin, potion | 0.033–0.045 px (one potion 0.23) |

**Which entity:** only its hitbox matters. `fire_model::entity_size` has every 1.16.5 type (`EntityType` source).
- player 0.6 × 1.8
- zombie 0.6 × 1.95
- blaze 0.6 × 1.8
- small fireball 0.3125
- ghast fireball 1.0
- cow 0.9 × 1.4
- ghast 4 × 4

**Runtime sizes are the caller's:** babies are half size, slimes and magma cubes × 0.255 × size, a sneaking player is
1.5 tall, and a swimming or gliding one 0.6.

**Not only mobs:** blaze and ghast fireballs, thrown items, pearls and potions burn too. In these recordings small
fireballs (6,955 entries) are the second commonest entity fire, after blazes (17,231).

**Input for placing one:** feet position (decimals) plus a type (or width × height) and the camera yaw.

## 3. You on fire: the screen overlay

When the player burns, the first-person fire overlay is drawn in screen space: two quads at fixed positions, not
placed in the world. The detector already models it (`overlay.rs`; the label mod logs it as `OverlayQuads`). Nothing
to place in 3D.

## What the 3D quad tool needs

- **Fire block** at an integer coordinate, with an attachment: floor / N / E / S / W / up.
- **Burning block:** shorthand for the fire blocks around one block's flammable faces.
- **Entity fire:** a continuous position plus a hitbox preset, or a typed width × height.

All drawn through the solved camera (`camera::solve_guided`) over the video.
