package org.firecracking.firelabel.core;

import static org.junit.jupiter.api.Assertions.*;

import java.util.Collections;
import org.junit.jupiter.api.Test;

/**
 * The camera of every labelled frame, logged as an exact answer key for camera solvers (perspective reversal).
 * Ways this breaks: rows without a captured world must stay byte-identical to the old schema; matrices of the wrong
 * size or with NaN/infinite entries must be refused rather than written as invalid JSON; values must round-trip
 * exactly (no fixed-decimal rounding); the view matrix is logged row-major and so is the projection, whatever order
 * the capture stored it in.
 */
class CameraPoseTest {
    private static final double[] POS = {-91.5, 81.62, 130.25};
    private static final double[] VIEW = {
        0.8660254037844387, 0, -0.5, 0,
        -0.1, 0.98, -0.17, 0,
        0.49, 0.2, 0.85, 0,
        0, 0, 0, 1,
    };
    // a GL perspective, column-major as FrameCapture stores worldProjection
    private static final double[] PROJ_COLUMN_MAJOR = {
        0.8034, 0, 0, 0,
        0, 1.4281480067421146, 0, 0,
        0, 0, -1.0001, -1,
        0, 0, -0.10001, 0,
    };

    @Test
    void a_row_without_a_camera_is_unchanged() {
        String json = LabelLog.format(new FrameRecord(1, 2L, 3, 4, 2560, 1369, Collections.<FireSourceLabel>emptyList()));
        assertEquals("{\"f\":1,\"tick\":2,\"f0\":3,\"f1\":4,\"w\":2560,\"h\":1369,\"fire\":false,\"fires\":[]}", json);
    }

    @Test
    void the_camera_is_written_with_exact_values_and_row_major_matrices() {
        CameraPose cam = CameraPose.fromCapture(POS, VIEW, PROJ_COLUMN_MAJOR);
        FrameRecord r = new FrameRecord(1, 2L, 3, 4, 2560, 1369, Collections.<FireSourceLabel>emptyList()).withCamera(cam);
        String json = LabelLog.format(r);
        assertTrue(json.endsWith(",\"fires\":[],\"cam\":{\"pos\":[-91.5,81.62,130.25],"
                + "\"view\":[0.8660254037844387,0.0,-0.5,0.0,-0.1,0.98,-0.17,0.0,0.49,0.2,0.85,0.0,0.0,0.0,0.0,1.0],"
                + "\"proj\":[0.8034,0.0,0.0,0.0,0.0,1.4281480067421146,0.0,0.0,0.0,0.0,-1.0001,-0.10001,0.0,0.0,-1.0,0.0]}}"), json);
        // the record's other fields are kept
        assertEquals(1, r.frameId);
        assertEquals(2560, r.width);
        assertSame(cam, r.camera);
    }

    @Test
    void a_soul_row_keeps_its_fields_and_gets_the_camera_last() {
        FrameRecord soul = new FrameRecord(7, 8L, 1, 2, 100, 50, Collections.<FireSourceLabel>emptyList(), 5, 6,
                Collections.<FireSourceLabel>emptyList());
        String json = LabelLog.format(soul.withCamera(CameraPose.fromCapture(POS, VIEW, PROJ_COLUMN_MAJOR)));
        assertTrue(json.contains(",\"s0\":5,\"s1\":6,\"soul\":false,\"soul_fires\":[],\"cam\":{"), json);
    }

    @Test
    void bad_camera_data_is_refused() {
        assertThrows(IllegalArgumentException.class, () -> CameraPose.fromCapture(new double[] {1, 2}, VIEW, PROJ_COLUMN_MAJOR));
        assertThrows(IllegalArgumentException.class, () -> CameraPose.fromCapture(POS, new double[15], PROJ_COLUMN_MAJOR));
        assertThrows(IllegalArgumentException.class, () -> CameraPose.fromCapture(POS, VIEW, new double[17]));
        assertThrows(IllegalArgumentException.class, () -> CameraPose.fromCapture(null, VIEW, PROJ_COLUMN_MAJOR));
        double[] nan = VIEW.clone();
        nan[5] = Double.NaN;
        assertThrows(IllegalArgumentException.class, () -> CameraPose.fromCapture(POS, nan, PROJ_COLUMN_MAJOR));
        double[] inf = POS.clone();
        inf[1] = Double.POSITIVE_INFINITY;
        assertThrows(IllegalArgumentException.class, () -> CameraPose.fromCapture(inf, VIEW, PROJ_COLUMN_MAJOR));
    }

    @Test
    void the_inputs_are_copied() {
        double[] pos = POS.clone();
        CameraPose cam = CameraPose.fromCapture(pos, VIEW, PROJ_COLUMN_MAJOR);
        pos[0] = 999;
        String json = LabelLog.format(new FrameRecord(1, 2L, 3, 4, 10, 10, Collections.<FireSourceLabel>emptyList()).withCamera(cam));
        assertTrue(json.contains("\"pos\":[-91.5,"), json);
    }
}
