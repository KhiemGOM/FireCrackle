# Shared GUI detection and masking

`fire-detection/core/src/gui_interaction_fast.rs` implements the frozen
presence detector. `GuiDetector` optionally consumes this same immutable bank
and merges confirmed panel bounds as **unknown/neutral**, independently of HUD
fit. `studio_core::gui::interaction_detector` supplies the production bank to
preview, first-person preprocessing, no-fire preprocessing and Misc scanning.
No match is an abstention, not proof that a screen is closed. No-fire labels
abstain on an interaction/menu panel: hidden world pixels cannot establish absence.

## Source compatibility

An official-client asset audit compared 30 stable Java releases from 1.16.5
through 1.21.11. Source client identities and per-panel hashes are retained in
`research/GUI_ASSET_COMPATIBILITY.json`, without copying the assets. Thirteen of eighteen ordinary base-panel families retain
identical artwork: inventory, generic chest, crafting, furnace, blast furnace,
smoker, beacon, cartography, dispenser/dropper, hopper, loom, shulker and
stonecutter. Their shared pixels do not identify a game version or an exact
semantic screen type. Renameable titles are never evidence.

| Artwork generation | Additional evidence |
| --- | --- |
| 1.16.5 | Original base panels and old smithing layout |
| 1.17 | Brewing bottle-outline variant |
| 1.18–1.19.3 | Anvil, grindstone and enchanting lapis variants |
| 1.19.4 | Recipe-book artwork changes; new smithing experimental |
| 1.20–1.20.1 | New smithing standard |
| 1.20.2–1.21.11 | Enchanting placeholder changes; current artwork |

Slot hover artwork is dynamic/occluded evidence, never a required matching
anchor. Its 1.21.2 change does not create an independent detector. Old and new
smithing templates coexist because experimental flags can select the layout
independently of the release number. The bank contains both endpoint versions
plus four intermediate artwork templates, rather than complete detector copies.

The build provisions official client inputs for 1.16.5, 1.17, 1.18 and 1.21.11,
checks downloaded metadata/client SHA-1, and generates local GUIT packs and
their source-hash manifest. No client archive or extracted game asset is committed.
`prepare_assets.py` records rendering-rule class hashes for modern special layouts.

This audit establishes **asset compatibility, not measured per-version accuracy**.
Creative-tab history, entity inventories, trading and command/structure/jigsaw
layout histories are outside the eighteen-panel count. Inventory effects,
recipe-book positioning, resource packs and added screens require their own
rendered-state checks. HUD fitting remains the separately validated 1.16.5 path;
adding modern panel artwork does not make modern HUD fitting validated.

## Validation boundaries

The frozen 1.21.11 tooltip-neutral policy detected 9,967/9,970 calibration GUI
frames and 3,723/3,723 independently recorded GUI frames, with zero observed
false positives in 15,959 closed frames. Optimized endpoint-bank output matched
all 34,290 original frame decisions, including excluded screens. These are
correlated local recordings; see `research/GUI_CALIBRATION_RESULTS.md` and
`research/GUI_INDEPENDENT_TEST.md`. Additional version variants and AI preprocessing
changes require their own parity/regression checks before release claims.

Source audit: Swarmboard notice 13/job 240; reproducible private asset comparison
in `.board/gui-version-history/{audit.py,all.json,summary.json,changes.json}`.
Official sources: [version manifest](https://piston-meta.mojang.com/mc/game/version_manifest_v2.json),
[1.18](https://feedback.minecraft.net/hc/en-us/articles/4415128577293-Minecraft-Java-Edition-1-18),
[1.19.4](https://www.minecraft.net/en-us/article/minecraft-java-edition-1-19-4),
[1.20](https://feedback.minecraft.net/hc/en-us/articles/16499677456781-Minecraft-Java-Edition-1-20-Trails-Tales),
[1.20.2](https://www.minecraft.net/en-us/article/minecraft-java-edition-1-20-2).
