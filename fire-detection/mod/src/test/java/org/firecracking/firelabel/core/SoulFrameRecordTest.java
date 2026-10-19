package org.firecracking.firelabel.core;

import static org.junit.jupiter.api.Assertions.*;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.junit.jupiter.api.Test;

class SoulFrameRecordTest {
    private static FireSourceLabel source(int row) {
        BBox box = new BBox();
        box.add(10, 20); box.add(30, 40);
        FirePart part = new FirePart(0, true, row, box, 4, 4);
        return FireSourceLabel.block(1, 2, 3, 5, Collections.singletonList(part));
    }

    @Test void soulDoesNotBecomeNormalFire() {
        FrameRecord r = new FrameRecord(1, 20, 18, 2, 1920, 1080, Collections.emptyList(),
                23, 7, Collections.singletonList(source(23)));
        assertFalse(r.fire());
        assertEquals(1, r.soulFires().size());
        String json = LabelLog.format(r);
        assertTrue(json.contains("\"fire\":false,\"fires\":[]"));
        assertTrue(json.contains("\"s0\":23,\"s1\":7,\"soul\":true,\"soul_fires\":["));
        assertTrue(json.contains("\"row\":23"));
    }

    @Test void mixedFrameKeepsIndependentAnimationRows() {
        FrameRecord r = new FrameRecord(1, 20, 18, 2, 1920, 1080, Collections.singletonList(source(18)),
                23, 7, Collections.singletonList(source(23)));
        assertTrue(r.fire());
        assertEquals(18, r.fires().get(0).parts().get(0).row);
        assertEquals(23, r.soulFires().get(0).parts().get(0).row);
        assertTrue(LabelLog.format(r).contains("\"soul\":true"));
    }

    @Test void soulQuadPreservesItsGeometryAndMirror() {
        double[][] corners = {{10, 20}, {30, 20}, {30, 40}, {10, 40}};
        double[][] uv = {{1, 0}, {0, 0}, {0, 1}, {1, 1}};
        FireQuadLabel quad = new FireQuadLabel(0, true, 23, corners, uv, 4, 4, .5);
        FireSourceLabel base = source(23);
        FireSourceLabel soul = FireSourceLabel.block(1, 2, 3, 5, base.parts(), Collections.singletonList(quad));
        FrameRecord r = new FrameRecord(1, 20, 18, 2, 1920, 1080, Collections.emptyList(), 23, 7, Collections.singletonList(soul));
        String json = LabelLog.format(r);
        assertTrue(json.contains("\"quads\":[{\"s\":0,\"m\":1,\"row\":23,\"c\":[10.0,20.0,30.0,20.0,30.0,40.0,10.0,40.0]"));
        assertTrue(json.contains("\"uv\":[1.000,0.000,0.000,0.000,0.000,1.000,1.000,1.000]"));
        assertTrue(json.contains("\"veil\":0.500"));
    }

    @Test void soulSourcesAreDefensivelyCopied() {
        List<FireSourceLabel> sources = new ArrayList<>(); sources.add(source(23));
        FrameRecord r = new FrameRecord(1, 20, 18, 2, 1920, 1080, Collections.emptyList(), 23, 7, sources);
        sources.clear(); assertEquals(1, r.soulFires().size());
        assertThrows(UnsupportedOperationException.class, () -> r.soulFires().clear());
    }

    @Test void recordedEmptySoulIsDistinguishableFromOldUnsupportedLog() {
        FrameRecord old = new FrameRecord(1, 20, 18, 2, 1920, 1080, Collections.emptyList());
        FrameRecord current = new FrameRecord(1, 20, 18, 2, 1920, 1080, Collections.emptyList(), 23, 7, Collections.emptyList());
        assertFalse(LabelLog.format(old).contains("soul"));
        assertTrue(LabelLog.format(current).contains("\"soul\":false,\"soul_fires\":[]"));
    }
}
