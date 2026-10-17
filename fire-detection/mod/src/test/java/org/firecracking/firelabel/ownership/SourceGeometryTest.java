package org.firecracking.firelabel.ownership;

import static org.junit.jupiter.api.Assertions.*;
import java.nio.*;
import java.util.List;
import org.junit.jupiter.api.Test;

class SourceGeometryTest {
    private static final float[] A={.1f,.2f,.2f,.3f},B={.6f,.7f,.7f,.8f};
    private static ByteBuffer data(){
        ByteBuffer b=ByteBuffer.allocateDirect(8+8*32).order(ByteOrder.nativeOrder());b.position(8);
        for(int v=0;v<8;v++){
            int o=8+v*32;b.putFloat(o,v);b.putFloat(o+4,v+1);b.putFloat(o+8,v+2);
            b.putFloat(o+16,v<4?(v%2==0?.1f:.2f):.95f);b.putFloat(o+20,v<4?.25f:.95f);
        }
        return b;
    }
    @Test void readsOnlyFireAndPreservesSource(){
        ByteBuffer b=data();int position=b.position(),limit=b.limit();ByteOrder order=b.order();
        List<SourceGeometry.FireQuad> q=SourceGeometry.read(b,32,0,16,8,A,B);
        assertEquals(1,q.size());assertEquals(0,q.get(0).index);assertEquals(0,q.get(0).sheet);
        assertArrayEquals(new float[]{0,1,2,1,2,3,2,3,4,3,4,5},q.get(0).positions);
        assertEquals(0,q.get(0).uv[0],1e-6);assertEquals(1,q.get(0).uv[2],1e-6);
        assertEquals(position,b.position());assertEquals(limit,b.limit());assertEquals(order,b.order());
        assertThrows(UnsupportedOperationException.class,()->q.clear());
    }
    @Test void allFourVerticesMustBelongToSameSprite(){
        ByteBuffer b=data();b.putFloat(8+3*32+16,.4f);
        assertTrue(SourceGeometry.read(b,32,0,16,8,A,B).isEmpty());
    }
    @Test void invalidAndNonfiniteUvsAreNotLabelled(){
        ByteBuffer b=data();b.putFloat(8+16,Float.NaN);
        assertTrue(SourceGeometry.read(b,32,0,16,8,A,B).isEmpty());
        assertThrows(IllegalArgumentException.class,()->SourceGeometry.read(data(),32,0,16,7,A,B));
        assertThrows(IllegalArgumentException.class,()->SourceGeometry.read(data(),32,0,16,12,A,B));
    }
    @Test void secondSheetAndMirroringArePreserved(){
        ByteBuffer b=data();for(int v=0;v<4;v++){b.putFloat(8+v*32+16,v%2==0?.7f:.6f);b.putFloat(8+v*32+20,.75f);}
        SourceGeometry.FireQuad q=SourceGeometry.read(b,32,0,16,8,A,B).get(0);
        assertEquals(1,q.sheet);assertEquals(1,q.uv[0],1e-6);assertEquals(0,q.uv[2],1e-6);
    }
    @Test void columnMajorMatrixCompositionMatchesSubmittedPositions(){
        float[] translation={1,0,0,0, 0,1,0,0, 0,0,1,0, 4,5,6,1};
        float[] scale={2,0,0,0, 0,3,0,0, 0,0,4,0, 0,0,0,1};
        assertArrayEquals(new float[]{10,21,36,1},SourceGeometry.transform(SourceGeometry.multiply(scale,translation),1,2,3));
    }
}
