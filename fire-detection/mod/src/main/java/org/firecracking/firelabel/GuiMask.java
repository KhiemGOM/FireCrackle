package org.firecracking.firelabel;

import com.mojang.blaze3d.systems.RenderSystem;
import java.nio.ByteBuffer;
import net.minecraft.client.MinecraftClient;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.firecracking.firelabel.core.AlphaMask;
import org.firecracking.firelabel.core.BBox;
import org.firecracking.firelabel.core.ScreenMask;
import org.lwjgl.BufferUtils;
import org.lwjgl.opengl.GL11;

/**
 * What the GUI really drew over the world, taken from the framebuffer's alpha channel.
 *
 * <p>Right after the world pass (hand and on-fire overlay included) alpha is cleared to 0 with RGB masked. The GUI
 * then writes the alpha of everything it draws (glyphs and icons their real alpha, panels opaque), so at the end of
 * the frame alpha is an exact coverage mask. Regions are read back only around fire sources. See mod/PLAN.md
 * ("GUI occlusion"). Render thread only.
 */
public final class GuiMask {
    private static final Logger LOGGER = LogManager.getLogger("firelabel");
    /** Alpha statistics buckets (debug only): below this is a light veil. */
    private static final int STAT_SPLIT = 128;

    private static boolean armed;
    private static boolean selfTested;
    private static String brokenReason;
    private static ByteBuffer buffer;
    private static boolean readThisFrame;
    private static final boolean DEBUG = Boolean.getBoolean("firelabel.debug");

    // debug statistics (alpha histogram of everything read), logged by FireLabeler in debug mode
    static long statReads;
    static long statPixels;
    static long statLow; // alpha 1..127
    static long statHigh; // alpha 128..254
    static long statOpaque; // alpha 255

    private GuiMask() {}

    /** Called when the world pass is done and before any GUI is drawn. Never throws: problems surface at labelling. */
    public static void armAfterWorld() {
        try {
            RenderSystem.colorMask(false, false, false, true);
            RenderSystem.clearColor(0f, 0f, 0f, 0f);
            RenderSystem.clear(GL11.GL_COLOR_BUFFER_BIT, false);
            RenderSystem.colorMask(true, true, true, true);
            if (!selfTested) {
                selfTested = true;
                MinecraftClient c = MinecraftClient.getInstance();
                int a = readAlphaPixel(c.getWindow().getFramebufferWidth() / 2, c.getWindow().getFramebufferHeight() / 2);
                if (a != 0) {
                    brokenReason = "the framebuffer's alpha channel cannot be cleared (read back " + a
                            + " right after clearing it to 0): GUI occlusion is unavailable";
                    LOGGER.error("GUI mask self-test FAILED: {}", brokenReason);
                } else {
                    LOGGER.info("GUI mask self-test passed: the framebuffer alpha channel can be cleared and read.");
                }
            }
            readThisFrame = false;
            armed = true;
        } catch (RuntimeException e) {
            brokenReason = "arming the GUI mask threw " + e;
            LOGGER.error("GUI mask could not be armed", e);
        }
    }

    /** Throws unless this frame's mask is trustworthy, so a frame is omitted instead of silently mislabelled. */
    static void requireReady() {
        if (brokenReason != null) {
            throw new IllegalStateException(brokenReason);
        }
        if (!armed) {
            throw new IllegalStateException("the GUI mask was not armed this frame (no alpha clear after the world pass)");
        }
    }

    /**
     * The vignette blends with (ZERO, ONE_MINUS_SRC_COLOR), which would write alpha over the whole screen.
     * Called by InGameHudMixin around renderVignetteOverlay: alpha writes are masked while it draws.
     */
    public static void maskAlphaWrites(boolean masked) {
        RenderSystem.colorMask(true, true, true, !masked);
    }

    static void endFrame() {
        armed = false;
        readThisFrame = false;
    }

    /** The GUI coverage in the given screen rectangle (top-left pixels), or null if the rectangle is empty. */
    static ScreenMask read(int fbWidth, int fbHeight, BBox region) {
        if (region.isEmpty()) {
            return null;
        }
        int x0 = Math.max(0, (int) Math.floor(region.x0()) - 1);
        int y0 = Math.max(0, (int) Math.floor(region.y0()) - 1);
        int x1 = Math.min(fbWidth, (int) Math.ceil(region.x1()) + 1);
        int y1 = Math.min(fbHeight, (int) Math.ceil(region.y1()) + 1);
        int w = x1 - x0;
        int h = y1 - y0;
        if (w <= 0 || h <= 0) {
            return null;
        }
        if (!readThisFrame) {
            int needed = Math.multiplyExact(Math.multiplyExact(fbWidth, fbHeight), 4);
            if (buffer == null || buffer.capacity() < needed) buffer = BufferUtils.createByteBuffer(needed);
            buffer.clear();
            int oldAlign = GL11.glGetInteger(GL11.GL_PACK_ALIGNMENT);
            try {
                GL11.glPixelStorei(GL11.GL_PACK_ALIGNMENT, 1);
                GL11.glReadPixels(0, 0, fbWidth, fbHeight, GL11.GL_RGBA, GL11.GL_UNSIGNED_BYTE, buffer);
            } finally { GL11.glPixelStorei(GL11.GL_PACK_ALIGNMENT, oldAlign); }
            readThisFrame = true;
            statReads++;
            statPixels += (long) fbWidth * fbHeight;
            if (DEBUG) {
                for (int i = 3; i < needed; i += 4) {
                    int a = buffer.get(i) & 255;
                    if (a == 255) statOpaque++;
                    else if (a >= STAT_SPLIT) statHigh++;
                    else if (a > 0) statLow++;
                }
            }
        }
        return AlphaMask.rgbaView(buffer, fbWidth, fbHeight, x0, y0, w, h);
    }

    private static int readAlphaPixel(int x, int y) {
        ByteBuffer px = BufferUtils.createByteBuffer(4);
        int oldAlign = GL11.glGetInteger(GL11.GL_PACK_ALIGNMENT);
        GL11.glPixelStorei(GL11.GL_PACK_ALIGNMENT, 1);
        GL11.glReadPixels(x, y, 1, 1, GL11.GL_RGBA, GL11.GL_UNSIGNED_BYTE, px);
        GL11.glPixelStorei(GL11.GL_PACK_ALIGNMENT, oldAlign);
        return px.get(3) & 0xFF;
    }
}
