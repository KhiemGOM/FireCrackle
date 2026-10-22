package org.firecracking.hudinfo;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.loader.api.FabricLoader;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class HudInfoClient implements ClientModInitializer {
    private static final Logger LOG = LoggerFactory.getLogger("hudinfo");

    @Override
    public void onInitializeClient() {
        LOG.info("hud-info overlay active; sodium loaded: {}", FabricLoader.getInstance().isModLoaded("sodium"));
    }
}
