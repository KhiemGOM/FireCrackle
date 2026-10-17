package org.firecracking.firelabel.core;

/**
 * Works out which texels of a quad are actually visible this frame: opaque in the displayed sprite
 * frame, in front of the camera, on screen, and not behind an occluder. The box is the union of the
 * projected cells of those texels, so it hugs the visible flame rather than the whole plane.
 */
public final class QuadVisibility {
    private static final double EPS = 1e-9;

    private QuadVisibility() {}

    public static final class Result {
        /** Opaque texels the quad covers, whether or not they can be seen (denominator of "vis"). */
        public int opaqueTexels;
        /** Opaque texels that are on screen and not occluded. */
        public int visibleTexels;
        /** Union of the visible texels' projected cells, clamped to the screen; empty if none visible. */
        public final BBox box = new BBox();
        /** Sum over the visible texels of the GUI alpha over them (translucent veils; see {@link #meanVeil()}). */
        public double veilSum;

        /** Mean GUI alpha over the visible texels: 0 = nothing over them, 0.75 = a 75% dark veil. */
        public double meanVeil() {
            return visibleTexels > 0 ? veilSum / visibleTexels : 0.0;
        }
    }

    /** GUI alpha at or above this hides what is behind it; anything less is a veil that is reported, not removed. */
    static final double GUI_OPAQUE = 0.98;

    /**
     * @param texels sprite size in texels (16 for fire)
     * @param macro  occlusion is tested once per macro x macro block of texels (cached)
     */
    public static Result evaluate(
            Quad q, double[] cam, Projector projector, int texels, TexelMask mask, Occluder occluder, int macro) {
        return evaluate(q, cam, projector, texels, mask, occluder, macro, true);
    }

    /**
     * @param cullBackFaces true for block fire (cutout layer with face culling); false for entity fire and the
     *                      first-person overlay, which face the camera by construction
     */
    public static Result evaluate(
            Quad q,
            double[] cam,
            Projector projector,
            int texels,
            TexelMask mask,
            Occluder occluder,
            int macro,
            boolean cullBackFaces) {
        return evaluate(q, cam, projector, texels, mask, occluder, macro, cullBackFaces, null);
    }

    /**
     * @param gui what the GUI really drew over the world (framebuffer alpha), or null for none. A texel cell is
     *            hidden when at least 5 of 9 sample points in its on-screen box have alpha >= {@link #GUI_OPAQUE}
     *            (hidden cells cost no ray); otherwise it stays visible and its mean alpha is added to the veil
     */
    public static Result evaluate(
            Quad q,
            double[] cam,
            Projector projector,
            int texels,
            TexelMask mask,
            Occluder occluder,
            int macro,
            boolean cullBackFaces,
            ScreenMask gui) {
        if (texels < 1) {
            throw new IllegalArgumentException("texels must be >= 1: " + texels);
        }
        if (macro < 1) {
            throw new IllegalArgumentException("macro must be >= 1: " + macro);
        }
        Result res = new Result();

        double[] v0 = q.v[0];
        double[] e1 = {q.v[1][0] - v0[0], q.v[1][1] - v0[1], q.v[1][2] - v0[2]};
        double[] e3 = {q.v[3][0] - v0[0], q.v[3][1] - v0[1], q.v[3][2] - v0[2]};
        double u0 = q.uv[0][0];
        double w0 = q.uv[0][1];
        double a = q.uv[1][0] - u0;
        double b = q.uv[3][0] - u0;
        double c = q.uv[1][1] - w0;
        double d = q.uv[3][1] - w0;
        double det = a * d - b * c;
        if (Double.isNaN(det) || Math.abs(det) < 1e-12) {
            return res; // degenerate UV map: nothing to show
        }

        boolean frontFacing = q.isFrontFacing(cam);
        int cells = (texels + macro - 1) / macro;
        byte[] cache = new byte[cells * cells]; // 0 unknown, 1 visible, 2 blocked
        double half = 0.5 / texels;
        double[] point = new double[3];
        double[] rel = new double[3];
        double[] projected = new double[3];

        for (int ty = 0; ty < texels; ty++) {
            for (int tx = 0; tx < texels; tx++) {
                if (!mask.opaque(tx, ty)) {
                    continue;
                }
                double cu = (tx + 0.5) / texels;
                double cv = (ty + 0.5) / texels;
                double s = ((cu - u0) * d - b * (cv - w0)) / det;
                double t = (a * (cv - w0) - c * (cu - u0)) / det;
                if (s < -EPS || s > 1 + EPS || t < -EPS || t > 1 + EPS) {
                    continue; // texel is not covered by this quad
                }
                res.opaqueTexels++;
                if (cullBackFaces && !frontFacing) {
                    continue; // drawn in a back-face-culling layer: not visible from this side
                }

                // project the four corners of this texel's cell
                double minX = Double.POSITIVE_INFINITY;
                double minY = Double.POSITIVE_INFINITY;
                double maxX = Double.NEGATIVE_INFINITY;
                double maxY = Double.NEGATIVE_INFINITY;
                boolean ok = true;
                for (int k = 0; k < 4 && ok; k++) {
                    double u = cu + ((k & 1) == 0 ? -half : half);
                    double v = cv + ((k & 2) == 0 ? -half : half);
                    double ss = ((u - u0) * d - b * (v - w0)) / det;
                    double tt = (a * (v - w0) - c * (u - u0)) / det;
                    boolean projectedOk = projector.projectInto(
                            v0[0] + ss * e1[0] + tt * e3[0] - cam[0],
                            v0[1] + ss * e1[1] + tt * e3[1] - cam[1],
                            v0[2] + ss * e1[2] + tt * e3[2] - cam[2], projected);
                    if (!projectedOk) {
                        ok = false;
                    } else {
                        minX = Math.min(minX, projected[0]);
                        maxX = Math.max(maxX, projected[0]);
                        minY = Math.min(minY, projected[1]);
                        maxY = Math.max(maxY, projected[1]);
                    }
                }
                if (!ok || maxX - minX < EPS || maxY - minY < EPS) {
                    continue; // partly behind the camera, or zero area
                }
                if (!Double.isFinite(minX) || !Double.isFinite(minY) || !Double.isFinite(maxX) || !Double.isFinite(maxY)) {
                    throw new IllegalArgumentException("non-finite projected cell");
                }
                double x0 = Math.max(minX, 0), y0 = Math.max(minY, 0);
                double x1 = Math.min(maxX, projectorWidth(projector)), y1 = Math.min(maxY, projectorHeight(projector));
                if (x0 > x1 || y0 > y1 || x1 - x0 < EPS || y1 - y0 < EPS) {
                    continue; // outside the frame
                }

                // The GUI is drawn over the world. An opaque GUI hides the cell (checked before any ray cast); a
                // translucent one leaves it visible and is recorded as a veil.
                double veil = 0.0;
                if (gui != null) {
                    veil = guiVeil(gui, x0, y0, x1, y1);
                    if (veil < 0) {
                        continue;
                    }
                }

                // occlusion, once per macro cell
                int ci = (ty / macro) * cells + (tx / macro);
                if (cache[ci] == 0) {
                    int mx = tx / macro;
                    int my = ty / macro;
                    int wCells = Math.min(macro, texels - mx * macro);
                    int hCells = Math.min(macro, texels - my * macro);
                    double mu = (mx * macro + wCells / 2.0) / texels;
                    double mv = (my * macro + hCells / 2.0) / texels;
                    double ms = ((mu - u0) * d - b * (mv - w0)) / det;
                    double mt = (a * (mv - w0) - c * (mu - u0)) / det;
                    point[0] = v0[0] + ms * e1[0] + mt * e3[0];
                    point[1] = v0[1] + ms * e1[1] + mt * e3[1];
                    point[2] = v0[2] + ms * e1[2] + mt * e3[2];
                    rel[0] = cam[0];
                    rel[1] = cam[1];
                    rel[2] = cam[2];
                    cache[ci] = (byte) (occluder.blocked(rel, point) ? 2 : 1);
                }
                if (cache[ci] == 2) {
                    continue;
                }

                res.box.add(x0, y0);
                res.box.add(x1, y1);
                res.visibleTexels++;
                res.veilSum += veil;
            }
        }
        return res;
    }

    /**
     * 3x3 samples inside the box (at 1/6, 1/2, 5/6). Returns -1 if at least 5 of the 9 are opaque (the cell is
     * hidden), otherwise the mean GUI alpha of the nine samples (the veil over the cell, 0 when nothing is over it).
     */
    private static double guiVeil(ScreenMask gui, double x0, double y0, double x1, double y1) {
        int opaque = 0;
        double sum = 0.0;
        for (int iy = 0; iy < 3; iy++) {
            double y = y0 + (y1 - y0) * (2 * iy + 1) / 6.0;
            for (int ix = 0; ix < 3; ix++) {
                double x = x0 + (x1 - x0) * (2 * ix + 1) / 6.0;
                double a = gui.alpha(x, y);
                if (Double.isNaN(a) || a < 0.0) {
                    a = 0.0;
                } else if (a > 1.0) {
                    a = 1.0;
                }
                sum += a;
                if (a >= GUI_OPAQUE) {
                    opaque++;
                }
            }
        }
        return opaque >= 5 ? -1.0 : sum / 9.0;
    }

    private static double projectorWidth(Projector p) {
        return p.width();
    }

    private static double projectorHeight(Projector p) {
        return p.height();
    }
}
