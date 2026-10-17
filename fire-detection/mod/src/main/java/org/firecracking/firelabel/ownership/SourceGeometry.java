package org.firecracking.firelabel.ownership;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import net.minecraft.client.render.VertexFormat;
import net.minecraft.client.render.VertexFormatElement;

/** Reads the CPU bytes vanilla is about to upload/draw. No GL synchronization or source mutation. */
public final class SourceGeometry {
    public static final class FireQuad {
        public final int index, sheet;
        final float[] positions, uv;
        FireQuad(int index,int sheet,float[] positions,float[] uv){this.index=index;this.sheet=sheet;this.positions=positions;this.uv=uv;}
    }
    private SourceGeometry(){}
    public static List<FireQuad> read(ByteBuffer source,VertexFormat format,int count,float[] b0,float[] b1){
        int position=-1,texture=-1,offset=0,stride=format.getVertexSize();
        for(VertexFormatElement e:format.getElements()){
            if(e.getDataType()==VertexFormatElement.Format.FLOAT){
                if(e.getType()==VertexFormatElement.Type.POSITION)position=offset;
                if(e.getType()==VertexFormatElement.Type.UV&&e.getTextureIndex()==0)texture=offset;
            }
            offset+=e.getByteLength();
        }
        if(position<0||texture<0)return Collections.emptyList();
        return read(source,stride,position,texture,count,b0,b1);
    }
    static List<FireQuad> read(ByteBuffer source,int stride,int position,int texture,int count,float[] b0,float[] b1){
        if(count<0||count%4!=0||stride<1||(long)count*stride>source.remaining())throw new IllegalArgumentException("Invalid quad vertex data");
        ByteBuffer data=source.duplicate().order(ByteOrder.nativeOrder());int base=data.position();
        List<FireQuad> out=new ArrayList<FireQuad>();
        for(int q=0;q<count/4;q++){
            int sheet=inside(data,base+q*4*stride,stride,texture,b0)?0:inside(data,base+q*4*stride,stride,texture,b1)?1:-1;
            if(sheet<0)continue;
            float[] p=new float[12],uv=new float[8];float[] b=sheet==0?b0:b1;
            for(int v=0;v<4;v++){
                int start=base+(q*4+v)*stride;
                for(int a=0;a<3;a++)p[v*3+a]=data.getFloat(start+position+a*4);
                uv[v*2]=(data.getFloat(start+texture)-b[0])/(b[2]-b[0]);
                uv[v*2+1]=(data.getFloat(start+texture+4)-b[1])/(b[3]-b[1]);
            }
            out.add(new FireQuad(q,sheet,p,uv));
        }
        return Collections.unmodifiableList(out);
    }
    private static boolean inside(ByteBuffer b,int start,int stride,int offset,float[] bounds){
        for(int v=0;v<4;v++){
            float u=b.getFloat(start+v*stride+offset),t=b.getFloat(start+v*stride+offset+4);
            if(!Float.isFinite(u)||!Float.isFinite(t)||u<bounds[0]||u>bounds[2]||t<bounds[1]||t>bounds[3])return false;
        }
        return true;
    }
    static float[] transform(float[] m,float x,float y,float z){
        float[] out=new float[4];
        for(int r=0;r<4;r++)out[r]=m[r]*x+m[4+r]*y+m[8+r]*z+m[12+r];
        return out;
    }
    static float[] multiply(float[] a,float[] b){
        float[] out=new float[16];
        for(int c=0;c<4;c++)for(int r=0;r<4;r++)for(int k=0;k<4;k++)out[c*4+r]+=a[k*4+r]*b[c*4+k];
        return out;
    }
}
