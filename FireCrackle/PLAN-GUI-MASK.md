# Unified per-piece GUI mask (plan)

**Status: phase 1 built (2026-10-17)** in `fire-detection/core/src/gui_mask.rs` (no dependencies), textures in
`fire-detection/data/assets/gui/` (`widgets`, `icons`, `inventory`, `bars` from the 1.16.5 client jar, `.png` + `.rgba`),
35 tests in `core/tests/gui_mask.rs` (red first: module missing), viewer `core/examples/gui_mask_frame.rs`.
Synthetic: scale recovered at GUI scales 1–6 × resize 0.5–1.5 (incl. a 767-px-high window), every piece found and
told apart, no GUI on world pixels, nothing labelled below scale 1 or with F1. Real 1080p recordings (1440p window):
scales 4.5, 3.75 and 1.5 found exactly (GUI scale 6, 5, 2); hotbar, selected slot, items (unknown), offhand,
hearts, food, XP bar and effect icon on target; creative frames correctly without status bars; ~70–90 ms per frame.
Deviations, stated openly: (1) after the red run, two tests were changed: per-piece IoU now ignores the pixels the
mask calls `unknown` (the edge ring this plan prescribes in 3.1; a 9×9 icon at 2.67 px/GUI px cannot reach IoU 0.85
with it), with a new test that every `unknown` pixel lies within 2 px of real GUI, and the opaque/translucent test
checks the committed pixels (≥ 99 % right, ≥ 80 % committed); (2) one new setting `edge_tolerance_px` (0.05);
(3) the fit prefers exact `videoW / W` scales (uncropped footage, user-confirmed), found necessary on real frames.
Not done: app dialog + overlay (1b), phase 2 (text, chat, XP number, boss bars, mount), phase 3 (screens); frames
under a veil need the canonical unveil first. Evidence is from the Yarn 1.16.5+build.10 sources
(`minecraft-merged-…-1.16.5+build.10-v2-sources.jar` in `fire-detection/mod/.gradle/loom-cache`); file:line refers to
that jar. Every number below is read from the code, not assumed. Where something cannot be known from the picture or the
code, it is marked *unknown* and becomes either a user question or the `unknown` class.

## 0. Goal and contract

One shared module that says, for every pixel of a frame, **which GUI piece (if any) is drawn there**, how sure it is,
and whether the world behind is still visible. It is **metadata only**: no pixel is blacked out, no frame is dropped.
Agreed with the detector agents (POV Fire Marshal, Sheet Happens, inbox 455/456):

- per-pixel piece id + class `opaque | translucent | unknown | none` + confidence;
- per-frame: GUI scale (video px per GUI px), scaled window size, anchor, `menu: none | veiled_screen |
  opaque_background | panel(type)`, `reliable` flag with reasons;
- runs **after** the canonical unveil (`fire-detection/core/src/veil.rs`, owned by Sheet Happens); separate module;
- coloured HUD pixels are GUI or unknown, **never fire**; an open menu is **not** proof of "no fire" (clip1 frames
  630–1080 show fire behind the inventory after unveil).

### 0.1 Precondition: the user confirms vanilla (user decision)

Nothing runs until the user answers, per video project: *"Is this footage vanilla Minecraft 1.16.5 GUI: no resource
pack, no HUD mods, not cropped?"* **Yes / No / Not sure**, plus optional GUI scale (1–6 or Auto) and main hand
(right/left; decides the offhand slot side). Anything but *Yes* → the tool does not run and says why. Saved in the
project. Even after *Yes*, a frame whose pixels do not match the vanilla textures stays unmasked and is reported
(second safeguard, never a guess).

## 1. Evidence: where vanilla draws things

### 1.1 Scale and scaled window (`Window.java`)

- `calculateScaleFactor(guiScale, unicode)` (371–388): start at 1, increase while `i != guiScale`, `fbW/(i+1) >= 320`
  and `fbH/(i+1) >= 240` (and `i < fbW, fbH`); with forced-Unicode font an odd scale is bumped by 1. So **guiScale 0
  (Auto) = the largest scale keeping the scaled window at least 320×240**; a set scale is capped by the same rule.
- `setScaleFactor` (391–397): `scaledW = ceil(fbW / scale)`, `scaledH = ceil(fbH / scale)`. Consequence: when `fbH` is
  not a multiple of the scale, the bottom HUD row (at `scaledH - …`) is shifted by up to (scale − 1) framebuffer pixels
  **below** the bottom edge. Geometry must use the ceil, not `fbH / scale`.
- Called from `MinecraftClient.onResolutionChanged` (1150–1152) with `options.guiScale`.

Video mapping (assumption made explicit by the precondition): the video is the framebuffer scaled uniformly by `k`
(`k = videoW / fbW`), uncropped. One video pixel per GUI pixel factor `s = scale · k`.

### 1.2 Draw order (`GameRenderer.java` 503–525)

World (incl. hand and the first-person fire overlay) → `inGameHud.render` (only if `!hudHidden || currentScreen != null`)
→ overlay or `currentScreen.render`. So **a screen's background veil also covers the HUD**: under a veil, the HUD pixels
are veiled too (unveil first, then match HUD textures).

### 1.3 HUD pieces (`InGameHud.java`, GUI pixels, `W = scaledW`, `H = scaledH`)

| Piece | Where (top-left, size) | Shown when | Lines |
|---|---|---|---|
| Hotbar frame (`widgets.png` 0,0) | `(W/2−91, H−22)`, 182×22 | not spectator, not F1 | 164–168, 473 |
| Selected slot (`widgets.png` 0,22) | `(W/2−92 + 20·slot, H−23)`, 24×22 | same | 474 |
| Offhand slot | left hand: `(W/2−120, H−23)` 29×24 (`widgets` 24,22); right: `(W/2+91, H−23)` 29×24 (53,22) | offhand not empty; side = opposite of main arm | 466–481 |
| Hotbar items | slot m: `(W/2−88+20m, H−19)`, 16×16 (+count text, durability bar) | item in slot | 488–501, 1016 |
| Attack indicator (hotbar mode) | `(W/2+97, H−20)` or `(W/2−113, H−20)` 18×18 | option HOTBAR and cooldown < 1 | 503–518 |
| Crosshair (`icons.png` 0,0) | `((W−15)/2, (H−15)/2)`, 15×15, **inverting blend** | first person, not spectator (unless target) | 348–388 |
| Crosshair attack indicator | `(W/2−8, H/2+9)` 16×4 or 16×16 | option CROSSHAIR | 367–383 |
| F3 crosshair (3D axes) | screen centre, size 10 | F3 on | 352–360 |
| Armor row | `x = W/2−91 + 8i`, `y = s` (above hearts), 9×9 ×10 | armor > 0 | 741–764 |
| Hearts | `x = W/2−91 + 8·(i%10)`, `y = H−39 − row·r`, 9×9; rows = ceil((maxHP+absorb)/20), r = max(10−(rows−2), 3); low HP ±1 px jitter; regen −2 px bounce | status bars (survival/adventure) | 731–825 |
| Food | `x = W/2+91 − 8i − 9`, `y = H−39` (±1 jitter when saturation 0) | status bars and not riding a mount with hearts | 827–857 |
| Air bubbles | right side, one row above food (or above mount hearts) | underwater or air < max | 859–875 |
| Mount health | right side from `y = H−39` upward, rows of 10 | riding a living mount | 881–915 |
| XP bar (`icons.png` 0,64) | `(W/2−91, H−29)`, 182×5 | has XP bar, not on a jumping mount | 188–193, 540–553 |
| Mount jump bar (`icons.png` 0,84) | `(W/2−91, H−29)`, 182×5 | jumping mount | 525–538 |
| XP level number | centred, `y = H−35`, green (8453920) with 4 black offsets | level > 0 | 555–566 |
| Held-item name | centred, `y = H−59` (H−45 without status bars), text + text background | after switching item, fades | 569–601 |
| Action bar (overlay message) | centred at `y = H−68` | message active | 229–257 |
| Title / subtitle | centred on screen, ×4 / ×2 text | title active | 259–299 |
| Status effect icons (`inventory.png` 141,166 / 165,166) | `x = W − 25·n`, `y = 1` (beneficial) or `27` (harmful), 24×24 (+15 in demo) | effects with icons; **drawn even with F1 when a screen is open** | 224, 404–459 |
| Boss bars | `(W/2−91, 12 + 19·n)` 182×5 + name text above | boss bar active | `BossBarHud` 29–60 |
| Chat | origin `(0, H−48)`, then +(2,8), scaled by chatScale; width `floor(chatWidth·280+40)`, lines upward, text background fill; lines older than 200 ticks hidden unless chat open | chat lines | 317–325; `ChatHud` 40–75, 273–297 |
| Scoreboard sidebar | right edge, vertically centred | objective in sidebar slot | 312–315, 617+ |
| Player list (Tab) | top centre | Tab held (multiplayer) | 326–333 |
| Subtitles | bottom right, `W−2`, `H−30` upward | subtitles option | `SubtitlesHud` 76–88 |
| F3 debug text | left and right columns, grey backgrounds 0x90505050 | F3 | `DebugHud` 134–153 |
| Vignette | full screen, multiplies colour (darkens edges) | fancy graphics | 147–148, 945–982 |
| Pumpkin / portal / sleep | full screen | pumpkin head / portal nausea / sleeping | 154–162, 202–218 |

### 1.4 Screens

- `Screen.renderBackground` (364–370): in a world → `fillGradient(0xC0101010 → 0xD0101010)` = **the veil** (world still
  visible, reversible); no world → `renderBackgroundTexture` = **opaque dirt background**: no world behind, the only case
  where "no fire" is certain.
- `HandledScreen` (29–30, 81–82): panel `backgroundWidth × backgroundHeight` (176×166 default, others set their own)
  centred: `x = (W−bw)/2, y = (H−bh)/2`. Opaque panel over the veil.
- Tooltips: `Screen` 182–190 (dark translucent 0xF0100010 box with purple border).

## 2. Design

1. **Scale fit.** Find `s` (video px per GUI px) and confirm vanilla by matching the hotbar frame texture: its position
   is fixed by `s` (`x = videoW/2 − 91s`, bottom row from `ceil(fbH/scale)`), so the search is one-dimensional over `s`,
   with the user's GUI scale as a hint. Ambiguity between `scale` and `k` only matters for the ceil rounding (≤ one GUI
   pixel): that band is labelled `unknown`, never guessed. No hotbar (F1, spectator, cut off) → try the crosshair and
   XP bar; nothing matches → `reliable = false`, no mask.
2. **Static pieces** from §1.3 geometry, each confirmed per frame by texture match at that place (presence of armor,
   hearts rows, air, offhand side, selected slot index are read from the pixels, not assumed).
3. **Per-pixel class from the texture alpha**: alpha 255 → `opaque`; 0 < alpha < 255 → `translucent` (blended with a
   known colour and alpha, so invertible like the veil); alpha 0 → `none`. The crosshair uses an inverting blend
   (`1 − dst`), also invertible.
4. **Unpredictable content** (items, counts, text, titles, chat, scoreboard, F3): `unknown` boxes from the geometry
   (slots, chat rectangle, text bands), refined by the known text-background colours where they apply.
5. **Screens**: veil (canonical `veil.rs`) → `veiled_screen` (world visible after unveil); opaque dirt texture →
   `opaque_background` (certain no world); centred panel with HandledScreen geometry and texture → `panel(type)`.

Code location: a new module next to the canonical unveil in `fire-detection/core` (`gui_mask.rs`, separate from
`veil.rs`), exposed to the app the same way as unveil (to be agreed with Sheet Happens). Textures (`widgets.png`,
`icons.png`, `inventory.png`) taken from the 1.16.5 client jar, as the fire sprites are. Every threshold (texture match
tolerance, confidence cut-offs, the rounding band) is a documented setting.

## 3. Phases

1. **Neutral HUD**: scale fit; hotbar, selected slot, offhand, crosshair, XP bar, hearts / armor / food / air / mount
   rows, effect icons, boss bars. Output contract + app overlay to view the mask.
2. **Text and chat**: chat, held-item name, action bar, titles, XP number, item counts, scoreboard, subtitles, F3.
3. **Screens**: veiled screen / opaque background / container panels; `menu` flag (no auto "no fire" except the
   opaque background).

### 3.1 Phase 1 in detail

- **Scope**: scale fit; hotbar frame, selected slot, offhand (both sides), the 9 item boxes (`unknown`), crosshair
  (`unknown`: its inverting blend makes it the inverted world, see 362–366), XP bar (background with any fill length),
  hearts (container + full/half/none, normal/poison/wither/absorption, hardcore), armor, food (incl. hunger effect),
  air, status-effect backgrounds (inner 18×18 sprite `unknown`). Boss bars and mount health move to phase 2.
- **Texture facts** (alpha read from the 1.16.5 `widgets.png`/`icons.png`/`inventory.png`): hotbar 1700 opaque + 2304
  translucent (alpha 186) pixels, so the slots are see-through; selected slot 230 opaque + 42 at alpha 174 + 256
  transparent; hearts, food, armor, air, XP bar, effect backgrounds are fully opaque where drawn; crosshair 17 opaque.
- **Scale fit**: one parameter `s` (video px per GUI px), searched over `[min_scale, videoW/182]`; anchor from §1.1 (hotbar
  centred, bottom at `ceil(fbH/scale)`), the ≤ 1 GUI px rounding searched as a small offset. Score = luma ZNCC over the
  hotbar's flat opaque pixels sampled at GUI-pixel centres (gain/offset invariant: vignette, veil, exposure).
- **Pieces**: each candidate place/variant scored the same way on its opaque pixels; present when the best variant
  reaches the threshold. Hearts/armor/food/air row positions follow §1.3 from the detected heart-row count.
- **Pixel classes**: a video pixel gets a piece when its area touches that piece's drawn GUI pixels; its class is the
  texture alpha class if every GUI pixel it touches has the same class, else `unknown` (so edges and the rounding band
  are `unknown`, never guessed).
- **Settings** (documented, with defaults): `min_scale` 1.0 (below this a GUI pixel is under one video pixel and the
  texture cannot be checked: the frame is reported unreliable), `hotbar_min_score` 0.8, `piece_min_score` 0.8.
- **Out of scope for phase 1**: the app dialog and overlay (phase 1b, after the core is proven).

## 4. Ways this can break (tests cover each)

- Scale: every GUI scale 1–6 × video resize factors (0.5, 2/3, 1, 1.5) × odd framebuffer heights (ceil rounding puts
  the hotbar partly below the edge); Unicode-font odd-scale bump; tiny windows (scale 1).
- A world that looks like the GUI (grey stone at the bottom centre, a texture pack-like scene) must not fit a hotbar;
  a dark scene; a frame that is all veil.
- Pieces present/absent: no armor, 1–4 heart rows (absorption, health boost), low-HP jitter, regen bounce, hardcore
  hearts, poison/wither colours, hunger effect, mount instead of food, underwater air, offhand both sides, every
  selected slot, attack indicator both modes, F1, spectator, F3, creative (no status bars).
- Under a veil: HUD veiled then unveiled (rounding of the unveil); under an opaque panel.
- Vignette and pumpkin/portal overlays darken or tint everything: texture matching must tolerate a gain.
- Video compression (JPEG/H.264 4:2:0 chroma) blurs 1-px GUI edges: confirm on luma with tolerance; edges → `unknown`.
- A resource pack or modded HUD despite "Yes": mismatch → unmasked + reported, never a forced fit.
- Output: mask size equals frame size, ids stable, `unknown` never reported as `none`.

## 5. Verification

- Synthetic: a reference compositor draws the vanilla textures with the §1 geometry over real frames (truth known per
  pixel), at every scale/resize, with and without veil → per-piece IoU, false GUI on world pixels.
- Real: the training recordings (no per-piece truth today; the mod's `GuiMask` is aggregate coverage only, "not certified
  per-piece truth" per POV Fire Marshal) → visual review in the app and agreement with the aggregate coverage. A mod
  export of per-piece GUI truth would be the proper oracle; proposed as a follow-up for the mod owner.
- Tests first, red before green, as always.
