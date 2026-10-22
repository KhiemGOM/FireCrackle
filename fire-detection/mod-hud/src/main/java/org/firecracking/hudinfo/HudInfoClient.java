package org.firecracking.hudinfo;

import com.google.gson.JsonObject;
import java.nio.file.Path;
import java.time.Instant;
import java.util.UUID;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Draws the overlay line plus a frame-ID sync strip, and logs every rendered HUD frame with the process clock
 *  and the displayed FPS value, so a recording can be aligned frame-for-frame with what the game actually drew. */
public final class HudInfoClient implements ClientModInitializer {
    private static final Logger LOG = LoggerFactory.getLogger("hudinfo");
    /** GUI rows: strip at 0..3, overlay box from 3, text at y = 4. */
    public static final int STRIP_HEIGHT = 3;
    public static final int TEXT_Y = STRIP_HEIGHT + 1;
    private static AsyncJsonLog output;
    private static long frame;
    private static int lastFps = Integer.MIN_VALUE;

    @Override
    public void onInitializeClient() {
        try {
            String session = UUID.randomUUID().toString();
            Path path = FabricLoader.getInstance().getGameDir().resolve("hudinfo").resolve(session + ".jsonl");
            output = new AsyncJsonLog(path, 16384);
            JsonObject header = new JsonObject();
            header.addProperty("record", "session");
            header.addProperty("schema_version", 1);
            header.addProperty("minecraft_version", "1.21.11");
            header.addProperty("session_id", session);
            header.addProperty("utc", Instant.now().toString());
            header.addProperty("sodium_loaded", FabricLoader.getInstance().isModLoaded("sodium"));
            header.addProperty("strip", "gui-v1: D3A5 preamble + u32 frame + CRC16-CCITT-FALSE; MSB-first; Manchester white-black=1");
            header.addProperty("clock", "System.nanoTime, the clock the FPS counter updates on");
            output.offer(header);
            Runtime.getRuntime().addShutdownHook(new Thread(() -> output.close(), "hud-info-close"));
            LOG.info("hud-info overlay active; frame log {}; sodium loaded: {}", path, FabricLoader.getInstance().isModLoaded("sodium"));
        } catch (Exception error) {
            throw new IllegalStateException("hud-info log could not initialize", error);
        }
    }

    /** Called once per HUD render, after the overlay text was drawn. */
    public static void frame(MinecraftClient client, DrawContext context, int fps) {
        long id = frame++;
        long nanos = System.nanoTime();
        JsonObject row = new JsonObject();
        row.addProperty("record", "frame");
        row.addProperty("frame", id);
        row.addProperty("nanos", nanos);
        row.addProperty("fps", fps);
        if (fps != lastFps) {
            row.addProperty("fps_changed", true);
            lastFps = fps;
        }
        output.offer(row);
        // A new root layer keeps the strip above everything drawn so far.
        context.createNewRootLayer();
        for (int cell = 0; cell < FrameStrip.CELLS; cell++) {
            int color = FrameStrip.white(id, cell) ? 0xffffffff : 0xff000000;
            context.fill(cell * 2, 0, cell * 2 + 2, STRIP_HEIGHT, color);
        }
        if (!output.healthy()) context.fill(256, 0, 512, STRIP_HEIGHT, 0xffff0000);
    }
}
