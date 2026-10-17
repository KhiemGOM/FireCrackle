package org.firecracking.firelabel.ownership;

import java.nio.*;
import java.util.*;
import org.lwjgl.BufferUtils;
import org.lwjgl.glfw.GLFW;
import org.lwjgl.opengl.*;

/** GPU controls, not Minecraft-world certification. Run with the ownershipSmoke task. */
public final class OwnershipSmoke {
    private static final int W=64,H=64;
    private static final float[] FIRE={0,0,1,1},NONE={-2,-2,-1,-1};
    private static OwnershipRenderer renderer;
    private static int target,texture,checks;
    private static final List<Integer> allocated=new ArrayList<Integer>();
    private static ByteBuffer vertices;
    public static void main(String[] args){
        if(!GLFW.glfwInit())throw new AssertionError("GLFW unavailable");
        GLFW.glfwWindowHint(GLFW.GLFW_VISIBLE,GLFW.GLFW_FALSE);
        long window=GLFW.glfwCreateWindow(W,H,"ownership controls",0,0);
        if(window==0)throw new AssertionError("No compatibility GL context");
        try {
            GLFW.glfwMakeContextCurrent(window);GL.createCapabilities();
            System.out.println("GPU: "+GL11.glGetString(GL11.GL_RENDERER)+"; "+GL11.glGetString(GL11.GL_VERSION));
            target=GL30.glGenFramebuffers();GL30.glBindFramebuffer(GL30.GL_FRAMEBUFFER,target);
            int c=rb(GL11.GL_RGBA8),d=rb(GL14.GL_DEPTH_COMPONENT24);
            GL30.glFramebufferRenderbuffer(GL30.GL_FRAMEBUFFER,GL30.GL_COLOR_ATTACHMENT0,GL30.GL_RENDERBUFFER,c);
            GL30.glFramebufferRenderbuffer(GL30.GL_FRAMEBUFFER,GL30.GL_DEPTH_ATTACHMENT,GL30.GL_RENDERBUFFER,d);
            check(GL30.glCheckFramebufferStatus(GL30.GL_FRAMEBUFFER)==GL30.GL_FRAMEBUFFER_COMPLETE,"source FBO");
            GL11.glViewport(0,0,W,H);GL11.glMatrixMode(GL11.GL_PROJECTION);GL11.glLoadIdentity();
            GL11.glMatrixMode(GL11.GL_MODELVIEW);GL11.glLoadIdentity();GL11.glDisable(GL11.GL_CULL_FACE);
            GL11.glEnable(GL11.GL_DEPTH_TEST);GL11.glDepthFunc(GL11.GL_LEQUAL);GL11.glDepthMask(true);
            texture=GL11.glGenTextures();GL11.glBindTexture(GL11.GL_TEXTURE_2D,texture);
            GL11.glTexParameteri(GL11.GL_TEXTURE_2D,GL11.GL_TEXTURE_MIN_FILTER,GL11.GL_NEAREST);
            GL11.glTexParameteri(GL11.GL_TEXTURE_2D,GL11.GL_TEXTURE_MAG_FILTER,GL11.GL_NEAREST);
            tex(false);GL11.glEnable(GL11.GL_TEXTURE_2D);GL11.glColor4f(1,1,1,1);
            GL11.glEnableClientState(GL11.GL_VERTEX_ARRAY);GL11.glEnableClientState(GL11.GL_TEXTURE_COORD_ARRAY);
            check(OwnershipRenderer.depthFormat(target)==GL14.GL_DEPTH_COMPONENT24,"source depth format matched");
            renderer=new OwnershipRenderer(W,H,OwnershipRenderer.depthFormat(target));
            reset();draw(-.8f,-.8f,.8f,.8f,.2f,1,true,true);
            check(id(32,32)==1,"isolated fire ID");check(id(1,1)==0,"background");
            draw(-.8f,-.8f,0,.8f,-.2f,2,false,true);
            check(id(12,32)==0&&id(48,32)==1,"opaque wall occludes only covered half");
            reset();draw(-.8f,-.8f,.8f,.8f,.2f,1,true,true);
            draw(-.3f,-.3f,.3f,.3f,-.2f,2,true,true);
            check(id(32,32)==2&&id(12,32)==1,"front fire has separate owner");
            draw(-.8f,-.8f,.8f,.8f,.5f,3,true,true);
            check(id(32,32)==2,"far fire cannot overwrite closer fire");
            reset();tex(true);GL11.glEnable(GL11.GL_ALPHA_TEST);GL11.glAlphaFunc(GL11.GL_GREATER,.1f);
            draw(-.8f,-.8f,.8f,.8f,0,7,true,true);
            check(id(12,32)==7&&id(48,32)==0,"texture alpha holes preserved");
            tex(false);GL11.glDisable(GL11.GL_ALPHA_TEST);
            reset();draw(-.8f,-.8f,.8f,.8f,.2f,1,true,true);
            GL11.glEnable(GL11.GL_BLEND);GL11.glBlendFunc(GL11.GL_SRC_ALPHA,GL11.GL_ONE_MINUS_SRC_ALPHA);
            GL11.glDepthMask(false);GL11.glColor4f(1,1,1,.5f);
            draw(-.8f,-.8f,0,.8f,-.2f,2,false,true);
            check(id(12,32)==0xffffff&&id(48,32)==1,"blended coverage explicitly unknown");
            GL11.glDepthMask(true);GL11.glDisable(GL11.GL_BLEND);GL11.glColor4f(1,1,1,1);
            draw(-.8f,-.8f,0,.8f,0,4,true,true);
            check(id(12,32)==0xffffff,"later opaque draw cannot erase uncertainty");
            reset();draw(-.8f,-.8f,.8f,.8f,-.5f,1,true,true);
            renderer.clearDepth();GL11.glClear(GL11.GL_DEPTH_BUFFER_BIT);
            draw(-.3f,-.3f,.3f,.3f,.5f,2,false,true);
            check(id(32,32)==0&&id(12,32)==1,"hand depth-clear ordering");
            reset();
            GL11.glEnable(GL11.GL_SCISSOR_TEST);GL11.glScissor(0,0,W/2,H);
            draw(-.8f,-.8f,.8f,.8f,0,0x010203,true,true);
            check(id(12,32)==0x010203&&id(48,32)==0,"scissor and 24-bit ID encoding");
            GL11.glDisable(GL11.GL_SCISSOR_TEST);
            reset();GL11.glEnable(GL11.GL_CULL_FACE);GL11.glCullFace(GL11.GL_FRONT);
            draw(-.8f,-.8f,.8f,.8f,0,8,true,true);
            check(id(32,32)==0,"front-face culling preserved");GL11.glDisable(GL11.GL_CULL_FACE);
            reset();GL11.glViewport(0,0,W/2,H/2);
            draw(-.8f,-.8f,.8f,.8f,0,9,true,true);
            check(id(16,16)==9&&id(48,48)==0,"viewport preserved");GL11.glViewport(0,0,W,H);
            reset();GL11.glEnable(GL11.GL_BLEND);GL11.glBlendFunc(GL11.GL_SRC_ALPHA,GL11.GL_ONE_MINUS_SRC_ALPHA);
            draw(-.8f,-.8f,.8f,.8f,0,11,true,true);
            check(id(32,32)==11,"alpha-one standard blending is opaque evidence");
            GL11.glDisable(GL11.GL_BLEND);
            reset();vboControl();
            reset();scene(false);ByteBuffer baseline=OwnershipRenderer.readRgba(target,W,H);
            reset();scene(true);ByteBuffer replay=OwnershipRenderer.readRgba(target,W,H);
            for(int i=0;i<W*H*4;i++)check(baseline.get(i)==replay.get(i),"source RGBA byte "+i);
            check(GL11.glGetError()==GL11.GL_NO_ERROR,"no OpenGL error");
            System.out.println("PASS: "+checks+" assertions; overlap, wall, cutout, blend, depth clear, geometry, state, unchanged source RGBA");
        } finally {
            if(renderer!=null)renderer.close();if(texture!=0)GL11.glDeleteTextures(texture);
            for(int r:allocated)GL30.glDeleteRenderbuffers(r);if(target!=0)GL30.glDeleteFramebuffers(target);
            GLFW.glfwDestroyWindow(window);GLFW.glfwTerminate();
        }
    }
    private static int rb(int format){int r=GL30.glGenRenderbuffers();allocated.add(r);GL30.glBindRenderbuffer(GL30.GL_RENDERBUFFER,r);GL30.glRenderbufferStorage(GL30.GL_RENDERBUFFER,format,W,H);return r;}
    private static void tex(boolean hole){
        ByteBuffer b=BufferUtils.createByteBuffer(16);
        for(int i=0;i<4;i++)b.put((byte)255).put((byte)120).put((byte)20).put((byte)(hole&&i%2==1?0:255));b.flip();
        GL11.glTexImage2D(GL11.GL_TEXTURE_2D,0,GL11.GL_RGBA8,2,2,0,GL11.GL_RGBA,GL11.GL_UNSIGNED_BYTE,b);
    }
    private static void reset(){GL30.glBindFramebuffer(GL30.GL_FRAMEBUFFER,target);GL11.glClearColor(.1f,.2f,.3f,1);GL11.glClear(GL11.GL_COLOR_BUFFER_BIT|GL11.GL_DEPTH_BUFFER_BIT);renderer.begin(target);}
    private static void scene(boolean shadow){
        draw(-.8f,-.8f,.8f,.8f,.2f,1,true,shadow);draw(-.3f,-.3f,.3f,.3f,-.2f,2,true,shadow);
        GL11.glEnable(GL11.GL_BLEND);GL11.glDepthMask(false);GL11.glColor4f(1,.5f,.2f,.5f);
        draw(-.8f,-.8f,0,.8f,-.6f,3,false,shadow);
        GL11.glDisable(GL11.GL_BLEND);GL11.glDepthMask(true);GL11.glColor4f(1,1,1,1);
    }
    private static void draw(float x0,float y0,float x1,float y1,float z,int id,boolean fire,boolean shadow){
        vertices=BufferUtils.createByteBuffer(4*5*4);
        float[][] v={{x0,y0,z,0,0},{x1,y0,z,1,0},{x1,y1,z,1,1},{x0,y1,z,0,1}};
        for(float[] a:v)for(float f:a)vertices.putFloat(f);vertices.flip();
        GL11.glVertexPointer(3,GL11.GL_FLOAT,20,vertices);
        vertices.position(12);GL11.glTexCoordPointer(2,GL11.GL_FLOAT,20,vertices);vertices.position(0);
        if(shadow){
            int[] state=state();FloatBuffer geometry=renderer.draw(GL11.GL_QUADS,0,4,id,fire,FIRE,NONE,fire);
            check(Arrays.equals(state,state()),"draw state restored");
            if(fire){check(Math.abs(geometry.get(0)-x0)<.00001&&Math.abs(geometry.get(1)-y0)<.00001,"GPU clip corners");check(geometry.get(4)==0&&geometry.get(5)==0,"GPU UV");}
        }
        GL11.glDrawArrays(GL11.GL_QUADS,0,4);
    }
    private static void vboControl(){
        ByteBuffer data=BufferUtils.createByteBuffer(8*20);
        for(int q=0;q<2;q++)for(float[] v:new float[][]{{-.8f,-.8f,0,0,0},{.8f,-.8f,0,1,0},{.8f,.8f,0,1,1},{-.8f,.8f,0,0,1}})for(float f:v)data.putFloat(f);
        data.flip();int vbo=GL15.glGenBuffers();
        try {
            GL15.glBindBuffer(GL15.GL_ARRAY_BUFFER,vbo);GL15.glBufferData(GL15.GL_ARRAY_BUFFER,data,GL15.GL_STATIC_DRAW);
            GL11.glVertexPointer(3,GL11.GL_FLOAT,20,0L);GL11.glTexCoordPointer(2,GL11.GL_FLOAT,20,12L);
            int[] state=state();FloatBuffer g=renderer.draw(GL11.GL_QUADS,4,4,99,true,FIRE,NONE,true);
            check(Arrays.equals(state,state()),"VBO and state restored");
            check(id(32,32)==100,"nonzero first vertex IDs");check(Math.abs(g.get(0)+.8f)<.00001,"VBO feedback positions");
        } finally {GL15.glBindBuffer(GL15.GL_ARRAY_BUFFER,0);GL15.glDeleteBuffers(vbo);}
    }
    private static int[] state(){return new int[]{GL11.glGetInteger(GL30.GL_DRAW_FRAMEBUFFER_BINDING),GL11.glGetInteger(GL30.GL_READ_FRAMEBUFFER_BINDING),GL11.glGetInteger(GL20.GL_CURRENT_PROGRAM),GL11.glGetInteger(GL13.GL_ACTIVE_TEXTURE),GL11.glIsEnabled(GL11.GL_BLEND)?1:0,GL11.glIsEnabled(GL11.GL_ALPHA_TEST)?1:0,GL11.glGetBoolean(GL11.GL_DEPTH_WRITEMASK)?1:0,GL11.glGetInteger(GL11.GL_DEPTH_FUNC),GL11.glGetInteger(GL30.GL_TRANSFORM_FEEDBACK_BUFFER_BINDING),GL11.glGetInteger(GL15.GL_ARRAY_BUFFER_BINDING),GL11.glIsEnabled(GL11.GL_SCISSOR_TEST)?1:0,GL11.glIsEnabled(GL11.GL_CULL_FACE)?1:0};}
    private static int id(int x,int y){ByteBuffer b=renderer.read();int i=(y*W+x)*4;return (b.get(i)&255)+256*(b.get(i+1)&255)+65536*(b.get(i+2)&255);}
    private static void check(boolean pass,String message){checks++;if(!pass)throw new AssertionError(message);}
}
