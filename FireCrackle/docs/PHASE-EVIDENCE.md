# Fire phase: evidence from Minecraft 1.16.5 (Yarn 1.16.5+build.10)

These notes summarize observations made against a local Minecraft 1.16.5 development environment,
using Yarn 1.16.5+build.10 names and the vanilla assets. Class/method names and historical line numbers
identify the reviewed version; the game source and mapping artifacts themselves are not included.
The descriptions below are original explanations, not copied game implementation. Items not verified
are listed at the bottom.

## E1. What advances the animation: one step per `tickAnimation()` call

`Sprite.java:244-262`
The sprite accumulates elapsed frame ticks. Once its configured duration is reached, it advances one
position in the animation sequence, wraps at the sequence length, resets the elapsed counter, and
uploads the new image if that image differs from the previous one.
- `frameIndex` (`Sprite.java:36`, starts 0) is the **position in the animation sequence**, not the sheet row.
- Row actually uploaded and drawn = `animationMetadata.getFrameIndex(frameIndex)` (`AnimationResourceMetadata.java`,
  `getFrameIndex`: `frames.get(frameIndex).getIndex()`), uploaded by `upload(k)` into the atlas slot.
- Frame time: `AnimationResourceMetadataReader.fromJson`: `JsonHelper.getInt(json, "frametime", 1)`;
  per frame `usesDefaultFrameTime()` when `time == -1` (`AnimationFrameResourceMetadata.java`).
  Neither fire mcmeta sets `frametime` or per-frame `time` (E2) => frame time 1 => `frameTicks(1) >= 1` is
  always true => **the step advances on every call**.
- `interpolate` is false (not in either mcmeta; reader default `false`), so no blended frames.

## E2. Which row is shown for step `s` (the two sheets differ)

Vanilla assets, `assets/minecraft/textures/block/`:
- `fire_0.png.mcmeta`: `{"animation":{"frames":[16,17,...,31,0,1,...,15]}}` (32 entries, rotated by 16).
- `fire_1.png.mcmeta`: `{"animation":{}}` -> no frames list.
- Both PNGs are 16 x 512 = 32 frames of 16 x 16.

`Sprite` constructor (`Sprite.java:50-92`): with a frames list, `frameXs/Ys` are built from that list and
`getFrameCount()` is its size (32). Without one (`fire_1`), it builds the identity list over `k*l` = 1 x 32
frames (`Sprite.java:73-92`) and replaces the metadata with it (count 32).

So, with `s` = `frameIndex` (the animation step) and modulus 32:

    sheet 1 displayed row:  row1 = s
    sheet 0 displayed row:  row0 = (s + 16) mod 32        (frames[s])

=> for any frame showing both sheets: `row0 - row1 == 16 (mod 32)`.
=> the canonical step from a label: `s = row` (sheet 1), `s = (row - 16) mod 32` (sheet 0).

## E3. When `tickAnimation()` runs: once per client tick, only while a world exists

`MinecraftClient.tick()` (`MinecraftClient.java:1480-1482`):
The client updates animated textures during a client tick when a world exists.
This is **not** inside `if (!this.paused)`. => pausing in singleplayer does NOT stop the animation; being
in no world (title screen, loading, disconnected) does.

Chain: `TextureManager.tick` (`:142-146`, iterates `tickListeners`) -> `SpriteAtlasTexture.tick`
(`:270-275`) -> `tickAnimatedSprites` (`:261-266`) -> `Sprite.tickAnimation` for each sprite in
`animatedSprites`. A sprite is in that list iff `sprite.isAnimated()` = `getFrameCount() > 1`
(`SpriteAtlasTexture.java:77-79`, `Sprite.java:264`). Fire sprites live in the **block atlas**:
`ModelLoader.java:72-73` (`FIRE_0`, `FIRE_1` = `block/fire_0`, `block/fire_1`).

Thread: `Main.java:149-150` makes the main thread the render thread; `MinecraftClient.shouldRenderAsync()`
returns `false` (`MinecraftClient.java:2586-2588`) so `minecraftClient.run()` runs on that same thread
(`Main.java:185-186`). `SpriteAtlasTexture.tick` therefore takes the direct branch
(`RenderSystem.isOnRenderThread()` true) and steps immediately, no deferral via `recordRenderCall`.

## E4. Ticks per rendered frame, and what a frame shows

`MinecraftClient.render(boolean tick)` (`:997-1046`) and `RenderTickCounter.beginRenderTick`:
Before rendering a frame, the client computes the number of elapsed whole ticks and executes at most
ten of them. It renders the scene after this update loop. Additional whole ticks beyond the cap are
not executed.
- Ticks run **before** the world is drawn in the same `render()`, so a frame shows the row produced by the
  last tick that ran at or before it.
- Between two consecutive **game** renders on this vanilla path the step advances by **0..10**: 0 when `i == 0` (typical above
  20 fps, ~3 frames per tick at 60 fps), more after a lag spike. `i` above 10 is clamped, the extra ticks
  are **dropped** (the fractional remainder is kept, `RenderTickCounter.java`): such a drop does not
  advance the sprite either, so a counter of *executed* client ticks stays consistent with the sprite.
- This bound does **not** apply between recorded video samples. OBS can repeat an older captured picture
  while many game renders run, then capture a newer picture. See E9 for the measured 47-tick jump over
  206 game renders. A visible recording freeze does not prove that the game render thread froze.
- `render(false)` callers (`:1854, :2002, :2026, :2033`: loading / screen switches) run no ticks.
- Tick rate is fixed at 20 (`new RenderTickCounter(20.0F, 0L)`, `MinecraftClient.java:302`).

## E5. Resets (these are legitimate phase jumps, not labelling errors)

- **Resource reload / atlas rebuild**: `SpriteAtlasTexture.upload(Data)` calls `clear()`
  (`SpriteAtlasTexture.java:283-290`, clears `sprites` and `animatedSprites`) and re-adds **new** `Sprite`
  objects whose `frameIndex` starts at 0 -> both sheets restart at `s = 0`
  (`row1 = 0`, `row0 = 16`). Triggers: F3+T, resource pack change, video-settings reloads.
- **Out-of-world ticks**: ticks with `world == null` advance a "client ticks since launch" counter but not
  `s`; the constant `(tick - s) mod 32` therefore shifts by the number of out-of-world ticks.
  Pause does not shift it (E3).

Hence, within one continuous in-world span with no reload:
`s(t) = (t - t0) mod 32` => `phase_s = (tick - s) mod 32` is constant, with `s` from E2
(per sheet: `tick - row1`, or `tick - row0 + 16`, ie. the two raw phases differ by 16 as the notes measured).
(This tick form applies to mod recordings that carry a strip, ie training data. FireCrackle's footage has no
strip: see E7, which replaces `tick` by `20 * video time`.)

## E6. Which sheet / mirror a fire shows (not time dependent)

Block fire (`blockstates/fire.json`, multipart): the side / up parts list 4 variants each
(`fire_*0`, `fire_*1`, `fire_*_alt0`, `fire_*_alt1`), the floor part lists 2 (`fire_floor0/1`, no alt).
`*_alt` templates use UV `[16,0,0,16]` vs `[0,0,16,16]` (`template_fire_side_alt.json` vs
`template_fire_side.json`) = horizontal mirror, nothing else. Selection:
`MultipartBakedModel.getQuads` takes `long l = random.nextLong()` once and passes `new Random(l)` to every
matching part; `WeightedBakedModel.getQuads` picks `Math.abs((int)random.nextLong()) % totalWeight`.
The `random` is seeded per block from `state.getRenderingSeed(pos)` (`BlockRenderManager.java:49`,
`BlockModelRenderer.java:86/120`) => the variant is a **fixed function of the block position**, constant
over time. A changing sheet/mirror at the same fire block would be a labelling error.

Burning entities (`EntityRenderDispatcher.renderFire`, `:326-327` + loop): layer `l` uses
`l % 2 == 0 ? FIRE_0 : FIRE_1`, and swaps U (mirror) when `(l / 2) % 2 == 0`. Same two sprites, so the same
`s` and the same E2 relation apply.

## E7. Without a strip: the tick is estimated from the video timestamp (FireCrackle's real case)

The footage FireCrackle processes has **no sync strip** (no tick, no frame id). E1-E6 do not need one; only the
tick source changes. Everything below is derived from E3/E4 and the code they cite.

**Executed ticks follow wall-clock time.** `RenderTickCounter.beginRenderTick` (`RenderTickCounter.java`):
The counter converts elapsed milliseconds into units of a 50 ms tick, accumulates that amount, takes
the whole-tick portion for the next update, and retains the fractional remainder.
so the number of ticks run by game time `T` (seconds since the counter started) is `N(T) = floor(20 * T)` as long
as no frame is slow enough to hit the cap `Math.min(10, i)` (`MinecraftClient.java:1022`, E4). Pausing, a menu or
a slow frame under 0.5 s only delays ticks (they run in bursts of up to 10 and catch up). Combined with E1/E2:
`s(T) = (s0 + N(T)) mod 32` while a world exists and nothing resets the sprites (E5).

**Phase from the timestamp.** For a frame with video timestamp `t = T - o` (`o` = unknown constant offset):

    phi = (20 * t - s) mod 32         is constant up to the floor:   phi in [c, c + 1)

because `20T - N(T) = frac(20T) in [0, 1)`. So all labelled frames of one continuous span fit inside an **arc of
width 1 tick** on the 32-tick circle, plus timestamp jitter (OBS / YouTube resampling: about +-1 frame, ie +-0.33
tick at 60 fps; mkv rounds to 1 ms = 0.02 tick). The check is therefore "fits in an arc of `window_ticks`"
(default 2 = 1 + jitter room), never an exact equality.

**What a deviation means.**
- Lag shorter than the cap: the sprite stops advancing while time passes, then catches up. `phi` rises
  by up to 10 ticks and comes back: a short, soft, explainable excursion (`max_lag_ticks` = 10).
- A frame so slow that `i > 10`: the extra ticks are dropped for good (E4): a permanent shift of `phi`.
- A resource reload resets `s` to 0 (E5), leaving the world stops the sprites (E3): permanent shifts.
- A short run that returns to the same phase afterwards can be a capture stall even when its departure
  exceeds 10 ticks. The game's per-render cap cannot classify video-sample departures. A wrong sheet is
  16 ticks away, but magnitude alone cannot establish a labelling error.

**Limits (cannot be fixed without ticks).**
- A label that is wrong by about 1 row sits inside the 1-tick floor noise plus jitter and may not be flagged.
  Errors of 2+ rows, a wrong sheet, a skipped or repeated tick boundary of several ticks are caught.
- The rate must be right: footage played faster or slower than real time needs `tick_rate` changed (a wrong
  rate shows as steady phase drift and many soft shifts); frame-accurate editing (cuts) shows as shifts.
- 32 ticks = 1.6 s: the phase is only defined modulo 32, so two spans that differ by exactly a multiple of 32
  ticks look identical.

## E8. Measured on the training recording (`data/joined/clip1.jsonl` + `2026-10-15 14-48-36.mkv`)

Method: the mod's per-frame rows (`f0`, `f1`, tick) paired with the video's packet timestamps (no pixels). The
detector got only `(frame, pts, sheet-1 row)` of the 20,388 frames that show fire, like a hand-labelled session;
the ticks were used only to judge it. Reproduce: `cargo run --release --example validate_phase -- JOINED VIDEO`.

- **E2 holds on 32,626 of 32,626 frames**: `f0 == (f1 + 16) mod 32` every time (real-data confirmation of the
  mcmeta frame list).
- **Zero sprite resets in 543.8 s**: `(tick - f1) mod 32` never changes (E1/E3/E5 on real footage).
- **Steady rate is exactly 20**: median drift `tick - 20 * pts` is flat over the clip (1044.3 - 1046.0). The
  average of 20.024 ticks/s comes from a recorder start-up burst (27 ticks inside one video frame at t = 0.5 s),
  not from a rate error; using 20.024 made the detector worse (167 flags instead of 107).
- **Timing noise is wider than the 1-tick floor**: deviation from the local level is p50 0.34, p90 0.68,
  p99 2.0-2.3 ticks; the p99.9 tail (16 ticks, max 26) is the start-up burst. There are 44 stalls larger than
  1.5 ticks in 9 minutes (1 to 272 frames long), each a departure and a return.
- **Flags on the clean clip**: 107 soft flags with a plain arc check (every stall = two shifts, plus boundary
  artifacts of tiny delta) -> **22 soft, 0 hard** with the excursion merge and the 1-tick noise floor: 17
  excursions (lag stalls) and 5 shifts, all five inside the first half second.
- **Random cuts** (frames removed, later timestamps pulled forward; 560 cuts of 0.2 s to 110 s): caught
  92.5% overall; by size of the phase jump: |delta| < 1 tick 0% (below the noise floor, unreachable by any phase
  check), 1-2 ticks 69%, 2-4 ticks 97%, 4-8 ticks 99%, 8-16 ticks 100%.
- **A cut that lands back on a level the footage had a moment ago** reads as a lag stall that ends at the cut
  (an excursion whose `end_frame` is the frame before the cut, usually Hard when the jump exceeds 10 ticks).

## E9. Re-check of clip2's freeze and catch-up (job 11)

Re-read the exact local sources jar named above, not just this document:
`MinecraftClient.java:1015-1024`, `RenderTickCounter.java:18-24`, `TextureManager.java:142-145`,
`SpriteAtlasTexture.java:270-275`, `Sprite.java:244-253`. The cap and immediate animation tick chain are
unchanged. `FireLabelClient.java:14` registers `END_CLIENT_TICK`; `FireLabel.java:40-41` increments the
counter once per callback. `GameRendererMixin.java:17-19` invokes `FireLabel.onFrameRendered()` at the
tail of each game render; `FireLabel.java:45-47` allocates its render ID.

The joined recording itself distinguishes recorded frame `n` from game render ID `f`:

| Recorded frame n | Game render f | Executed tick | Sheet-1 row |
|---|---|---|---|
| 13862 | 22322 | 5733 | 10 |
| 13863 | 22323 | 5733 | 10 |
| 14003 | 22323 | 5733 | 10 |
| 14004 | 22529 | 5780 | 25 |
| 14005 | 22530 | 5781 | 26 |

Thus the held samples repeat game render 22323; the next captured render is 22529, **206 game renders
later**, and its tick is 47 later. The displayed row changes by `47 mod 32 = 15`, exactly as recorded.
This is compatible with the vanilla cap. It is not evidence of 47 ticks executed in one game render.
The earlier assertion that this was a proven 2.4-second *client* freeze was too strong: it is a proven
hold in the recording/capture path, with game renders absent from that interval in the video. The
joined evidence does not establish which OBS/GPU/capture component caused it.

Consequences: preserve the event for review, describe the observable held animation/capture and phase
recovery, and do not call a large recovered departure a proven label error. In real uninstrumented
footage only rows and timestamps are available: repeated row != proof of identical full-frame pixels.
There is no 10-tick upper bound on a recovered video departure.

## What this does NOT prove (do not treat as verified)

- That an arbitrary recorder captures every game render (E9 demonstrates a counterexample). The mod's
  counter registration was checked in E9; uninstrumented target footage does not provide that counter.
- That a given video's timestamps are real time (uncut, not sped up): E7 depends on it; `tick_rate` and the
  shift flags exist because it is not guaranteed.
- The mirror *convention* for entity fire (which of swapped/unswapped the picker calls "mirrored").
- That OBS captures every rendered frame (dups/drops are handled by the sync strip, not by this doc).
- Behaviour with other mods/OptiFine (they can change animation ticking).
