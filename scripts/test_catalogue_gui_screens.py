import json
from pathlib import Path
import unittest

from catalogue_gui_screens import descends, mapping_names, registrations, resolve_assets, screen_id


class CatalogueGuiTests(unittest.TestCase):
    def test_mapping_and_inheritance_include_nested_and_external_screens(self):
        self.assertEqual(mapping_names("named.Screen -> abc:\n    int x -> a\n"), {"abc": "named.Screen"})
        classes = {"Screen": {"superclass": None}, "Base": {"superclass": "Screen"},
                   "com.other.Screen$Inner": {"superclass": "Base"}, "loop": {"superclass": "loop"}}
        self.assertTrue(descends("com.other.Screen$Inner", "Screen", classes))
        self.assertFalse(descends("loop", "Screen", classes))

    def test_asset_refs_resolve_only_existing_direct_and_sprite_paths(self):
        assets = {"assets/minecraft/textures/gui/container/inventory.png",
                  "assets/minecraft/textures/gui/sprites/hud/crosshair.png"}
        self.assertEqual(resolve_assets(["textures/gui/container/inventory.png", "hud/crosshair", "missing"], assets), sorted(assets))

    def test_registration_coverage_rejects_missing_screen(self):
        source = 'public static final X a = f("crafting", x::new);'
        self.assertEqual(registrations(source, "f(dis.a, abc::new);", {"abc": "CraftingScreen"}, "dis"),
                         [{"menu_type": "crafting", "screen_class": "CraftingScreen"}])
        with self.assertRaises(ValueError):
            registrations(source, "", {}, "dis")

    def test_checked_in_registry_is_known_unique_and_not_claimed_validated(self):
        data = json.loads((Path(__file__).resolve().parents[1] / "docs/gui_screens_1_21_11.json").read_text(encoding="utf-8"))
        self.assertEqual(data["minecraft_version"], "1.21.11")
        screens = data["screens"]
        self.assertEqual(len({s["id"] for s in screens}), len(screens))
        by_class = {s["class"]: s for s in screens}
        self.assertEqual(len(data["menu_registrations"]), 25)
        self.assertEqual(len({m["gui_type"] for m in data["menu_registrations"]}), 25)
        for row in data["menu_registrations"]:
            self.assertIn(row["screen_class"], by_class)
        for name in ("InventoryScreen", "CraftingScreen", "CrafterScreen", "NautilusInventoryScreen", "HangingSignEditScreen"):
            self.assertTrue(any(s["class"].endswith("." + name) for s in screens), name)
        self.assertTrue(any(s["class"].startswith("com.mojang.realmsclient.") for s in screens))
        self.assertTrue(all(s["detector_status"].startswith("not_implemented") for s in screens))
        self.assertEqual(screen_id("net.minecraft.client.gui.screens.inventory.InventoryScreen"), "inventory.inventory_screen")
        for a in data["gui_assets"]:
            self.assertEqual(len(a["sha256"]), 64)
            self.assertGreater(a["width"], 0)


if __name__ == "__main__":
    unittest.main()
