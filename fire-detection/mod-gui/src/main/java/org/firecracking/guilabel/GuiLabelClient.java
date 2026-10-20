package org.firecracking.guilabel;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.screen.ingame.HandledScreen;
import net.minecraft.registry.Registries;
import net.minecraft.screen.ScreenHandler;
import net.minecraft.screen.slot.Slot;
import org.firecracking.guilabel.mixin.HandledScreenAccessor;
import org.lwjgl.glfw.GLFW;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class GuiLabelClient implements ClientModInitializer {
    private static final Logger LOG = LoggerFactory.getLogger("guilabel");
    private static final Map<String, JsonObject> TYPES = new HashMap<>();
    private static AsyncJsonLog output;
    private static long frame, transition, screenInstance;
    private static final long START = System.nanoTime();
    private static Object lastScreen;
    private static String lastOverlay, layoutSignature;
    private static int layoutId;
    private static boolean active = true, f8;
    private static Screen startScreen;
    private static Object startOverlay;
    private static String session;

    @Override public void onInitializeClient() {
        try (var input = GuiLabelClient.class.getResourceAsStream("/guilabel-screen-types.json")) {
            if (input == null) throw new IllegalStateException("Screen registry missing");
            JsonArray rows = JsonParser.parseReader(new InputStreamReader(input, StandardCharsets.UTF_8)).getAsJsonArray();
            for (var element : rows) {
                JsonObject row = element.getAsJsonObject();
                TYPES.put(row.get("intermediary").getAsString(), row);
            }
            active = Boolean.parseBoolean(System.getProperty("guilabel.autoStart", "true"));
            session = UUID.randomUUID().toString();
            Path path = FabricLoader.getInstance().getGameDir().resolve("guilabel").resolve(session + ".jsonl");
            output = new AsyncJsonLog(path, 8192);
            JsonObject header = new JsonObject();
            header.addProperty("record", "session");
            header.addProperty("schema_version", 1);
            header.addProperty("minecraft_version", "1.21.11");
            header.addProperty("session_id", session);
            header.addProperty("utc", Instant.now().toString());
            header.addProperty("sodium_loaded", FabricLoader.getInstance().isModLoaded("sodium"));
            header.addProperty("strip", "gui-v1: D3A5 preamble + u32 frame + CRC16-CCITT-FALSE; MSB-first; Manchester white-black=1");
            header.addProperty("mask_ground_truth", false);
            header.addProperty("geometry_only", true);
            output.offer(header);
            Runtime.getRuntime().addShutdownHook(new Thread(() -> output.close(), "GUI-label-close"));
            LOG.info("GUI-only labels: {}. F8 toggles recording. Sodium loaded: {}", path, FabricLoader.getInstance().isModLoaded("sodium"));
        } catch (Exception error) {
            throw new IllegalStateException("GUI recording could not initialize", error);
        }
    }

    public static void begin(MinecraftClient client) {
        startScreen = client.currentScreen;
        startOverlay = client.getOverlay();
    }

    private static String intermediary(Object object) {
        return FabricLoader.getInstance().getMappingResolver().unmapClassName("intermediary", object.getClass().getName());
    }

    public static void frame(MinecraftClient client, DrawContext context) {
        if (output == null) return;
        long id = frame++;
        boolean key = GLFW.glfwGetKey(client.getWindow().getHandle(), GLFW.GLFW_KEY_F8) == GLFW.GLFW_PRESS;
        if (key && !f8) {
            active = !active;
            JsonObject event = new JsonObject();
            event.addProperty("record", "recording_toggle");
            event.addProperty("frame", id);
            event.addProperty("active", active);
            output.offer(event);
            LOG.info("GUI recording {}", active ? "ON" : "OFF");
        }
        f8 = key;
        if (!active) return;
        Screen screen = client.currentScreen;
        Object overlay = client.getOverlay();
        String overlayName = overlay == null ? "" : intermediary(overlay);
        boolean changed = screen != lastScreen || !overlayName.equals(lastOverlay);
        if (changed) { transition++; if (screen != lastScreen) screenInstance++; }
        lastScreen = screen;
        lastOverlay = overlayName;

        JsonObject row = new JsonObject();
        row.addProperty("record", "frame");
        row.addProperty("frame", id);
        row.addProperty("elapsed_ns", System.nanoTime() - START);
        row.addProperty("transition_id", transition);
        row.addProperty("screen_instance_id", screenInstance);
        row.addProperty("changed", changed);
        row.addProperty("world_present", client.world != null);
        row.addProperty("paused", client.isPaused());
        row.addProperty("stable_render_state", screen == startScreen && overlay == startOverlay);
        row.addProperty("screen_visible", screen != null && overlay == null && screen == startScreen);
        row.addProperty("screen_open", screen != null);
        if (overlay != null) row.addProperty("overlay_intermediary", overlayName);
        if (screen != null) {
            String keyName = intermediary(screen);
            JsonObject type = TYPES.get(keyName);
            row.addProperty("screen_intermediary", keyName);
            row.addProperty("known_screen", type != null);
            if (type != null) {
                row.addProperty("screen_type", type.get("id").getAsString());
                row.addProperty("screen_class", type.get("class").getAsString());
                row.addProperty("category", type.get("category").getAsString());
                row.addProperty("excluded_social", type.get("class").getAsString().contains(".social."));
            }
            row.addProperty("title", screen.getTitle().getString());
        }
        int sw = client.getWindow().getScaledWidth(), sh = client.getWindow().getScaledHeight();
        row.addProperty("framebuffer_width", client.getWindow().getFramebufferWidth());
        row.addProperty("framebuffer_height", client.getWindow().getFramebufferHeight());
        row.addProperty("scaled_width", sw);
        row.addProperty("scaled_height", sh);
        row.addProperty("gui_scale", client.getWindow().getScaleFactor());
        row.addProperty("mouse_x", client.mouse.getX() * sw / Math.max(1, client.getWindow().getWidth()));
        row.addProperty("mouse_y", client.mouse.getY() * sh / Math.max(1, client.getWindow().getHeight()));
        if (screen instanceof HandledScreen<?> handled) {
            HandledScreenAccessor bounds = (HandledScreenAccessor) handled;
            ScreenHandler handler = handled.getScreenHandler();
            try { row.addProperty("menu_type", Registries.SCREEN_HANDLER.getId(handler.getType()).toString()); }
            catch (UnsupportedOperationException ignored) { row.addProperty("menu_type", "client_only"); }
            StringBuilder signature = new StringBuilder().append(screenInstance).append(':').append(sw).append(':').append(sh)
                .append(':').append(bounds.guilabel$x()).append(':').append(bounds.guilabel$y())
                .append(':').append(bounds.guilabel$width()).append(':').append(bounds.guilabel$height());
            for (Slot slot : handler.slots) signature.append(';').append(slot.id).append(',').append(slot.x).append(',').append(slot.y).append(',').append(slot.isEnabled());
            String currentLayout = signature.toString();
            if (!currentLayout.equals(layoutSignature)) {
                layoutSignature = currentLayout;
                layoutId++;
                JsonObject layout = new JsonObject();
                layout.addProperty("record", "layout");
                layout.addProperty("layout_id", layoutId);
                layout.addProperty("frame", id);
                layout.addProperty("x", bounds.guilabel$x()); layout.addProperty("y", bounds.guilabel$y());
                layout.addProperty("width", bounds.guilabel$width()); layout.addProperty("height", bounds.guilabel$height());
                layout.addProperty("mask_ground_truth", false);
                JsonArray slots = new JsonArray();
                for (Slot slot : handler.slots) {
                    JsonObject s = new JsonObject();
                    s.addProperty("id", slot.id); s.addProperty("x", slot.x); s.addProperty("y", slot.y);
                    s.addProperty("enabled", slot.isEnabled()); slots.add(s);
                }
                layout.add("slots", slots);
                output.offer(layout);
            }
            row.addProperty("layout_id", layoutId);
        }
        output.offer(row);
        // A new root layer ensures the strip is above already-extracted screen content.
        context.createNewRootLayer();
        for (int cell = 0; cell < FrameStrip.CELLS; cell++) {
            int color = FrameStrip.white(id, cell) ? 0xffffffff : 0xff000000;
            context.fill(cell * 2, 0, cell * 2 + 2, 3, color);
        }
        if (!output.healthy()) context.fill(0, 3, 256, 6, 0xffff0000);
    }
}
