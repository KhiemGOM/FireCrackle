package org.firecracking.hudinfo;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

/** Plan: the FPS field must be last and an integer (the cadence reader anchors on "FPS: " then reads digits);
 *  negative coordinates keep their sign; yaw wraps like F3 (both directions, and exactly 180 becomes -180);
 *  formatting must not depend on the system locale (a comma decimal separator would break the reader). */
class HudTextTest {
    @Test void fpsIsTheLastFieldAsAnInteger() {
        String s = HudText.line(2340.293, -24.99866, 838.915, 104.8f, 21.8f, "west", 146);
        assertEquals("XYZ: 2340.293 / -24.999 / 838.915 | Yaw: 104.8 Pitch: 21.8 | Direction: west | FPS: 146", s);
        assertTrue(s.endsWith("FPS: 146"));
    }

    @Test void yawWrapsLikeF3() {
        assertEquals(-170.0f, HudText.wrapDegrees(190.0f));
        assertEquals(170.0f, HudText.wrapDegrees(-190.0f));
        assertEquals(-180.0f, HudText.wrapDegrees(180.0f));
        assertEquals(0.0f, HudText.wrapDegrees(720.0f));
    }

    @Test void formattingIgnoresTheSystemLocale() {
        java.util.Locale saved = java.util.Locale.getDefault();
        try {
            java.util.Locale.setDefault(java.util.Locale.GERMANY);
            assertTrue(HudText.line(1.5, 2.5, 3.5, 0, 0, "north", 7).contains("1.500 / 2.500 / 3.500"));
        } finally {
            java.util.Locale.setDefault(saved);
        }
    }
}
