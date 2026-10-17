package org.firecracking.firelabel.core;

/**
 * Projects camera-relative points to framebuffer pixels with a combined projection * view matrix.
 * Matrix is OpenGL-style column-major (element at row r, column c is {@code m[c * 4 + r]}).
 * Pixel origin is the TOP-left, like the video and the sync strip.
 */
public final class Projector {
    private static final double MIN_W = 1e-9;

    private final double[] m;
    private final int width;
    private final int height;

    public Projector(double[] mvpColumnMajor, int width, int height) {
        if (mvpColumnMajor == null || mvpColumnMajor.length != 16) {
            throw new IllegalArgumentException("matrix must have 16 elements");
        }
        if (width <= 0 || height <= 0) {
            throw new IllegalArgumentException("size must be positive: " + width + "x" + height);
        }
        this.m = mvpColumnMajor.clone();
        this.width = width;
        this.height = height;
    }

    public int width() {
        return width;
    }

    public int height() {
        return height;
    }

    /** {@code {pixelX, pixelY, ndcDepth}}, or null if the point is behind or on the camera plane. */
    public double[] project(double x, double y, double z) {
        double[] out = new double[3];
        return projectInto(x, y, z, out) ? out : null;
    }

    /** Same projection without allocating a result array for each texel corner. */
    public boolean projectInto(double x, double y, double z, double[] out) {
        if (Double.isNaN(x) || Double.isNaN(y) || Double.isNaN(z)
                || Double.isInfinite(x) || Double.isInfinite(y) || Double.isInfinite(z)) {
            return false;
        }
        double cw = m[3] * x + m[7] * y + m[11] * z + m[15];
        if (!(cw > MIN_W)) {
            return false;
        }
        double cx = m[0] * x + m[4] * y + m[8] * z + m[12];
        double cy = m[1] * x + m[5] * y + m[9] * z + m[13];
        double cz = m[2] * x + m[6] * y + m[10] * z + m[14];
        double ndcX = cx / cw;
        double ndcY = cy / cw;
        double ndcZ = cz / cw;
        out[0] = (ndcX * 0.5 + 0.5) * width;
        out[1] = (0.5 - ndcY * 0.5) * height;
        out[2] = ndcZ;
        return true;
    }
}
