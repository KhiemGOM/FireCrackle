package org.firecracking.firelabel.core;

import java.nio.ByteBuffer;

/**
 * A rectangle of the framebuffer's alpha channel as the GUI left it (the world pass clears alpha to 0, the GUI
 * writes the alpha of what it draws), as 0..1 coverage per pixel.
 */
public final class AlphaMask implements ScreenMask {
    private final int x0;
    private final int y0;
    private final int width;
    private final int height;
    private final byte[] alpha; // top-down rows

    /** @param alphaTopDown one byte (unsigned) per pixel, rows from the TOP of the region */
    public AlphaMask(int x0, int y0, int width, int height, byte[] alphaTopDown) {
        if (width <= 0 || height <= 0) {
            throw new IllegalArgumentException("region must be non-empty: " + width + "x" + height);
        }
        if (alphaTopDown == null || alphaTopDown.length != width * height) {
            throw new IllegalArgumentException("alpha must hold width * height bytes");
        }
        this.x0 = x0;
        this.y0 = y0;
        this.width = width;
        this.height = height;
        this.alpha = alphaTopDown.clone();
    }

    /**
     * From glReadPixels data, which comes bottom row first.
     *
     * @param yTop screen y (top-left origin) of the region's TOP row
     */
    public static AlphaMask fromBottomUpRows(int x0, int yTop, int width, int height, byte[] bottomUp) {
        if (width <= 0 || height <= 0 || bottomUp == null || bottomUp.length != width * height) {
            throw new IllegalArgumentException("alpha must hold width * height bytes");
        }
        byte[] topDown = new byte[bottomUp.length];
        for (int row = 0; row < height; row++) {
            System.arraycopy(bottomUp, (height - 1 - row) * width, topDown, row * width, width);
        }
        return new AlphaMask(x0, yTop, width, height, topDown);
    }

    /** Read-only ROI view over a shared bottom-up RGBA readback. Valid until that buffer is reused. */
    public static ScreenMask rgbaView(ByteBuffer rgba, int framebufferWidth, int framebufferHeight,
            int x0, int y0, int width, int height) {
        if (framebufferWidth < 1 || framebufferHeight < 1 || (long) framebufferWidth * framebufferHeight * 4 > rgba.limit()) {
            throw new IllegalArgumentException("RGBA buffer too small");
        }
        if (width < 1 || height < 1 || x0 < 0 || y0 < 0 || x0 + width > framebufferWidth || y0 + height > framebufferHeight) {
            throw new IllegalArgumentException("invalid ROI");
        }
        return (x, y) -> {
            if (!Double.isFinite(x) || !Double.isFinite(y)) return 0;
            double px = Math.floor(x), py = Math.floor(y);
            if (px < x0 || py < y0 || px >= x0 + width || py >= y0 + height) return 0;
            int i = ((framebufferHeight - 1 - (int) py) * framebufferWidth + (int) px) * 4 + 3;
            return (rgba.get(i) & 255) / 255.0;
        };
    }

    @Override
    public double alpha(double x, double y) {
        if (Double.isNaN(x) || Double.isNaN(y) || Double.isInfinite(x) || Double.isInfinite(y)) {
            return 0.0;
        }
        double px = Math.floor(x) - x0;
        double py = Math.floor(y) - y0;
        if (px < 0 || py < 0 || px >= width || py >= height) {
            return 0.0;
        }
        return (alpha[(int) py * width + (int) px] & 0xFF) / 255.0;
    }
}
