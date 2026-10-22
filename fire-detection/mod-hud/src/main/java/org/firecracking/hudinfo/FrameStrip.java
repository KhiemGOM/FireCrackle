package org.firecracking.hudinfo;

/** 16-bit fixed preamble + 32-bit renderer ID + CRC16, MSB-first Manchester cells. Same encoding as mod-gui's
 *  strip ("gui-v1"), so one decoder reads both recordings. */
public final class FrameStrip {
    public static final int CELLS = 128;
    private FrameStrip() {}
    public static int crc(long frame) {
        int crc = 0xffff;
        for (int shift = 24; shift >= 0; shift -= 8) {
            crc ^= ((frame >>> shift) & 255) << 8;
            for (int bit = 0; bit < 8; bit++) crc = ((crc & 0x8000) != 0 ? (crc << 1) ^ 0x1021 : crc << 1) & 0xffff;
        }
        return crc;
    }
    public static boolean white(long frame, int cell) {
        if (cell < 0 || cell >= CELLS) throw new IllegalArgumentException("strip cell");
        int bit = cell / 2;
        boolean value;
        if (bit < 16) value = ((0xd3a5 >>> (15 - bit)) & 1) != 0;
        else if (bit < 48) value = ((frame >>> (47 - bit)) & 1) != 0;
        else value = ((crc(frame) >>> (63 - bit)) & 1) != 0;
        return cell % 2 == 0 ? value : !value;
    }
}
