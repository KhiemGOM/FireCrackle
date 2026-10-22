package org.firecracking.hudinfo;

import java.util.Locale;

/** The overlay line, in the layout seen in the reference footage:
 *  {@code XYZ: x / y / z | Yaw: a Pitch: b | Direction: d | FPS: n}. Pure so it can be tested without the game. */
public final class HudText {
    private HudText() {}

    public static String line(double x, double y, double z, float yaw, float pitch, String direction, int fps) {
        return String.format(Locale.ROOT, "XYZ: %.3f / %.3f / %.3f | Yaw: %.1f Pitch: %.1f | Direction: %s | FPS: %d",
            x, y, z, wrapDegrees(yaw), pitch, direction, fps);
    }

    /** Yaw as the game reports it in F3: wrapped to [-180, 180). */
    static float wrapDegrees(float degrees) {
        float d = degrees % 360.0f;
        if (d >= 180.0f) d -= 360.0f;
        if (d < -180.0f) d += 360.0f;
        return d;
    }
}
