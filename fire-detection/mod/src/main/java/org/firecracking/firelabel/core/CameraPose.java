package org.firecracking.firelabel.core;

/**
 * The camera a frame was rendered with, logged as the exact answer key for camera solvers: world position, the view
 * matrix (rotation incl. view bobbing / hurt tilt, row-major) and the projection (FOV incl. sprint/effect changes,
 * aspect, row-major). Block geometry projects as {@code proj * view * (world - pos)}.
 */
public final class CameraPose {
    private final double[] pos;
    private final double[] view;
    private final double[] proj;

    private CameraPose(double[] pos, double[] view, double[] proj) {
        this.pos = pos;
        this.view = view;
        this.proj = proj;
    }

    /** From {@link FrameCapture}'s arrays: view row-major, projection column-major. Copies; refuses bad input. */
    public static CameraPose fromCapture(double[] cameraWorld, double[] viewRowMajor, double[] projectionColumnMajor) {
        double[] p = checked(cameraWorld, 3, "camera position");
        double[] v = checked(viewRowMajor, 16, "view matrix");
        double[] pc = checked(projectionColumnMajor, 16, "projection matrix");
        double[] pr = new double[16];
        for (int r = 0; r < 4; r++) {
            for (int c = 0; c < 4; c++) {
                pr[r * 4 + c] = pc[c * 4 + r];
            }
        }
        return new CameraPose(p, v, pr);
    }

    private static double[] checked(double[] a, int n, String what) {
        if (a == null || a.length != n) {
            throw new IllegalArgumentException(what + " must have " + n + " elements");
        }
        for (double x : a) {
            if (!Double.isFinite(x)) {
                throw new IllegalArgumentException(what + " has a non-finite element");
            }
        }
        return a.clone();
    }

    /** {@code "cam":{"pos":[..],"view":[16 row-major],"proj":[16 row-major]}}, values round-trip exactly. */
    void appendJson(StringBuilder sb) {
        sb.append("\"cam\":{\"pos\":");
        array(sb, pos);
        sb.append(",\"view\":");
        array(sb, view);
        sb.append(",\"proj\":");
        array(sb, proj);
        sb.append('}');
    }

    private static void array(StringBuilder sb, double[] a) {
        sb.append('[');
        for (int i = 0; i < a.length; i++) {
            if (i > 0) {
                sb.append(',');
            }
            sb.append(Double.toString(a[i]));
        }
        sb.append(']');
    }
}
