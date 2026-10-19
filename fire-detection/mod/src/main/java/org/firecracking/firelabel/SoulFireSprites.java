package org.firecracking.firelabel;

import net.minecraft.client.util.SpriteIdentifier;
import net.minecraft.screen.PlayerScreenHandler;
import net.minecraft.util.Identifier;

/** Vanilla soul atlas entries; resolved again after resource reloads. No game assets are bundled. */
final class SoulFireSprites {
    static final SpriteIdentifier ZERO = new SpriteIdentifier(PlayerScreenHandler.BLOCK_ATLAS_TEXTURE, new Identifier("minecraft", "block/soul_fire_0"));
    static final SpriteIdentifier ONE = new SpriteIdentifier(PlayerScreenHandler.BLOCK_ATLAS_TEXTURE, new Identifier("minecraft", "block/soul_fire_1"));
    private SoulFireSprites() {}
}
