package org.firecracking.hudinfo;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

/** The strip must be byte-identical to mod-gui's (one decoder for both), Manchester (every cell pair has opposite
 *  polarity, so a dropped or duplicated video frame can never produce a valid-looking strip by accident), and the
 *  CRC must separate neighbouring IDs. */
class FrameStripTest {
    @Test void stripRoundTripsAndEveryPairHasOppositePolarity() {
        for (long id : new long[]{0, 1, 42, 65535, 0xdeadbeefL, 0xffffffffL}) {
            long decoded = 0;
            int preamble = 0, crc = 0;
            for (int bit = 0; bit < 64; bit++) {
                assertNotEquals(FrameStrip.white(id, 2 * bit), FrameStrip.white(id, 2 * bit + 1));
                int v = FrameStrip.white(id, 2 * bit) ? 1 : 0;
                if (bit < 16) preamble = (preamble << 1) | v;
                else if (bit < 48) decoded = (decoded << 1) | v;
                else crc = (crc << 1) | v;
            }
            assertEquals(0xd3a5, preamble);
            assertEquals(id, decoded);
            assertEquals(FrameStrip.crc(id), crc);
        }
        assertNotEquals(FrameStrip.crc(42), FrameStrip.crc(43));
    }

    @Test void crcIsCcittFalseOfTheFourIdBytes() {
        // CRC-16/CCITT-FALSE of 00 00 00 00 is 0x84C0; of "1234" (0x31323334) is 0x5349
        assertEquals(0x84c0, FrameStrip.crc(0));
        assertEquals(0x5349, FrameStrip.crc(0x31323334L));
    }
}
