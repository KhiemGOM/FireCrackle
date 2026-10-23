# How fire renders in Minecraft (what a 3D quad tool must place)

2026-10-23. Sources:
- **Fire blocks:** the game's own model files and `BakedQuadFactory` rules, read in 1.16.5. The fire models and
  blockstate are identical in 1.21.11. Implemented and tested in `fire_core::fire_model`.
- **Entity fire:** from the newer game's renderer (`FireCommandRenderer`). **Not yet checked line by line against
  1.16.5** (`EntityRenderDispatcher.renderFire`, which the label mod hooks). The old labelled recordings logged entity
  fire quads (181 in quad1) to check it against.

## 1. Fire block: block grid, integer coordinates

What it draws depends only on which neighbours can burn (the blockstate's `north/east/south/west/up` flags):

| Case | Planes drawn | Looks like |
|---|---|---|
| Nothing flammable around (fire sitting on a solid block) | 4 crossing floor planes, tilted ±22.5° and rescaled, **plus** 4 side planes | the classic "fire block" |
| One or more flammable side neighbours | one plane per flammable face, 0.01/16 of a block off that face (with a mirrored-UV variant) | fire hugging a wall |
| Flammable block above | 2 hanging planes, plus 2 from the alternate variant | fire licking a ceiling |
| Soul fire | the floor shape only | blue fire block |

**"A block on fire" is not its own thing.** A burning plank is fire blocks in the air cells next to it, each drawing a
plane hugging the plank's face. So to place a burning block you place fire blocks in its neighbouring cells with side
or up attachments, all on whole-block coordinates.

**Known ambiguity:** a side fire, and the neighbour's opposite-side fire, draw the same plane (0.0012 blocks apart).
From a picture they are the same.

Not modelled yet: fire with two or more flammable neighbours at once (several side planes together). The locator
doesn't offer those combinations.

## 2. Entity on fire: continuous position

- **Shape:** a stack of quads at the entity's position, turned to face the camera, but only around the vertical axis.
- **Size:**
  - width = hitbox width × 1.4;
  - each layer is 1.4 tall, steps up 0.45, gets 0.9× as wide and shifts slightly back;
  - layers repeat until the stack covers the hitbox height.
- **Which entity matters only through its hitbox (width × height):**
  - player 0.6 × 1.8
  - zombie 0.6 × 1.95
  - skeleton 0.6 × 1.99
  - blaze 0.6 × 1.8
  - babies smaller
  - big mobs (ravager, ghast) much bigger
- **Input for placing it:** feet position (decimals, not the grid) plus a hitbox preset.
- **Blaze:** its fire quads appear only while it is set on fire (when it charges an attack), not all the time.
- **Status:** not in `fire_model` yet.

## 3. You on fire: the screen overlay

When the player burns, the first-person fire overlay is drawn in screen space: two quads at fixed positions, not
placed in the world. The detector already models it (`overlay.rs`; the label mod logs it as `OverlayQuads`). Nothing
to place in 3D.

## What the 3D quad tool needs

- **Fire block** at an integer coordinate, with an attachment: floor / N / E / S / W / up.
- **Burning block:** shorthand for the fire blocks around one block's flammable faces.
- **Entity fire:** a continuous position plus a hitbox preset, or a typed width × height.

All drawn through the solved camera (`camera::solve_guided`) over the video.
