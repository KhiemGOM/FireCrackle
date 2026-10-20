"""Inventory local vanilla GUI code/assets without copying game files into Git.

This is source auditing, not a detector, model fit or benchmark. Input client and
official mappings must match the hashes in the supplied Mojang version JSON.
The decompiled directory is a local Vineflower output, used for MenuScreens
registration evidence. All original game/decompiler files stay ignored.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import zipfile

SCREEN = "net.minecraft.client.gui.screens.Screen"
OVERLAY = "net.minecraft.client.gui.screens.Overlay"
PREFIX = "assets/minecraft/"


def digest(data: bytes, algorithm: str = "sha256") -> str:
    return hashlib.new(algorithm, data).hexdigest()


def class_info(data: bytes) -> dict:
    """Read constant-pool metadata and inheritance, never execute client code."""
    if data[:4] != b"\xca\xfe\xba\xbe":
        raise ValueError("Not a Java class")
    p = 8

    def u2():
        nonlocal p
        value = struct.unpack_from(">H", data, p)[0]
        p += 2
        return value

    count = u2()
    cp = [None] * count
    i = 1
    while i < count:
        tag = data[p]
        p += 1
        if tag == 1:
            size = u2()
            cp[i] = data[p:p + size].decode("utf-8", errors="replace")
            p += size
        elif tag in (7, 8, 16, 19, 20):
            cp[i] = (tag, u2())
        elif tag in (3, 4):
            p += 4
        elif tag in (5, 6):
            p += 8
            i += 1
        elif tag in (9, 10, 11, 12, 17, 18):
            cp[i] = (tag, u2(), u2())
        elif tag == 15:
            kind = data[p]
            p += 1
            cp[i] = (tag, kind, u2())
        else:
            raise ValueError(f"Unsupported constant tag {tag}")
        i += 1
    flags, this, superclass = u2(), u2(), u2()

    def class_name(index):
        return cp[cp[index][1]].replace("/", ".") if index else None

    constructors = set()
    for entry in cp:
        if isinstance(entry, tuple) and entry[0] == 10:
            name_type = cp[entry[2]]
            if cp[name_type[1]] == "<init>":
                constructors.add(class_name(entry[1]))
    return {
        "superclass": class_name(superclass),
        "abstract": bool(flags & 0x400),
        "strings": sorted({cp[x[1]] for x in cp if isinstance(x, tuple) and x[0] == 8}),
        "constructors": sorted(constructors),
    }


def mapping_names(text: str) -> dict[str, str]:
    return {m[2]: m[1] for line in text.splitlines()
            if (m := re.match(r"^(\S+) -> (\S+):$", line))}


def descends(name: str, base: str, classes: dict) -> bool:
    seen = set()
    while name in classes and name not in seen:
        if name == base:
            return True
        seen.add(name)
        name = classes[name]["superclass"]
    return False


def screen_id(name: str) -> str:
    relative = name.removeprefix("net.minecraft.client.gui.screens.")
    relative = relative.removeprefix("com.mojang.realmsclient.gui.screens.")
    return re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", relative).replace("$", ".").lower()


def resolve_assets(strings: list[str], assets: set[str]) -> list[str]:
    found = set()
    for value in strings:
        value = value.removeprefix("minecraft:")
        for candidate in (PREFIX + value, PREFIX + "textures/gui/sprites/" + value + ".png"):
            if candidate in assets:
                found.add(candidate)
    return sorted(found)


def registrations(menu_source: str, screens_source: str, names: dict, menu_obf: str) -> list[dict]:
    fields = dict(re.findall(r'public static final \S+ (\w+) = \w+\("([a-z0-9_]+)"', menu_source))
    links = re.findall(r'\w+\(' + re.escape(menu_obf) + r'\.(\w+), (\w+)::new\);', screens_source)
    result = [{"menu_type": fields[field], "screen_class": names[screen]}
              for field, screen in links]
    if not fields or len(result) != len(fields):
        raise ValueError(f"Unaccounted menu registrations: {len(fields)} fields, {len(result)} links")
    return result


# Human recording actions; class identity is obtained independently from the game.
# Similar-looking inventories retain target provenance but are not claimed visually separable.
INTERACTIONS = {
    "InventoryScreen": ("inventory", "E in survival/adventure; open recipe book, equip items, hover tooltips/effects"),
    "CreativeModeInventoryScreen": ("inventory", "E in creative; every tab, search and survival-inventory tab"),
    "ContainerScreen": ("block_entity", "Open single/double chest, trapped chest, barrel, ender chest and chest minecart; retain 1–6 row menu variants"),
    "DispenserScreen": ("block", "Open both dispenser and dropper; same generic_3x3 visual family"),
    "CrafterScreen": ("block", "Open crafter; toggle disabled slots and change powered/triggered state"),
    "CraftingScreen": ("block", "Use crafting table; recipe book closed/open/search/filter and narrow-window shifted layout"),
    "FurnaceScreen": ("block", "Use furnace empty/fuelled/smelting; recipe book and progress states"),
    "BlastFurnaceScreen": ("block", "Use blast furnace empty/fuelled/smelting; recipe book"),
    "SmokerScreen": ("block", "Use smoker empty/fuelled/cooking; recipe book"),
    "BrewingStandScreen": ("block", "Use brewing stand empty/brewing, fuel and potion states"),
    "EnchantmentScreen": ("block", "Use enchanting table; empty/item/lapis/options and animated book"),
    "AnvilScreen": ("block", "Use anvil; name entry, valid/invalid/too-expensive recipes"),
    "GrindstoneScreen": ("block", "Use grindstone; empty and valid/invalid input"),
    "SmithingScreen": ("block", "Use smithing table; template/input/output and armor preview states"),
    "StonecutterScreen": ("block", "Use stonecutter; empty, recipe list and scrolling"),
    "LoomScreen": ("block", "Use loom; banner/dye/pattern input, scrolling and preview"),
    "CartographyTableScreen": ("block", "Use cartography table; map clone/scale/lock/error states"),
    "BeaconScreen": ("block", "Use beacon; inactive/active, pyramid levels and effect selection"),
    "HopperScreen": ("block_entity", "Open hopper and hopper minecart; same hopper screen"),
    "ShulkerBoxScreen": ("block", "Open shulker box; colors, empty/full and tooltips"),
    "MerchantScreen": ("entity", "Interact with villager and wandering trader; scroll, locked/exhausted offers"),
    "HorseInventoryScreen": ("entity", "Open mount inventory while riding/sneaking; horse/donkey/mule/llama/camel variants, equipment and chest rows where supported"),
    "NautilusInventoryScreen": ("entity", "Open nautilus mount inventory; saddle/equipment states (1.21.11 only)"),
    "LecternScreen": ("block", "Use lectern holding a book; pages and take-book permissions"),
    "BookViewScreen": ("item", "Use written book; pages and clickable text/link confirmation"),
    "BookEditScreen": ("item", "Use writable book; type/select/paste, pages and sign action"),
    "BookSignScreen": ("item", "Choose Sign in writable-book editor; enter title"),
    "SignEditScreen": ("block", "Place/edit every standing/wall sign wood type; front/back, waxed rejection is negative"),
    "HangingSignEditScreen": ("block", "Place/edit hanging signs; front/back and different wood types"),
    "CommandBlockEditScreen": ("operator_block", "Use command block with creative/operator access; variants and output"),
    "MinecartCommandBlockEditScreen": ("operator_entity", "Use command-block minecart with permission"),
    "StructureBlockEditScreen": ("operator_block", "Use structure block; save/load/corner/data modes"),
    "JigsawBlockEditScreen": ("operator_block", "Use jigsaw block with permission; field and joint states"),
    "TestBlockEditScreen": ("operator_block", "Use test block with permission; available modes"),
    "TestInstanceBlockEditScreen": ("operator_block", "Use test-instance block with permission; selection/run/reset states"),
    "ChatScreen": ("chat", "T or /; chat input, command suggestions, history and hovered/clicked messages"),
    "InBedChatScreen": ("chat", "Enter bed; sleep chat and Leave Bed"),
    "PauseScreen": ("menu", "Esc in single-player and multiplayer; pause behavior differs, recognition label does not"),
    "AdvancementsScreen": ("menu", "L or pause→Advancements; tabs and hover cards"),
    "StatsScreen": ("menu", "Pause→Statistics; each statistics tab"),
    "SocialInteractionsScreen": ("menu", "P in multiplayer; player search, hide/report and blocked-player views"),
    "OptionsScreen": ("menu", "Pause/title→Options; navigate every settings child"),
    "ShareToLanScreen": ("menu", "Pause→Open to LAN in single-player"),
    "DeathScreen": ("system", "Die with normal/hardcore rules; confirmation child"),
    "TitleScreen": ("menu", "Launch/leave world; normal/demo states and all navigation branches"),
    "WinScreen": ("system", "Exit End portal or credits route; credits and poem modes"),
    "DialogListDialogScreen": ("server_dialog", "Server /dialog or dialog action opens a dialog-list template; catalogue template, not arbitrary JSON contents"),
    "MultiButtonDialogScreen": ("server_dialog", "Server /dialog or dialog action opens a multi-action template"),
    "SimpleDialogScreen": ("server_dialog", "Server /dialog or dialog action opens notice/confirmation template"),
    "ServerLinksDialogScreen": ("server_dialog", "Open server-provided links dialog; content is server-defined"),
    "WaitingForResponseScreen": ("server_dialog", "Dialog action requests a server response; waiting state"),
    "DialogScreen$WarningScreen": ("server_dialog", "Dialog link/action warning; preserve warning rather than inheriting container label"),
    "GameModeSwitcherScreen": ("menu", "Hold F3+F4 with permission; cycle and release; this is a screen, not a block interaction"),
    "DebugOptionsScreen": ("menu", "Use debug-options key binding; choose debug entries"),
}


def group_and_action(name: str, references: list[str]) -> tuple[str, str, str]:
    short = name.rsplit(".", 1)[-1]
    if short in INTERACTIONS:
        category, action = INTERACTIONS[short]
        return category, action, "curated_recording_action"
    if name.startswith("com.mojang.realmsclient."):
        return "realms", "Title→Realms; follow the corresponding account/world/configuration/dialog route", "navigation_family_only"
    if ".options." in name or ".debug." in name:
        return "menu", "Options/debug settings navigation; see constructor-reference candidates for the exact parent", "navigation_family_only"
    if ".worldselection." in name or any(x in short for x in ("FlatWorld", "BuffetWorld", "Preset")):
        return "world_selection", "Singleplayer→world selection/create/edit; follow the named configuration/dialog branch", "navigation_family_only"
    if ".multiplayer." in name or "Server" in short or "Connect" in short:
        return "multiplayer", "Multiplayer→server/connect/edit routes, or the corresponding connection event", "navigation_family_only"
    if ".reporting." in name:
        return "reporting", "Social interactions/chat/player reporting flow; do not submit a report for a capture test", "navigation_family_only"
    return "menu_or_system", "Exact trigger requires call-site audit; constructor-reference candidates are listed, not proof of user reachability", "pending_callsite_audit"


def build(client: Path, mappings: Path, version: Path, decompiled: Path, legacy: Path | None) -> dict:
    metadata = json.loads(version.read_text(encoding="utf-8"))
    if metadata["id"] != "1.21.11":
        raise ValueError("Expected Java 1.21.11 metadata")
    for kind, path in (("client", client), ("client_mappings", mappings)):
        if digest(path.read_bytes(), "sha1") != metadata["downloads"][kind]["sha1"]:
            raise ValueError(f"Official hash mismatch: {kind}")
    names = mapping_names(mappings.read_text(encoding="utf-8"))
    classes = {}
    obfuscated = {v: k for k, v in names.items()}
    with zipfile.ZipFile(client) as archive:
        entries = set(archive.namelist())
        for obf, name in names.items():
            entry = obf.replace(".", "/") + ".class"
            if entry not in entries:
                continue
            record = class_info(archive.read(entry))
            record["superclass"] = names.get(record["superclass"], record["superclass"])
            record["constructors"] = [names.get(c, c) for c in record["constructors"]]
            classes[name] = record
        assets = {n for n in entries if n.startswith(PREFIX + "textures/gui/") and n.endswith(".png")}
        assets_meta = []
        for name in sorted(assets):
            data = archive.read(name)
            width, height = struct.unpack_from(">II", data, 16)
            assets_meta.append({"path": name, "width": width, "height": height, "sha256": digest(data)})
        screens = {}
        for name, record in classes.items():
            if name == SCREEN or not descends(name, SCREEN, classes):
                continue
            refs = sorted(c for c, r in classes.items() if name in r["constructors"] and c != name)
            category, action, status = group_and_action(name, refs)
            inherited_assets = set()
            parent = record["superclass"]
            while parent in classes:
                inherited_assets.update(resolve_assets(classes[parent]["strings"], assets))
                parent = classes[parent]["superclass"]
            screens[name] = {
                "id": screen_id(name), "class": name, "superclass": record["superclass"],
                "abstract": record["abstract"], "category": category,
                "recording_action": action, "interaction_audit": status,
                "direct_assets": resolve_assets(record["strings"], assets),
                "inherited_assets": sorted(inherited_assets),
                "constructor_reference_candidates": refs,
                "detector_status": "not_implemented_or_validated_for_1.21.11",
            }
        menu_obf = obfuscated["net.minecraft.world.inventory.MenuType"]
        registrations_obf = obfuscated["net.minecraft.client.gui.screens.MenuScreens"]
        menus = registrations((decompiled / (menu_obf + ".java")).read_text(encoding="utf-8"),
                              (decompiled / (registrations_obf + ".java")).read_text(encoding="utf-8"), names, menu_obf)
        for menu in menus:
            if menu["screen_class"] not in screens:
                raise ValueError("Registered menu without screen")
            menu["gui_type"] = screens[menu["screen_class"]]["id"] + ":" + menu["menu_type"]
        overlays = [{"class": n, "abstract": r["abstract"], "assets": resolve_assets(r["strings"], assets)}
                    for n, r in classes.items() if n != OVERLAY and descends(n, OVERLAY, classes)]
        hud = [{"class": n, "direct_assets": resolve_assets(r["strings"], assets)} for n, r in classes.items()
               if n.startswith("net.minecraft.client.gui.") and not descends(n, SCREEN, classes)
               and resolve_assets(r["strings"], assets)]
        comparison = None
        if legacy:
            from PIL import Image
            import io
            with zipfile.ZipFile(legacy) as old:
                old_assets = {n for n in old.namelist() if n.startswith(PREFIX + "textures/gui/") and n.endswith(".png")}
                common = sorted(old_assets & assets)
                same_pixels, different_pixels = [], []
                for path in common:
                    a = Image.open(io.BytesIO(old.read(path))).convert("RGBA")
                    b = Image.open(io.BytesIO(archive.read(path))).convert("RGBA")
                    (same_pixels if a.size == b.size and a.tobytes() == b.tobytes() else different_pixels).append(path)
                comparison = {"legacy_client_sha256": digest(legacy.read_bytes()), "legacy_version": "1.16.5",
                              "legacy_gui_png_count": len(old_assets), "same_path_identical_rgba": same_pixels,
                              "same_path_changed_rgba": different_pixels,
                              "only_legacy_paths": sorted(old_assets - assets), "only_current_paths": sorted(assets - old_assets),
                              "meaning": "Path/pixel comparison only. Moved/split assets and layout behavior need separate source audit."}
    return {
        "schema_version": 1, "minecraft_version": metadata["id"],
        "sources": {kind: {"url": metadata["downloads"][kind]["url"], "sha1": metadata["downloads"][kind]["sha1"]}
                    for kind in ("client", "client_mappings")},
        "scope": "All mapped client Screen descendants (including nested/Realms), registered MenuTypes, Overlay descendants and every GUI PNG in the official client jar",
        "limitations": ["Catalogue is not detector coverage or an accuracy claim", "Constructor references include inheritance and lambdas; not all are open-screen calls",
                        "Literal asset dependencies are resolved; dynamically composed paths are not exhaustive per screen",
                        "Each concrete class has a distinct ID, but visually identical semantic interactions may be indistinguishable",
                        "Navigation-family/pending triggers require detailed call-site audit before claiming every interaction verified"],
        "menu_registrations": menus, "screens": sorted(screens.values(), key=lambda x: x["id"]),
        "overlays": sorted(overlays, key=lambda x: x["class"]), "hud_asset_users": sorted(hud, key=lambda x: x["class"]),
        "gui_assets": assets_meta, "legacy_comparison": comparison,
    }


def markdown(data: dict) -> str:
    screens = data["screens"]
    concrete = [s for s in screens if not s["abstract"]]
    lines = ["# Vanilla Java 1.21.11 GUI catalogue", "", "Generated from hash-verified local official client bytecode/assets and Mojang mappings. No game assets or decompiled sources are checked in.", "",
             f"**{len(concrete)} concrete screen classes**, {len(screens)-len(concrete)} abstract screen bases, **{len(data['menu_registrations'])} registered container menu types**, {len(data['gui_assets'])} GUI PNGs.", "",
             "This is a source inventory and recording checklist. Detection, mask integration and measured accuracy are subsequent work. GUI type is a known registry ID; an unrecognized image must abstain, never become a generic interaction-positive.", "",
             "## Scope and labels", "", "Use separate `screen_type`, `menu_type`, `target_kind` and visual `layout_variant`. Chest/barrel/ender-chest titles can be renamed or identical: do not promise the pixels identify which block opened a shared container layout. `generic_9x1` through `generic_9x6` remain distinct variants. Inventory, horse and nautilus screens use routes outside the registered MenuScreens table.", "",
             "Inventory/container/item/operator screens are interaction GUIs. Pause/options/world selection/Realms/system screens have their own categories and IDs; HUD presence alone is not an open interaction GUI. Overlays are separate from Screen state.", "",
             "## Interaction recording checklist", "", "| GUI class | Opens / states to record |", "|---|---|"]
    for s in concrete:
        if s["interaction_audit"] == "curated_recording_action":
            lines.append(f"| `{s['class'].rsplit('.',1)[-1]}` | {s['recording_action']} |")
    lines += ["", "Record closed→open→closed repeatedly, not one long open interval. Include multiple sessions/worlds, GUI scales, resolutions/aspect ratios, languages, empty/full slots, recipe-book positions, tooltips/dragged items and moving backgrounds. Keep entire recordings or sessions held out. Record world-only negatives, HUD/chat/toasts/tooltips, block interactions with no screen, F1, portal/damage tint and pause separately. No training run has been approved or started.", "",
              "## Capture mod contract", "", "The current `fire-detection/mod` targets **1.16.5**, not 1.21.11. It cannot label newer screen types until ported or a separate 1.21.11 capture module is built. Do not upgrade the old instance in place or use predictions as ground truth.", "",
              "Add a GUI-only capture mode that skips fire enumeration/projection, ownership passes and fire-only readbacks. Keep old fire mode available. Per rendered frame export:", "",
              "- `schema_version`, `minecraft_version`, session ID, renderer-frame ID, monotonic time and capture/video alignment marker; retain paused/repeated ticks.",
              "- exact active `screen_class`, known `screen_type`, category, `menu_type` where applicable, screen instance/transition ID, overlay class and world-present flag; `screen=null` is a true closed-screen observation, not a HUD absence.",
              "- framebuffer and scaled dimensions, GUI scale, panel bounds/slots and layout variant; transform to recording resolution explicitly.",
              "- target block/entity/item provenance where available, recipe-book state, hovered/dragged items, tooltip state; unknown provenance remains unknown.",
              "- mask references with validity and layer provenance. Distinguish panel/controls/tooltips from dim/blur background; retain transparent holes and avoid calling the entire screen an opaque panel.", "",
              "The existing fire-local alpha readback is not a complete GUI mask exporter. Exact masks need separately verified render-pass/layer capture for the target game version. Screen-state/geometry logging should work without that GPU path and without synchronous per-frame full-screen readback.", "",
              "## Registered menus", "", "| Menu ID | Screen class |", "|---|---|"]
    for row in data["menu_registrations"]:
        lines.append(f"| `{row['menu_type']}` | `{row['screen_class'].rsplit('.',1)[-1]}` |")
    c = data.get("legacy_comparison")
    if c:
        lines += ["", "## 1.16.5 comparison", "",
                  f"The old jar has {c['legacy_gui_png_count']} GUI PNGs. At unchanged paths, **{len(c['same_path_identical_rgba'])} are pixel-identical and {len(c['same_path_changed_rgba'])} differ**. {len(c['only_legacy_paths'])} old paths disappear and {len(c['only_current_paths'])} current paths are new. Renames/splitting are included in those path counts; this does not mean every new path represents a new screen.", "",
                  "Reuse only verified anchors/layouts. Similar appearance is not proof of identical texture coordinates, geometry or rendering. The JSON lists every comparison result.", ""]
    lines += ["## Full screen inventory", "", "Every Screen descendant is included, including nested dialogs and Realms. Abstract bases are not independently openable screens. `navigation_family_only` and `pending_callsite_audit` explicitly mean exact opening routes have not yet been verified; class/asset completeness does not establish interaction-route completeness.", "",
              "| Known GUI type | Category | Trigger audit | Direct texture count |", "|---|---|---|---|"]
    for s in screens:
        lines.append(f"| `{s['id']}`{' (abstract)' if s['abstract'] else ''} | {s['category']} | {s['interaction_audit']} | {len(s['direct_assets'])} |")
    lines += ["", "## Source and reproduction", ""]
    for name, src in data["sources"].items():
        lines += [f"- [{name}]({src['url']}), SHA-1 `{src['sha1']}`."]
    lines += ["", "Run `python scripts/catalogue_gui_screens.py --client <official-client.jar> --mappings <client.txt> --version-json <mojang_minecraft_info.json> --decompiled <local-vineflower-output> --legacy-client <1.16.5-client.jar> --write`. The decompiled directory must contain MenuType and MenuScreens classes under their obfuscated filenames. `--check` compares generated metadata/docs without rewriting. Source/game/decompiler inputs stay in ignored local caches.", "",
              "The JSON additionally inventories every GUI PNG with dimensions/hash, all resolvable literal per-screen/inherited texture references, HUD asset users, overlays and constructor-reference candidates. Dynamic assets and exact mask geometry require follow-up implementation; none are silently declared supported.", ""]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for arg in ("client", "mappings", "version-json", "decompiled"):
        parser.add_argument("--" + arg, type=Path, required=True)
    parser.add_argument("--legacy-client", type=Path)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--extract-local-assets", action="store_true", help="Copy GUI PNGs to ignored .board/gui-catalogue-1.21.11/assets only")
    args = parser.parse_args()
    data = build(args.client, args.mappings, args.version_json, args.decompiled, args.legacy_client)
    root = Path(__file__).resolve().parents[1]
    if args.extract_local_assets:
        destination = root / ".board/gui-catalogue-1.21.11/assets"
        with zipfile.ZipFile(args.client) as archive:
            for asset in data["gui_assets"]:
                path = destination / asset["path"]
                # Never trust ZIP paths to escape the explicitly local cache.
                if not path.resolve().is_relative_to(destination.resolve()):
                    raise ValueError("Unsafe asset path")
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(archive.read(asset["path"]))
    outputs = {root / "docs/gui_screens_1_21_11.json": json.dumps(data, indent=2, ensure_ascii=False) + "\n",
               root / "docs/GUI_SCREEN_CATALOGUE_1_21_11.md": markdown(data)}
    for path, text in outputs.items():
        if args.check and (not path.exists() or path.read_text(encoding="utf-8") != text):
            raise SystemExit(f"Stale catalogue: {path}")
        if args.write:
            path.write_text(text, encoding="utf-8")
    print(json.dumps({"screens": len(data["screens"]), "concrete": sum(not s["abstract"] for s in data["screens"]),
                      "menus": len(data["menu_registrations"]), "assets": len(data["gui_assets"])}))


if __name__ == "__main__":
    main()
