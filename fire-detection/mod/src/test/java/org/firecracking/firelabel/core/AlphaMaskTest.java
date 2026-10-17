package org.firecracking.firelabel.core;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;

/** The GUI alpha around a fire, read back from OpenGL (rows bottom-up, bytes signed), as 0..1 coverage. */
class AlphaMaskTest {

    private static byte[] filled(int n, int value) {
        byte[] b = new byte[n];
        java.util.Arrays.fill(b, (byte) value);
        return b;
    }

    // ---------- basics ----------

    @Test
    void alphaIsTheByteValueAsAFractionOf255() {
        byte[] a = {0, 51, 127, (byte) 128, (byte) 200, (byte) 255};
        AlphaMask m = new AlphaMask(0, 0, 6, 1, a);
        int[] expect = {0, 51, 127, 128, 200, 255};
        for (int x = 0; x < 6; x++) {
            assertEquals(expect[x] / 255.0, m.alpha(x + 0.5, 0.5), 1e-12, "x=" + x);
        }
    }

    @Test
    void bytesAreReadAsUnsigned() {
        AlphaMask m = new AlphaMask(0, 0, 1, 1, new byte[] {(byte) 200});
        assertEquals(200 / 255.0, m.alpha(0.5, 0.5), 1e-12); // not -56 / 255
    }

    @Test
    void theRegionOffsetIsApplied() {
        // 3 wide, 2 tall region whose top-left pixel is screen (100, 50); only its pixel (1, 1) is opaque
        byte[] a = new byte[6];
        a[1 * 3 + 1] = (byte) 255;
        AlphaMask m = new AlphaMask(100, 50, 3, 2, a);
        assertEquals(1.0, m.alpha(101.5, 51.5), 1e-12);
        assertEquals(0.0, m.alpha(100.5, 50.5));
        assertEquals(0.0, m.alpha(101.5, 50.5));
        assertEquals(0.0, m.alpha(102.5, 51.5));
    }

    @Test
    void fractionalCoordinatesUseTheirPixel() {
        byte[] a = {0, (byte) 255};
        AlphaMask m = new AlphaMask(10, 20, 2, 1, a);
        assertEquals(0.0, m.alpha(10.0, 20.0));
        assertEquals(0.0, m.alpha(10.99, 20.99));
        assertEquals(1.0, m.alpha(11.0, 20.0), 1e-12);
        assertEquals(1.0, m.alpha(11.99, 20.5), 1e-12);
    }

    @Test
    void openGlRowsAreFlippedBottomUpToTopDown() {
        // glReadPixels returns the BOTTOM row first. Region: 3 wide, 2 tall, its top row is screen y = 40.
        byte[] bottomUp = {10, 20, 30, (byte) 200, (byte) 210, (byte) 220};
        AlphaMask m = AlphaMask.fromBottomUpRows(5, 40, 3, 2, bottomUp);
        for (int x = 5; x < 8; x++) {
            assertTrue(m.alpha(x + 0.5, 40.5) > 0.7, "top row (screen y 40) holds the 200s: x=" + x);
            assertTrue(m.alpha(x + 0.5, 41.5) < 0.2, "bottom row (screen y 41) holds the 10..30: x=" + x);
        }
        assertEquals(200 / 255.0, m.alpha(5.5, 40.5), 1e-12);
        assertEquals(30 / 255.0, m.alpha(7.5, 41.5), 1e-12);
    }

    // ---------- failures: never an exception, never covered by accident ----------

    @Test
    void outsideTheRegionIsUncovered() {
        AlphaMask m = new AlphaMask(10, 10, 2, 2, filled(4, 255));
        assertEquals(1.0, m.alpha(10.5, 10.5), 1e-12);
        assertEquals(0.0, m.alpha(9.99, 10.5));
        assertEquals(0.0, m.alpha(12.0, 10.5));
        assertEquals(0.0, m.alpha(10.5, 9.0));
        assertEquals(0.0, m.alpha(10.5, 12.0));
        assertEquals(0.0, m.alpha(-5, -5));
        assertEquals(0.0, m.alpha(1e9, 1e9));
    }

    @Test
    void nonFiniteCoordinatesAreUncovered() {
        AlphaMask m = new AlphaMask(0, 0, 2, 2, filled(4, 255));
        assertEquals(0.0, m.alpha(Double.NaN, 0.5));
        assertEquals(0.0, m.alpha(0.5, Double.POSITIVE_INFINITY));
    }

    @Test
    void invalidConstructionIsRejected() {
        assertThrows(IllegalArgumentException.class, () -> new AlphaMask(0, 0, 3, 2, new byte[5]));
        assertThrows(IllegalArgumentException.class, () -> new AlphaMask(0, 0, 0, 2, new byte[0]));
        assertThrows(IllegalArgumentException.class, () -> new AlphaMask(0, 0, 2, -1, new byte[0]));
        assertThrows(IllegalArgumentException.class, () -> new AlphaMask(0, 0, 1, 1, null));
        assertThrows(IllegalArgumentException.class, () -> AlphaMask.fromBottomUpRows(0, 0, 3, 2, new byte[5]));
    }

    @Test
    void theInputArrayIsCopied() {
        byte[] a = {(byte) 255};
        AlphaMask m = new AlphaMask(0, 0, 1, 1, a);
        a[0] = 0;
        assertEquals(1.0, m.alpha(0.5, 0.5), 1e-12);
    }

    @org.junit.jupiter.api.Test
    void sharedRgbaViewMatchesOldRegionCopyAtEverySample() {
        int w=5,h=4;java.nio.ByteBuffer rgba=java.nio.ByteBuffer.allocate(w*h*4);
        for(int y=0;y<h;y++)for(int x=0;x<w;x++)rgba.put(((h-1-y)*w+x)*4+3,(byte)(x*29+y*13));
        byte[] region=new byte[3*2];for(int y=0;y<2;y++)for(int x=0;x<3;x++)region[y*3+x]=(byte)((x+1)*29+(y+1)*13);
        AlphaMask old=new AlphaMask(1,1,3,2,region);
        ScreenMask view=AlphaMask.rgbaView(rgba,w,h,1,1,3,2);
        for(double y=-1;y<6;y+=.25)for(double x=-1;x<7;x+=.25)assertEquals(old.alpha(x,y),view.alpha(x,y));
        assertEquals(0,view.alpha(Double.NaN,0));assertEquals(0,view.alpha(0,Double.POSITIVE_INFINITY));
    }
}
