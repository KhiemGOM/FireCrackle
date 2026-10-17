package org.firecracking.firelabel;

import java.nio.FloatBuffer;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.util.math.Matrix4f;
import net.minecraft.util.math.Vec3d;
import org.firecracking.firelabel.core.Matrices;
import org.firecracking.firelabel.core.Quad;

/**
 * Everything the render passes of the current frame tell us, gathered by mixins and consumed once by the labeler.
 * Render thread only. The world is drawn camera-relative, so block geometry is passed to the projector as
 * (world - camera); entity fire and the overlay are captured directly in view space.
 */
public final class FrameCapture {

    /** One quad of entity fire, in view space. */
    static final class EntityFireQuad {
        final int entityId;
        final String entityType;
        final int sheet;
        final Quad quad;

        EntityFireQuad(int entityId, String entityType, int sheet, Quad quad) {
            this.entityId = entityId;
            this.entityType = entityType;
            this.sheet = sheet;
            this.quad = quad;
        }
    }

    /** What the labeler gets for one frame. */
    static final class Frame {
        double[] worldMvp; // projection * view, column-major, for camera-relative block geometry
        double[] worldProjection; // projection only, column-major, for view-space geometry
        double[] worldView; // view matrix, row-major
        double[] camera;
        List<EntityFireQuad> entityQuads = new ArrayList<EntityFireQuad>();
        double[] overlayModel; // hand matrix at the fire overlay call, row-major, or null
        double[] overlayProjection; // projection in effect then, column-major, or null
    }

    private static Frame frame; // null until a world pass has run this frame
    private static boolean worldArmed;
    private static double[] currentProjectionRowMajor;
    private static double[] overlayModel;
    private static double[] overlayProjection;

    private FrameCapture() {}

    /** Start of the world pass: records the matrices and arms entity fire capture. */
    public static void beginWorld(Matrix4f view, Matrix4f projection, Vec3d cam) {
        if (!FireLabel.usesLegacyLabels()) return;
        double[] v = rowMajor(view);
        double[] p = rowMajor(projection);
        double[] mvp = new double[16];
        for (int r = 0; r < 4; r++) {
            for (int c = 0; c < 4; c++) {
                double sum = 0;
                for (int k = 0; k < 4; k++) {
                    sum += p[r * 4 + k] * v[k * 4 + c]; // (P * V)[r][c], row-major
                }
                mvp[c * 4 + r] = sum; // stored column-major for Projector
            }
        }
        Frame f = new Frame();
        f.worldMvp = mvp;
        f.worldProjection = transpose(p);
        f.worldView = v;
        f.camera = new double[] {cam.x, cam.y, cam.z};
        frame = f;
        worldArmed = true;
    }

    /** End of the world pass: later entity renders (inventory preview, GUI) are not captured. */
    public static void endWorld() {
        worldArmed = false;
    }

    public static boolean isWorldArmed() {
        return worldArmed;
    }

    static void addEntityQuad(int entityId, String entityType, int sheet, Quad quad) {
        if (frame != null && worldArmed) {
            frame.entityQuads.add(new EntityFireQuad(entityId, entityType, sheet, quad));
        }
    }

    /** Called whenever GameRenderer loads a projection matrix: remember which one is in effect. */
    public static void noteProjection(Matrix4f projection) {
        if (!FireLabel.usesLegacyLabels()) return;
        currentProjectionRowMajor = rowMajor(projection);
    }

    /** Called at the start of the first-person fire overlay draw with the matrix it starts from. */
    public static void captureOverlay(Matrix4f model) {
        if (!FireLabel.usesLegacyLabels()) return;
        overlayModel = rowMajor(model);
        overlayProjection = currentProjectionRowMajor == null ? null : transpose(currentProjectionRowMajor);
    }

    /** The frame's captured data, or null if no world pass ran since the last call. Clears everything. */
    static Frame take() {
        Frame f = frame;
        frame = null;
        if (f != null && overlayModel != null && overlayProjection != null) {
            f.overlayModel = overlayModel;
            f.overlayProjection = overlayProjection;
        }
        overlayModel = null;
        overlayProjection = null;
        return f;
    }

    private static double[] transpose(double[] m) {
        return Matrices.transpose(m);
    }

    /**
     * True row-major copy of a game matrix. Despite its name, {@code writeRowFirst} writes the OpenGL
     * column-major order (found in the first in-game run, see MatricesTest), so it must be transposed.
     */
    private static double[] rowMajor(Matrix4f m) {
        FloatBuffer buf = FloatBuffer.allocate(16);
        m.writeRowFirst(buf);
        float[] raw = new float[16];
        for (int i = 0; i < 16; i++) {
            raw[i] = buf.get(i);
        }
        return Matrices.rowMajorFromGameBuffer(raw);
    }
}
