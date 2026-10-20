# Vanilla Java 1.21.11 GUI catalogue

Generated from hash-verified local official client bytecode/assets and Mojang mappings. No game assets or decompiled sources are checked in.

**138 concrete screen classes**, 13 abstract screen bases, **25 registered container menu types**, 523 GUI PNGs.

This is a source inventory and recording checklist. Detection, mask integration and measured accuracy are subsequent work. GUI type is a known registry ID; an unrecognized image must abstain, never become a generic interaction-positive.

## Scope and labels

Use separate `screen_type`, `menu_type`, `target_kind` and visual `layout_variant`. Chest/barrel/ender-chest titles can be renamed or identical: do not promise the pixels identify which block opened a shared container layout. `generic_9x1` through `generic_9x6` remain distinct variants. Inventory, horse and nautilus screens use routes outside the registered MenuScreens table.

Inventory/container/item/operator screens are interaction GUIs. Pause/options/world selection/Realms/system screens have their own categories and IDs; HUD presence alone is not an open interaction GUI. Overlays are separate from Screen state.

## Interaction recording checklist

| GUI class | Opens / states to record |
|---|---|
| `StatsScreen` | Pause→Statistics; each statistics tab |
| `AdvancementsScreen` | L or pause→Advancements; tabs and hover cards |
| `ChatScreen` | T or /; chat input, command suggestions, history and hovered/clicked messages |
| `DeathScreen` | Die with normal/hardcore rules; confirmation child |
| `DebugOptionsScreen` | Use debug-options key binding; choose debug entries |
| `GameModeSwitcherScreen` | Hold F3+F4 with permission; cycle and release; this is a screen, not a block interaction |
| `DialogListDialogScreen` | Server /dialog or dialog action opens a dialog-list template; catalogue template, not arbitrary JSON contents |
| `DialogScreen$WarningScreen` | Dialog link/action warning; preserve warning rather than inheriting container label |
| `MultiButtonDialogScreen` | Server /dialog or dialog action opens a multi-action template |
| `ServerLinksDialogScreen` | Open server-provided links dialog; content is server-defined |
| `SimpleDialogScreen` | Server /dialog or dialog action opens notice/confirmation template |
| `WaitingForResponseScreen` | Dialog action requests a server response; waiting state |
| `InBedChatScreen` | Enter bed; sleep chat and Leave Bed |
| `AnvilScreen` | Use anvil; name entry, valid/invalid/too-expensive recipes |
| `BeaconScreen` | Use beacon; inactive/active, pyramid levels and effect selection |
| `BlastFurnaceScreen` | Use blast furnace empty/fuelled/smelting; recipe book |
| `BookEditScreen` | Use writable book; type/select/paste, pages and sign action |
| `BookSignScreen` | Choose Sign in writable-book editor; enter title |
| `BookViewScreen` | Use written book; pages and clickable text/link confirmation |
| `BrewingStandScreen` | Use brewing stand empty/brewing, fuel and potion states |
| `CartographyTableScreen` | Use cartography table; map clone/scale/lock/error states |
| `CommandBlockEditScreen` | Use command block with creative/operator access; variants and output |
| `ContainerScreen` | Open single/double chest, trapped chest, barrel, ender chest and chest minecart; retain 1–6 row menu variants |
| `CrafterScreen` | Open crafter; toggle disabled slots and change powered/triggered state |
| `CraftingScreen` | Use crafting table; recipe book closed/open/search/filter and narrow-window shifted layout |
| `CreativeModeInventoryScreen` | E in creative; every tab, search and survival-inventory tab |
| `DispenserScreen` | Open both dispenser and dropper; same generic_3x3 visual family |
| `EnchantmentScreen` | Use enchanting table; empty/item/lapis/options and animated book |
| `FurnaceScreen` | Use furnace empty/fuelled/smelting; recipe book and progress states |
| `GrindstoneScreen` | Use grindstone; empty and valid/invalid input |
| `HangingSignEditScreen` | Place/edit hanging signs; front/back and different wood types |
| `HopperScreen` | Open hopper and hopper minecart; same hopper screen |
| `HorseInventoryScreen` | Open mount inventory while riding/sneaking; horse/donkey/mule/llama/camel variants, equipment and chest rows where supported |
| `InventoryScreen` | E in survival/adventure; open recipe book, equip items, hover tooltips/effects |
| `JigsawBlockEditScreen` | Use jigsaw block with permission; field and joint states |
| `LecternScreen` | Use lectern holding a book; pages and take-book permissions |
| `LoomScreen` | Use loom; banner/dye/pattern input, scrolling and preview |
| `MerchantScreen` | Interact with villager and wandering trader; scroll, locked/exhausted offers |
| `MinecartCommandBlockEditScreen` | Use command-block minecart with permission |
| `NautilusInventoryScreen` | Open nautilus mount inventory; saddle/equipment states (1.21.11 only) |
| `ShulkerBoxScreen` | Open shulker box; colors, empty/full and tooltips |
| `SignEditScreen` | Place/edit every standing/wall sign wood type; front/back, waxed rejection is negative |
| `SmithingScreen` | Use smithing table; template/input/output and armor preview states |
| `SmokerScreen` | Use smoker empty/fuelled/cooking; recipe book |
| `StonecutterScreen` | Use stonecutter; empty, recipe list and scrolling |
| `StructureBlockEditScreen` | Use structure block; save/load/corner/data modes |
| `TestBlockEditScreen` | Use test block with permission; available modes |
| `TestInstanceBlockEditScreen` | Use test-instance block with permission; selection/run/reset states |
| `OptionsScreen` | Pause/title→Options; navigate every settings child |
| `PauseScreen` | Esc in single-player and multiplayer; pause behavior differs, recognition label does not |
| `ShareToLanScreen` | Pause→Open to LAN in single-player |
| `SocialInteractionsScreen` | P in multiplayer; player search, hide/report and blocked-player views |
| `TitleScreen` | Launch/leave world; normal/demo states and all navigation branches |
| `WinScreen` | Exit End portal or credits route; credits and poem modes |

Record closed→open→closed repeatedly, not one long open interval. Include multiple sessions/worlds, GUI scales, resolutions/aspect ratios, languages, empty/full slots, recipe-book positions, tooltips/dragged items and moving backgrounds. Keep entire recordings or sessions held out. Record world-only negatives, HUD/chat/toasts/tooltips, block interactions with no screen, F1, portal/damage tint and pause separately. No training run has been approved or started.

## Capture mod contract

The current `fire-detection/mod` targets **1.16.5**, not 1.21.11. It cannot label newer screen types until ported or a separate 1.21.11 capture module is built. Do not upgrade the old instance in place or use predictions as ground truth.

Add a GUI-only capture mode that skips fire enumeration/projection, ownership passes and fire-only readbacks. Keep old fire mode available. Per rendered frame export:

- `schema_version`, `minecraft_version`, session ID, renderer-frame ID, monotonic time and capture/video alignment marker; retain paused/repeated ticks.
- exact active `screen_class`, known `screen_type`, category, `menu_type` where applicable, screen instance/transition ID, overlay class and world-present flag; `screen=null` is a true closed-screen observation, not a HUD absence.
- framebuffer and scaled dimensions, GUI scale, panel bounds/slots and layout variant; transform to recording resolution explicitly.
- target block/entity/item provenance where available, recipe-book state, hovered/dragged items, tooltip state; unknown provenance remains unknown.
- mask references with validity and layer provenance. Distinguish panel/controls/tooltips from dim/blur background; retain transparent holes and avoid calling the entire screen an opaque panel.

The existing fire-local alpha readback is not a complete GUI mask exporter. Exact masks need separately verified render-pass/layer capture for the target game version. Screen-state/geometry logging should work without that GPU path and without synchronous per-frame full-screen readback.

## Registered menus

| Menu ID | Screen class |
|---|---|
| `generic_9x1` | `ContainerScreen` |
| `generic_9x2` | `ContainerScreen` |
| `generic_9x3` | `ContainerScreen` |
| `generic_9x4` | `ContainerScreen` |
| `generic_9x5` | `ContainerScreen` |
| `generic_9x6` | `ContainerScreen` |
| `generic_3x3` | `DispenserScreen` |
| `crafter_3x3` | `CrafterScreen` |
| `anvil` | `AnvilScreen` |
| `beacon` | `BeaconScreen` |
| `blast_furnace` | `BlastFurnaceScreen` |
| `brewing_stand` | `BrewingStandScreen` |
| `crafting` | `CraftingScreen` |
| `enchantment` | `EnchantmentScreen` |
| `furnace` | `FurnaceScreen` |
| `grindstone` | `GrindstoneScreen` |
| `hopper` | `HopperScreen` |
| `lectern` | `LecternScreen` |
| `loom` | `LoomScreen` |
| `merchant` | `MerchantScreen` |
| `shulker_box` | `ShulkerBoxScreen` |
| `smithing` | `SmithingScreen` |
| `smoker` | `SmokerScreen` |
| `cartography_table` | `CartographyTableScreen` |
| `stonecutter` | `StonecutterScreen` |

## 1.16.5 comparison

The old jar has 62 GUI PNGs. At unchanged paths, **18 are pixel-identical and 25 differ**. 19 old paths disappear and 480 current paths are new. Renames/splitting are included in those path counts; this does not mean every new path represents a new screen.

Reuse only verified anchors/layouts. Similar appearance is not proof of identical texture coordinates, geometry or rendering. The JSON lists every comparison result.

## Full screen inventory

Every Screen descendant is included, including nested dialogs and Realms. Abstract bases are not independently openable screens. `navigation_family_only` and `pending_callsite_audit` explicitly mean exact opening routes have not yet been verified; class/asset completeness does not establish interaction-route completeness.

| Known GUI type | Category | Trigger audit | Direct texture count |
|---|---|---|---|
| `accessibility_onboarding_screen` | menu_or_system | pending_callsite_audit | 0 |
| `achievement.stats_screen` | menu | curated_recording_action | 4 |
| `add_realm_popup_screen` | realms | navigation_family_only | 4 |
| `advancements.advancements_screen` | menu | curated_recording_action | 1 |
| `alert_screen` | menu_or_system | pending_callsite_audit | 0 |
| `backup_confirm_screen` | menu_or_system | pending_callsite_audit | 0 |
| `chat_screen` | chat | curated_recording_action | 0 |
| `com.mojang.realmsclient.realms_main_screen` | realms | navigation_family_only | 10 |
| `configuration.realms_backup_info_screen` | realms | navigation_family_only | 0 |
| `configuration.realms_backup_screen` | realms | navigation_family_only | 0 |
| `configuration.realms_configure_world_screen` | realms | navigation_family_only | 0 |
| `configuration.realms_invite_screen` | realms | navigation_family_only | 0 |
| `configuration.realms_preferred_region_selection_screen` | realms | navigation_family_only | 0 |
| `configuration.realms_slot_options_screen` | realms | navigation_family_only | 0 |
| `confirm_link_screen` | menu_or_system | pending_callsite_audit | 0 |
| `confirm_screen` | menu_or_system | pending_callsite_audit | 0 |
| `connect_screen` | multiplayer | navigation_family_only | 0 |
| `create_buffet_world_screen` | world_selection | navigation_family_only | 0 |
| `create_flat_world_screen` | world_selection | navigation_family_only | 1 |
| `credits_and_attribution_screen` | menu_or_system | pending_callsite_audit | 0 |
| `datapack_load_failure_screen` | menu_or_system | pending_callsite_audit | 0 |
| `death_screen` | system | curated_recording_action | 1 |
| `death_screen.title_confirm_screen` | menu_or_system | pending_callsite_audit | 0 |
| `debug.debug_options_screen` | menu | curated_recording_action | 0 |
| `debug.game_mode_switcher_screen` | menu | curated_recording_action | 3 |
| `demo_intro_screen` | menu_or_system | pending_callsite_audit | 1 |
| `dialog.button_list_dialog_screen` (abstract) | menu_or_system | pending_callsite_audit | 0 |
| `dialog.dialog_list_dialog_screen` | server_dialog | curated_recording_action | 0 |
| `dialog.dialog_screen` (abstract) | menu_or_system | pending_callsite_audit | 3 |
| `dialog.dialog_screen.warning_screen` | server_dialog | curated_recording_action | 0 |
| `dialog.multi_button_dialog_screen` | server_dialog | curated_recording_action | 0 |
| `dialog.server_links_dialog_screen` | server_dialog | curated_recording_action | 0 |
| `dialog.simple_dialog_screen` | server_dialog | curated_recording_action | 0 |
| `dialog.waiting_for_response_screen` | server_dialog | curated_recording_action | 0 |
| `direct_join_server_screen` | multiplayer | navigation_family_only | 0 |
| `disconnected_screen` | menu_or_system | pending_callsite_audit | 0 |
| `error_screen` | menu_or_system | pending_callsite_audit | 0 |
| `generic_message_screen` | menu_or_system | pending_callsite_audit | 0 |
| `generic_waiting_screen` | menu_or_system | pending_callsite_audit | 0 |
| `in_bed_chat_screen` | chat | curated_recording_action | 0 |
| `inventory.abstract_command_block_edit_screen` (abstract) | menu_or_system | pending_callsite_audit | 0 |
| `inventory.abstract_container_screen` (abstract) | menu_or_system | pending_callsite_audit | 3 |
| `inventory.abstract_furnace_screen` (abstract) | menu_or_system | pending_callsite_audit | 0 |
| `inventory.abstract_mount_inventory_screen` (abstract) | menu_or_system | pending_callsite_audit | 0 |
| `inventory.abstract_recipe_book_screen` (abstract) | menu_or_system | pending_callsite_audit | 0 |
| `inventory.abstract_sign_edit_screen` (abstract) | menu_or_system | pending_callsite_audit | 0 |
| `inventory.anvil_screen` | block | curated_recording_action | 4 |
| `inventory.beacon_screen` | block | curated_recording_action | 7 |
| `inventory.blast_furnace_screen` | block | curated_recording_action | 3 |
| `inventory.book_edit_screen` | item | curated_recording_action | 0 |
| `inventory.book_sign_screen` | item | curated_recording_action | 0 |
| `inventory.book_view_screen` | item | curated_recording_action | 1 |
| `inventory.brewing_stand_screen` | block | curated_recording_action | 4 |
| `inventory.cartography_table_screen` | block | curated_recording_action | 6 |
| `inventory.command_block_edit_screen` | operator_block | curated_recording_action | 0 |
| `inventory.container_screen` | block_entity | curated_recording_action | 1 |
| `inventory.crafter_screen` | block | curated_recording_action | 4 |
| `inventory.crafting_screen` | block | curated_recording_action | 1 |
| `inventory.creative_mode_inventory_screen` | inventory | curated_recording_action | 30 |
| `inventory.dispenser_screen` | block | curated_recording_action | 1 |
| `inventory.enchantment_screen` | block | curated_recording_action | 10 |
| `inventory.furnace_screen` | block | curated_recording_action | 3 |
| `inventory.grindstone_screen` | block | curated_recording_action | 2 |
| `inventory.hanging_sign_edit_screen` | block | curated_recording_action | 0 |
| `inventory.hopper_screen` | block_entity | curated_recording_action | 1 |
| `inventory.horse_inventory_screen` | entity | curated_recording_action | 3 |
| `inventory.inventory_screen` | inventory | curated_recording_action | 0 |
| `inventory.item_combiner_screen` (abstract) | menu_or_system | pending_callsite_audit | 0 |
| `inventory.jigsaw_block_edit_screen` | operator_block | curated_recording_action | 0 |
| `inventory.lectern_screen` | block | curated_recording_action | 0 |
| `inventory.loom_screen` | block | curated_recording_action | 10 |
| `inventory.merchant_screen` | entity | curated_recording_action | 10 |
| `inventory.minecart_command_block_edit_screen` | operator_entity | curated_recording_action | 0 |
| `inventory.nautilus_inventory_screen` | entity | curated_recording_action | 2 |
| `inventory.shulker_box_screen` | block | curated_recording_action | 1 |
| `inventory.sign_edit_screen` | block | curated_recording_action | 0 |
| `inventory.smithing_screen` | block | curated_recording_action | 4 |
| `inventory.smoker_screen` | block | curated_recording_action | 3 |
| `inventory.stonecutter_screen` | block | curated_recording_action | 6 |
| `inventory.structure_block_edit_screen` | operator_block | curated_recording_action | 0 |
| `inventory.test_block_edit_screen` | operator_block | curated_recording_action | 0 |
| `inventory.test_instance_block_edit_screen` | operator_block | curated_recording_action | 0 |
| `level_loading_screen` | menu_or_system | pending_callsite_audit | 0 |
| `manage_server_screen` | multiplayer | navigation_family_only | 0 |
| `multiplayer.code_of_conduct_screen` | multiplayer | navigation_family_only | 0 |
| `multiplayer.join_multiplayer_screen` | multiplayer | navigation_family_only | 0 |
| `multiplayer.safety_screen` | multiplayer | navigation_family_only | 0 |
| `multiplayer.server_reconfig_screen` | multiplayer | navigation_family_only | 0 |
| `multiplayer.warning_screen` (abstract) | multiplayer | navigation_family_only | 0 |
| `net.minecraft.client.gui.components.popup_screen` | menu_or_system | pending_callsite_audit | 1 |
| `net.minecraft.client.multiplayer.client_common_packet_listener_impl.pack_confirm_screen` | multiplayer | navigation_family_only | 0 |
| `net.minecraft.realms.realms_screen` (abstract) | menu_or_system | pending_callsite_audit | 1 |
| `notice_with_link_screen` | menu_or_system | pending_callsite_audit | 0 |
| `options.accessibility_options_screen` | menu | navigation_family_only | 0 |
| `options.chat_options_screen` | menu | navigation_family_only | 0 |
| `options.controls.controls_screen` | menu | navigation_family_only | 0 |
| `options.controls.key_binds_screen` | menu | navigation_family_only | 0 |
| `options.font_options_screen` | menu | navigation_family_only | 0 |
| `options.language_select_screen` | menu | navigation_family_only | 0 |
| `options.mouse_settings_screen` | menu | navigation_family_only | 0 |
| `options.online_options_screen` | menu | navigation_family_only | 0 |
| `options.options_screen` | menu | curated_recording_action | 0 |
| `options.options_sub_screen` (abstract) | menu | navigation_family_only | 0 |
| `options.skin_customization_screen` | menu | navigation_family_only | 0 |
| `options.sound_options_screen` | menu | navigation_family_only | 0 |
| `options.unsupported_graphics_warning_screen` | menu | navigation_family_only | 0 |
| `options.video_settings_screen` | menu | navigation_family_only | 0 |
| `out_of_memory_screen` | menu_or_system | pending_callsite_audit | 0 |
| `packs.pack_selection_screen` | menu_or_system | pending_callsite_audit | 0 |
| `pause_screen` | menu | curated_recording_action | 1 |
| `pause_screen.feedback_sub_screen` | menu_or_system | pending_callsite_audit | 0 |
| `preset_flat_world_screen` | world_selection | navigation_family_only | 1 |
| `progress_screen` | menu_or_system | pending_callsite_audit | 0 |
| `realms_broken_world_screen` | realms | navigation_family_only | 1 |
| `realms_client_outdated_screen` | realms | navigation_family_only | 0 |
| `realms_confirm_screen` | realms | navigation_family_only | 0 |
| `realms_create_realm_screen` | realms | navigation_family_only | 0 |
| `realms_download_latest_world_screen` | realms | navigation_family_only | 0 |
| `realms_generic_error_screen` | realms | navigation_family_only | 0 |
| `realms_long_running_mco_connect_task_screen` | realms | navigation_family_only | 0 |
| `realms_long_running_mco_task_screen` | realms | navigation_family_only | 0 |
| `realms_notifications_screen` | realms | navigation_family_only | 4 |
| `realms_parental_consent_screen` | realms | navigation_family_only | 0 |
| `realms_pending_invites_screen` | realms | navigation_family_only | 0 |
| `realms_reset_world_screen` | realms | navigation_family_only | 6 |
| `realms_select_file_to_upload_screen` | realms | navigation_family_only | 0 |
| `realms_select_world_template_screen` | realms | navigation_family_only | 1 |
| `realms_terms_screen` | realms | navigation_family_only | 0 |
| `realms_upload_screen` | realms | navigation_family_only | 0 |
| `recover_world_data_screen` | menu_or_system | pending_callsite_audit | 0 |
| `reporting.abstract_report_screen` (abstract) | reporting | navigation_family_only | 0 |
| `reporting.abstract_report_screen.discard_report_warning_screen` | reporting | navigation_family_only | 0 |
| `reporting.chat_report_screen` | reporting | navigation_family_only | 0 |
| `reporting.chat_selection_screen` | reporting | navigation_family_only | 1 |
| `reporting.name_report_screen` | reporting | navigation_family_only | 0 |
| `reporting.report_player_screen` | reporting | navigation_family_only | 0 |
| `reporting.report_reason_selection_screen` | reporting | navigation_family_only | 0 |
| `reporting.skin_report_screen` | reporting | navigation_family_only | 0 |
| `share_to_lan_screen` | menu | curated_recording_action | 0 |
| `social.social_interactions_screen` | menu | curated_recording_action | 2 |
| `telemetry.telemetry_info_screen` | menu_or_system | pending_callsite_audit | 0 |
| `title_screen` | menu | curated_recording_action | 0 |
| `win_screen` | system | curated_recording_action | 0 |
| `worldselection.confirm_experimental_features_screen` | world_selection | navigation_family_only | 0 |
| `worldselection.confirm_experimental_features_screen.details_screen` | world_selection | navigation_family_only | 0 |
| `worldselection.create_world_screen` | world_selection | navigation_family_only | 1 |
| `worldselection.edit_game_rules_screen` | world_selection | navigation_family_only | 0 |
| `worldselection.edit_world_screen` | world_selection | navigation_family_only | 0 |
| `worldselection.experiments_screen` | world_selection | navigation_family_only | 0 |
| `worldselection.optimize_world_screen` | world_selection | navigation_family_only | 0 |
| `worldselection.select_world_screen` | world_selection | navigation_family_only | 0 |

## Source and reproduction

- [client](https://piston-data.mojang.com/v1/objects/ba2df812c2d12e0219c489c4cd9a5e1f0760f5bd/client.jar), SHA-1 `ba2df812c2d12e0219c489c4cd9a5e1f0760f5bd`.
- [client_mappings](https://piston-data.mojang.com/v1/objects/031a68bebf55d824f66d6573d8c752f0e1bf232a/client.txt), SHA-1 `031a68bebf55d824f66d6573d8c752f0e1bf232a`.

Run `python scripts/catalogue_gui_screens.py --client <official-client.jar> --mappings <client.txt> --version-json <mojang_minecraft_info.json> --decompiled <local-vineflower-output> --legacy-client <1.16.5-client.jar> --write`. The decompiled directory must contain MenuType and MenuScreens classes under their obfuscated filenames. `--check` compares generated metadata/docs without rewriting. Source/game/decompiler inputs stay in ignored local caches.

The JSON additionally inventories every GUI PNG with dimensions/hash, all resolvable literal per-screen/inherited texture references, HUD asset users, overlays and constructor-reference candidates. Dynamic assets and exact mask geometry require follow-up implementation; none are silently declared supported.
