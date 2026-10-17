package org.firecracking.firelabel.ownership;

import static org.junit.jupiter.api.Assertions.*;
import java.awt.image.BufferedImage;
import java.nio.ByteBuffer;
import java.nio.file.Path;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class OwnershipPngTest {
    @TempDir Path directory;
    @Test void losslessIdsIncludingLowAlphaAndTopLeftOrigin() throws Exception {
        ByteBuffer pixels=ByteBuffer.allocateDirect(16);
        pixels.put(new byte[]{1,2,3,1, 7,8,9,2, 10,11,12,0, -1,-1,-1,-1});
        Path file=directory.resolve("ids.png");OwnershipExport.writePng(file,pixels,2,2,false);
        BufferedImage image=ImageIO.read(file.toFile());
        assertEquals(0x000a0b0c,image.getRGB(0,0));assertEquals(0xffffffff,image.getRGB(1,0));
        assertEquals(0x01010203,image.getRGB(0,1));assertEquals(0x02070809,image.getRGB(1,1));
    }
    @Test void rgbExportIsOpaqueWithoutChangingColour() throws Exception {
        ByteBuffer pixels=ByteBuffer.allocateDirect(4);pixels.put(new byte[]{42,43,44,0});
        Path file=directory.resolve("rgb.png");OwnershipExport.writePng(file,pixels,1,1,true);
        assertEquals(0xff2a2b2c,ImageIO.read(file.toFile()).getRGB(0,0));
    }
}
