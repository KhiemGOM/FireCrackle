# Manual animation atlases

Verified against the local vanilla Minecraft 1.16.5 client: block texture `.mcmeta`,
`Sprite`, `SpriteAtlasTexture`, and `TextureManager`. Game textures are extracted at
build time into ignored files; they are never committed.

| Animation | Image size | Images | Ticks per playback image | Full period |
|---|---:|---:|---:|---:|
| Fire / soul fire 0 and 1 | 16×16 | 32 | 1 | 32 ticks |
| Still lava | 16×16 | 20 | 2 | 76 ticks |
| Flowing lava | 32×32 | 16 | 3 | 48 ticks |
| Still water | 16×16 | 32 | 2 | 64 ticks |
| Flowing water | 32×32 | 32 | 1 | 32 ticks |

Still lava plays `0…19,18…1`; a middle image can represent either direction.
The charts keep both possible tick intervals. Local transition checks track
possible playback ages over consecutive labelled frames: excessive advances and
early reversals are review candidates, with one tick of scheduling slack. Missing
labels or unresolved canonical-clock coverage restart the chain. This is a local
consistency check, not proof of a cut, and complete hidden cycles remain ambiguous.

Fire and soul fire share the steady animation clock and row convention. Their
chart tabs retain separate material provenance and reuse the same 32-tick tools.
Sheet 0's metadata order is physical images `16…31,0…15`; existing fire assets are
already reordered. Raw soul-fire assets use an explicit tile mapping instead.
Fluids retain their own periods, rulers, frame holds, and phase intervals. No joint
material analysis or cross-material flag is performed by these tabs.

On an atlas upload/reload, `Sprite.upload()` initially uploads physical image 0,
before ticking metadata order. This exceptional first frame is not an ordinary
steady-cycle phase observation. See [multi-texture research](phase-research/MULTI-TEXTURE-REVIEW.md).

Every material uses the same adaptive sprite picker, filters, exclusions, mirrored
columns, preview controls, and manual quad overlay. The auto labellers and quad
matcher remain normal-fire-only. The existing animation browser, codec correction,
and comparison proof remain normal-fire-only rather than using mismatched assets.

Alternate labels persist as `texture` records with atlas, row, and mirror. Native
fire analysis can normalize soul-fire observations to the shared fire tick while
keeping the stored material intact; fluid observations never enter fire flags.
The GUI/veil preprocessing implementation is unchanged by this feature. Historical
accuracy measurements are not re-certified by these UI and metadata tests.
