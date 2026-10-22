package org.firecracking.hudinfo;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

/** The overlay disappeared for a whole session because the mixin gated on vanilla's shouldShowDebugHud(), which is
 *  also true with a pinned debug entry. The predicate takes only the three inputs that may hide it. */
class VisibilityTest {
    @Test void drawnInAWorldWithTheHudShownAndF3Closed() {
        assertTrue(Visibility.shouldDraw(true, false, false));
    }

    @Test void hiddenOnlyForNoPlayerHiddenHudOrOpenF3() {
        assertFalse(Visibility.shouldDraw(false, false, false), "title screen");
        assertFalse(Visibility.shouldDraw(true, true, false), "F1");
        assertFalse(Visibility.shouldDraw(true, false, true), "F3 screen");
    }
}
