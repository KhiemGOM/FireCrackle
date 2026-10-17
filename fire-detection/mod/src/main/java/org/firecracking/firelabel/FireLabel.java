package org.firecracking.firelabel;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.render.model.ModelLoader;
import net.minecraft.client.texture.Sprite;
import net.minecraft.client.util.SpriteIdentifier;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.firecracking.firelabel.core.FrameCounter;
import org.firecracking.firelabel.core.FrameRecord;
import org.firecracking.firelabel.core.LabelLog;
import org.firecracking.firelabel.core.StripPattern;
import org.firecracking.firelabel.mixin.SpriteAccessor;
import org.firecracking.firelabel.ownership.OwnershipExport;

/** Per-frame state: frame ids, the tick counter, and the label log. Client thread only. */
public final class FireLabel {
    private static final Logger LOGGER = LogManager.getLogger("firelabel");
    private static final int FLUSH_EVERY_FRAMES = 120;

    private static final FrameCounter FRAMES = new FrameCounter();
    private static long ticks;
    private static int framesSinceFlush;
    private static LabelLog log;
    private static boolean logFailed;
    private static boolean labelerFailed;

    /** Dev only (set by the runClient config): outline the labelled boxes on screen to check them by eye. */
    private static final boolean DEBUG = Boolean.getBoolean("firelabel.debug");
    private static final boolean LEGACY_LABELS = Boolean.parseBoolean(System.getProperty("firelabel.legacyLabels", "true"));

    public static boolean usesLegacyLabels() { return LEGACY_LABELS; }

    private FireLabel() {}

    /** Called once per client tick: the "tick count" of the label table (ticks since launch). */
    public static void onClientTick() {
        ticks++;
    }

    /** Called at the end of every rendered frame. */
    public static void onFrameRendered() {
        MinecraftClient client = MinecraftClient.getInstance();
        int id = FRAMES.next();
        int fbWidth = client.getWindow().getFramebufferWidth();
        int fbHeight = client.getWindow().getFramebufferHeight();

        // Labels FIRST: they read the GUI coverage from the framebuffer's alpha, and the strip and the debug boxes
        // (drawn below) would write alpha too.
        FrameRecord record = null;
        RuntimeException failure = null;
        long labelStart = System.nanoTime();
        try {
            if (LEGACY_LABELS) {
                record = FireLabeler.label(
                        client, id, ticks, spriteFrame(ModelLoader.FIRE_0), spriteFrame(ModelLoader.FIRE_1));
            }
        } catch (RuntimeException e) {
            failure = e;
        }
        double labelMs = (System.nanoTime() - labelStart) / 1e6;
        if (Boolean.getBoolean("firelabel.profile") && id % 120 == 0) LOGGER.info("Label CPU: {} ms", labelMs);
        OwnershipExport.finish(id, ticks, spriteFrame(ModelLoader.FIRE_0), spriteFrame(ModelLoader.FIRE_1));
        StripRenderer.draw(fbWidth, fbHeight, StripPattern.wrapTick(ticks), id); // always, even if labelling failed
        if (!LEGACY_LABELS) {
            // Mask-only recordings have sample JSON, not guessed empty per-frame visibility labels.
            GuiMask.endFrame();
            return;
        }
        if (failure != null) {
            // Never write a guessed "no fire" row: a missing frame id is detectable, a false negative is not.
            if (!labelerFailed) {
                labelerFailed = true;
                LOGGER.error("Fire labeling failed; frames will be missing from the label log", failure);
            }
            return;
        }
        if (DEBUG) {
            DebugOverlay.draw(fbWidth, fbHeight, record);
        }

        LabelLog out = openLog();
        if (out == null) {
            return;
        }
        try {
            out.write(record);
            if (++framesSinceFlush >= FLUSH_EVERY_FRAMES) {
                framesSinceFlush = 0;
                out.flush();
            }
        } catch (IOException e) {
            failLog(e);
        }
    }

    public static void onClientStopping() {
        OwnershipExport.close();
        if (log != null) {
            try {
                log.close();
            } catch (IOException e) {
                LOGGER.error("Could not close the label log", e);
            }
            log = null;
        }
    }

    /**
     * Image row currently displayed by an animated atlas sprite, or -1 if it cannot be read.
     * The sprite's animation step is mapped through the .mcmeta frame order: fire_0 plays rows
     * 16..31,0..15, so its displayed row is (step + 16) % 32, while fire_1 is plain 0..31.
     */
    private static int spriteFrame(SpriteIdentifier id) {
        try {
            Sprite sprite = id.getSprite();
            SpriteAccessor accessor = (SpriteAccessor) sprite;
            return accessor.firelabel$getAnimationMetadata().getFrameIndex(accessor.firelabel$getFrameIndex());
        } catch (RuntimeException e) {
            return -1;
        }
    }

    private static LabelLog openLog() {
        if (log != null || logFailed) {
            return log;
        }
        try {
            Path dir = FabricLoader.getInstance().getGameDir().resolve("firelabel");
            Files.createDirectories(dir);
            String stamp = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss"));
            Path file = dir.resolve("labels-" + stamp + ".jsonl");
            log = new LabelLog(Files.newBufferedWriter(file, StandardCharsets.UTF_8));
            LOGGER.info("Writing frame labels to {}", file);
        } catch (IOException e) {
            failLog(e);
        }
        return log;
    }

    private static void failLog(IOException e) {
        logFailed = true;
        LOGGER.error("Label log failed; labels disabled for this session", e);
        log = null;
    }
}
