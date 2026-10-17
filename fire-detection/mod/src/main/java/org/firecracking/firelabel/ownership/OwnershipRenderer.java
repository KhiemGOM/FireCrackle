package org.firecracking.firelabel.ownership;

import java.nio.ByteBuffer;
import java.nio.FloatBuffer;
import org.lwjgl.BufferUtils;
import org.lwjgl.opengl.*;

/** Separate compatibility-profile draw target. Never binds the game's colour attachment for writing. */
public final class OwnershipRenderer implements AutoCloseable {
    public final int width, height, depthFormat;
    private final int framebuffer, colour, depth, program, feedback, uncertainFramebuffer, uncertainColour;
    private int readbackBuffer;
    private long readbackFence;
    private ByteBuffer mappedReadback;
    private final int textureUniform, texturedUniform, alphaUniform, alphaFuncUniform, blendedUniform;
    private final int fireUniform, baseUniform, bounds0Uniform, bounds1Uniform, uncertaintyOnlyUniform;

    private static final String VERTEX = "#version 130\n"
            + "out vec2 uv; out vec4 tint; flat out int owner; out vec4 captureClip; out vec2 captureUv;\n"
            + "uniform int base; void main(){gl_Position=ftransform();"
            + "uv=(gl_TextureMatrix[0]*gl_MultiTexCoord0).xy; tint=gl_Color;"
            + "owner=base+gl_VertexID/4;captureClip=gl_Position;captureUv=uv;}";
    private static final String FRAGMENT = "#version 130\n"
            + "in vec2 uv; in vec4 tint; flat in int owner; out vec4 result;"
            + "uniform sampler2D tex;uniform int textured,alphaFunc,blended,fire,uncertaintyOnly;"
            + "uniform float alphaRef;uniform vec4 bounds0,bounds1;\n"
            + "bool inside(vec4 b){return all(greaterThanEqual(uv,b.xy))&&all(lessThanEqual(uv,b.zw));}"
            + "void main(){float a=tint.a*(textured!=0?texture2D(tex,uv).a:1.0);"
            + "bool pass=alphaFunc==519||(alphaFunc==512?false:alphaFunc==513?a<alphaRef:"
            + "alphaFunc==514?a==alphaRef:alphaFunc==515?a<=alphaRef:alphaFunc==516?a>alphaRef:"
            + "alphaFunc==517?a!=alphaRef:a>=alphaRef);if(!pass||a<=0.0)discard;"
            + "int sheet=fire!=0?(inside(bounds0)?1:inside(bounds1)?2:0):0;"
            + "bool uncertain=blended==2||(blended==1&&a<1.0);if(uncertaintyOnly!=0&&!uncertain)discard;"
            + "int id=uncertain?16777215:sheet!=0?owner:0;"
            + "result=vec4(float(id%256),float((id/256)%256),float(id/65536),"
            + "float(uncertain?255:sheet))/255.0;}";

    public OwnershipRenderer(int width, int height) {this(width,height,GL14.GL_DEPTH_COMPONENT24);}
    public OwnershipRenderer(int width, int height,int depthFormat) {
        this.width=width; this.height=height; this.depthFormat=depthFormat;
        int oldDraw=GL11.glGetInteger(GL30.GL_DRAW_FRAMEBUFFER_BINDING);
        int oldRead=GL11.glGetInteger(GL30.GL_READ_FRAMEBUFFER_BINDING);
        int oldRender=GL11.glGetInteger(GL30.GL_RENDERBUFFER_BINDING);
        framebuffer=GL30.glGenFramebuffers();colour=GL30.glGenRenderbuffers();depth=GL30.glGenRenderbuffers();
        uncertainFramebuffer=GL30.glGenFramebuffers();uncertainColour=GL30.glGenRenderbuffers();
        int builtProgram=0, builtFeedback=0;
        try {
            GL30.glBindFramebuffer(GL30.GL_FRAMEBUFFER,framebuffer);
            GL30.glBindRenderbuffer(GL30.GL_RENDERBUFFER,colour);
            GL30.glRenderbufferStorage(GL30.GL_RENDERBUFFER,GL11.GL_RGBA8,width,height);
            GL30.glFramebufferRenderbuffer(GL30.GL_FRAMEBUFFER,GL30.GL_COLOR_ATTACHMENT0,GL30.GL_RENDERBUFFER,colour);
            GL30.glBindRenderbuffer(GL30.GL_RENDERBUFFER,depth);
            GL30.glRenderbufferStorage(GL30.GL_RENDERBUFFER,depthFormat,width,height);
            GL30.glFramebufferRenderbuffer(GL30.GL_FRAMEBUFFER,GL30.GL_DEPTH_ATTACHMENT,GL30.GL_RENDERBUFFER,depth);
            if(GL30.glCheckFramebufferStatus(GL30.GL_FRAMEBUFFER)!=GL30.GL_FRAMEBUFFER_COMPLETE)
                throw new IllegalStateException("Ownership framebuffer incomplete");
            GL30.glBindFramebuffer(GL30.GL_FRAMEBUFFER,uncertainFramebuffer);
            GL30.glBindRenderbuffer(GL30.GL_RENDERBUFFER,uncertainColour);
            GL30.glRenderbufferStorage(GL30.GL_RENDERBUFFER,GL30.GL_R8,width,height);
            GL30.glFramebufferRenderbuffer(GL30.GL_FRAMEBUFFER,GL30.GL_COLOR_ATTACHMENT0,GL30.GL_RENDERBUFFER,uncertainColour);
            GL30.glFramebufferRenderbuffer(GL30.GL_FRAMEBUFFER,GL30.GL_DEPTH_ATTACHMENT,GL30.GL_RENDERBUFFER,depth);
            if(GL30.glCheckFramebufferStatus(GL30.GL_FRAMEBUFFER)!=GL30.GL_FRAMEBUFFER_COMPLETE)
                throw new IllegalStateException("Uncertainty framebuffer incomplete");
            builtProgram=link();builtFeedback=GL15.glGenBuffers();
        } catch(RuntimeException e) {
            GL30.glDeleteFramebuffers(framebuffer);GL30.glDeleteRenderbuffers(colour);GL30.glDeleteRenderbuffers(depth);
            GL30.glDeleteFramebuffers(uncertainFramebuffer);GL30.glDeleteRenderbuffers(uncertainColour);
            if(builtProgram!=0)GL20.glDeleteProgram(builtProgram);
            throw e;
        } finally {
            GL30.glBindRenderbuffer(GL30.GL_RENDERBUFFER,oldRender);
            GL30.glBindFramebuffer(GL30.GL_DRAW_FRAMEBUFFER,oldDraw);
            GL30.glBindFramebuffer(GL30.GL_READ_FRAMEBUFFER,oldRead);
        }
        program=builtProgram;feedback=builtFeedback;
        textureUniform=uniform("tex");texturedUniform=uniform("textured");alphaUniform=uniform("alphaRef");
        alphaFuncUniform=uniform("alphaFunc");blendedUniform=uniform("blended");fireUniform=uniform("fire");
        baseUniform=uniform("base");bounds0Uniform=uniform("bounds0");bounds1Uniform=uniform("bounds1");uncertaintyOnlyUniform=uniform("uncertaintyOnly");
    }

    private int uniform(String name){return GL20.glGetUniformLocation(program,name);}
    private static int shader(int type,String source){
        int s=GL20.glCreateShader(type);GL20.glShaderSource(s,source);GL20.glCompileShader(s);
        if(GL20.glGetShaderi(s,GL20.GL_COMPILE_STATUS)==0){String log=GL20.glGetShaderInfoLog(s);GL20.glDeleteShader(s);throw new IllegalStateException(log);}
        return s;
    }
    private static int link(){
        int v=shader(GL20.GL_VERTEX_SHADER,VERTEX),f=0,p=0;
        try {
            f=shader(GL20.GL_FRAGMENT_SHADER,FRAGMENT);p=GL20.glCreateProgram();
            GL20.glAttachShader(p,v);GL20.glAttachShader(p,f);
            GL30.glTransformFeedbackVaryings(p,new CharSequence[]{"captureClip","captureUv"},GL30.GL_INTERLEAVED_ATTRIBS);
            GL20.glLinkProgram(p);
            if(GL20.glGetProgrami(p,GL20.GL_LINK_STATUS)==0)throw new IllegalStateException(GL20.glGetProgramInfoLog(p));
            return p;
        } catch(RuntimeException e){if(p!=0)GL20.glDeleteProgram(p);throw e;}
        finally {GL20.glDeleteShader(v);if(f!=0)GL20.glDeleteShader(f);}
    }

    /** Depth blits require matching formats; the vanilla attachment is an unsized depth texture. */
    public static int depthFormat(int sourceFramebuffer){
        int old=GL11.glGetInteger(GL30.GL_READ_FRAMEBUFFER_BINDING);
        try {
            GL30.glBindFramebuffer(GL30.GL_READ_FRAMEBUFFER,sourceFramebuffer);
            int bits=GL30.glGetFramebufferAttachmentParameteri(GL30.GL_READ_FRAMEBUFFER,GL30.GL_DEPTH_ATTACHMENT,GL30.GL_FRAMEBUFFER_ATTACHMENT_DEPTH_SIZE);
            int type=GL30.glGetFramebufferAttachmentParameteri(GL30.GL_READ_FRAMEBUFFER,GL30.GL_DEPTH_ATTACHMENT,GL30.GL_FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE);
            if(type==GL11.GL_FLOAT&&bits==32)return GL30.GL_DEPTH_COMPONENT32F;
            if(bits==16)return GL14.GL_DEPTH_COMPONENT16;
            if(bits==24)return GL14.GL_DEPTH_COMPONENT24;
            if(bits==32)return GL14.GL_DEPTH_COMPONENT32;
            throw new IllegalStateException("Unsupported source depth format: "+bits+" / "+type);
        } finally {GL30.glBindFramebuffer(GL30.GL_READ_FRAMEBUFFER,old);}
    }
    public void begin(int sourceFramebuffer){
        int oldDraw=GL11.glGetInteger(GL30.GL_DRAW_FRAMEBUFFER_BINDING);
        int oldRead=GL11.glGetInteger(GL30.GL_READ_FRAMEBUFFER_BINDING);
        GL11.glPushAttrib(GL11.GL_ALL_ATTRIB_BITS);
        try {
            GL30.glBindFramebuffer(GL30.GL_DRAW_FRAMEBUFFER,framebuffer);
            GL11.glDisable(GL11.GL_SCISSOR_TEST);GL11.glColorMask(true,true,true,true);GL11.glDepthMask(true);
            GL11.glClearColor(0,0,0,0);GL11.glClearDepth(1);GL11.glClear(GL11.GL_COLOR_BUFFER_BIT|GL11.GL_DEPTH_BUFFER_BIT);
            GL30.glBindFramebuffer(GL30.GL_DRAW_FRAMEBUFFER,uncertainFramebuffer);
            GL11.glClear(GL11.GL_COLOR_BUFFER_BIT);
            GL30.glBindFramebuffer(GL30.GL_DRAW_FRAMEBUFFER,framebuffer);
            GL30.glBindFramebuffer(GL30.GL_READ_FRAMEBUFFER,sourceFramebuffer);
            GL30.glBlitFramebuffer(0,0,width,height,0,0,width,height,GL11.GL_DEPTH_BUFFER_BIT,GL11.GL_NEAREST);
        } finally {restoreFramebuffer(oldDraw,oldRead);GL11.glPopAttrib();}
    }

    /** Replay with the caller's vertex arrays, matrices, depth/cull/scissor state and alpha cutoff. */
    public FloatBuffer draw(int mode,int first,int count,int base,boolean fire,float[] b0,float[] b1,boolean captureGeometry){
        return draw(mode,first,count,base,fire,b0,b1,captureGeometry,true);
    }
    public FloatBuffer draw(int mode,int first,int count,int base,boolean fire,float[] b0,float[] b1,boolean captureGeometry,boolean accumulateUncertainty){
        int oldDraw=GL11.glGetInteger(GL30.GL_DRAW_FRAMEBUFFER_BINDING);
        int oldRead=GL11.glGetInteger(GL30.GL_READ_FRAMEBUFFER_BINDING);
        int oldProgram=GL11.glGetInteger(GL20.GL_CURRENT_PROGRAM);
        int oldActive=GL11.glGetInteger(GL13.GL_ACTIVE_TEXTURE);
        int blendMode=0;
        if(GL11.glIsEnabled(GL11.GL_BLEND)){
            int src=GL11.glGetInteger(GL14.GL_BLEND_SRC_RGB),dst=GL11.glGetInteger(GL14.GL_BLEND_DST_RGB);
            int equation=GL11.glGetInteger(GL20.GL_BLEND_EQUATION_RGB);
            blendMode=equation==GL14.GL_FUNC_ADD&&src==GL11.GL_SRC_ALPHA&&dst==GL11.GL_ONE_MINUS_SRC_ALPHA?1:
                equation==GL14.GL_FUNC_ADD&&src==GL11.GL_ONE&&dst==GL11.GL_ZERO?0:2;
        }
        boolean textured;
        GL13.glActiveTexture(GL13.GL_TEXTURE0);textured=GL11.glIsEnabled(GL11.GL_TEXTURE_2D);GL13.glActiveTexture(oldActive);
        boolean alpha=GL11.glIsEnabled(GL11.GL_ALPHA_TEST);
        float ref=GL11.glGetFloat(GL11.GL_ALPHA_TEST_REF);
        int func=alpha?GL11.glGetInteger(GL11.GL_ALPHA_TEST_FUNC):GL11.GL_ALWAYS;
        GL11.glPushAttrib(GL11.GL_ALL_ATTRIB_BITS);
        try {
            GL30.glBindFramebuffer(GL30.GL_DRAW_FRAMEBUFFER,framebuffer);
            GL11.glDrawBuffer(GL30.GL_COLOR_ATTACHMENT0);
            GL11.glDisable(GL11.GL_BLEND);GL11.glDisable(GL11.GL_ALPHA_TEST);GL11.glDisable(GL11.GL_DITHER);
            GL11.glDisable(GL30.GL_FRAMEBUFFER_SRGB);GL11.glDisable(GL11.GL_COLOR_LOGIC_OP);
            GL11.glColorMask(true,true,true,true);
            GL20.glUseProgram(program);GL20.glUniform1i(textureUniform,0);
            GL20.glUniform1i(texturedUniform,textured?1:0);GL20.glUniform1f(alphaUniform,ref);
            GL20.glUniform1i(alphaFuncUniform,func);GL20.glUniform1i(blendedUniform,blendMode);GL20.glUniform1i(uncertaintyOnlyUniform,0);
            GL20.glUniform1i(fireUniform,fire?1:0);GL20.glUniform1i(baseUniform,base);
            GL20.glUniform4f(bounds0Uniform,b0[0],b0[1],b0[2],b0[3]);
            GL20.glUniform4f(bounds1Uniform,b1[0],b1[1],b1[2],b1[3]);
            FloatBuffer geometry=captureGeometry?capture(first,count):null;
            if(blendMode!=0&&accumulateUncertainty){
                // Conservative union: later opaque geometry may hide this layer, but cannot make it trusted.
                boolean depthWrite=GL11.glGetBoolean(GL11.GL_DEPTH_WRITEMASK);
                GL30.glBindFramebuffer(GL30.GL_DRAW_FRAMEBUFFER,uncertainFramebuffer);
                GL20.glUniform1i(uncertaintyOnlyUniform,1);
                GL11.glDepthMask(false);GL11.glDrawArrays(mode,first,count);
                GL20.glUniform1i(uncertaintyOnlyUniform,0);
                GL11.glDepthMask(depthWrite);GL30.glBindFramebuffer(GL30.GL_DRAW_FRAMEBUFFER,framebuffer);
            }
            GL11.glDrawArrays(mode,first,count);
            return geometry;
        } finally {
            GL20.glUseProgram(oldProgram);restoreFramebuffer(oldDraw,oldRead);GL11.glPopAttrib();GL13.glActiveTexture(oldActive);
        }
    }
    private FloatBuffer capture(int first,int count){
        int old=GL11.glGetInteger(GL30.GL_TRANSFORM_FEEDBACK_BUFFER_BINDING);
        int indexed=GL30.glGetIntegeri(GL30.GL_TRANSFORM_FEEDBACK_BUFFER_BINDING,0);
        boolean discard=GL11.glIsEnabled(GL30.GL_RASTERIZER_DISCARD);
        boolean started=false;
        try {
            GL15.glBindBuffer(GL30.GL_TRANSFORM_FEEDBACK_BUFFER,feedback);
            GL15.glBufferData(GL30.GL_TRANSFORM_FEEDBACK_BUFFER,(long)count*6*4,GL15.GL_STREAM_READ);
            GL30.glBindBufferBase(GL30.GL_TRANSFORM_FEEDBACK_BUFFER,0,feedback);
            GL11.glEnable(GL30.GL_RASTERIZER_DISCARD);
            GL30.glBeginTransformFeedback(GL11.GL_POINTS);started=true;
            GL11.glDrawArrays(GL11.GL_POINTS,first,count);
            GL30.glEndTransformFeedback();started=false;
            FloatBuffer out=BufferUtils.createFloatBuffer(count*6);
            GL15.glGetBufferSubData(GL30.GL_TRANSFORM_FEEDBACK_BUFFER,0,out);return out;
        } finally {
            if(started)GL30.glEndTransformFeedback();
            if(!discard)GL11.glDisable(GL30.GL_RASTERIZER_DISCARD);
            GL30.glBindBufferBase(GL30.GL_TRANSFORM_FEEDBACK_BUFFER,0,indexed);
            GL15.glBindBuffer(GL30.GL_TRANSFORM_FEEDBACK_BUFFER,old);
        }
    }
    public void clearDepth(){
        int old=GL11.glGetInteger(GL30.GL_DRAW_FRAMEBUFFER_BINDING);
        try {GL30.glBindFramebuffer(GL30.GL_DRAW_FRAMEBUFFER,framebuffer);GL11.glClear(GL11.GL_DEPTH_BUFFER_BIT);}
        finally {GL30.glBindFramebuffer(GL30.GL_DRAW_FRAMEBUFFER,old);}
    }
    /** Queue all three images to a reusable PBO. No CPU pixel read or GPU wait here. */
    public void requestReadback(int sourceFramebuffer) {
        if (readbackFence != 0 || mappedReadback != null) throw new IllegalStateException("Readback already pending");
        int oldRead=GL11.glGetInteger(GL30.GL_READ_FRAMEBUFFER_BINDING);
        int oldPack=GL11.glGetInteger(GL21.GL_PIXEL_PACK_BUFFER_BINDING);
        GL11.glPushClientAttrib(GL11.GL_CLIENT_PIXEL_STORE_BIT);GL11.glPushAttrib(GL11.GL_PIXEL_MODE_BIT);
        try {
            if(readbackBuffer==0){
                readbackBuffer=GL15.glGenBuffers();GL15.glBindBuffer(GL21.GL_PIXEL_PACK_BUFFER,readbackBuffer);
                GL15.glBufferData(GL21.GL_PIXEL_PACK_BUFFER,(long)width*height*4*3,GL15.GL_STREAM_READ);
            } else GL15.glBindBuffer(GL21.GL_PIXEL_PACK_BUFFER,readbackBuffer);
            GL11.glPixelStorei(GL11.GL_PACK_ALIGNMENT,1);GL11.glPixelStorei(GL11.GL_PACK_ROW_LENGTH,0);
            GL11.glPixelStorei(GL11.GL_PACK_SKIP_ROWS,0);GL11.glPixelStorei(GL11.GL_PACK_SKIP_PIXELS,0);
            int[] sources={sourceFramebuffer,framebuffer,uncertainFramebuffer};
            for(int i=0;i<3;i++){
                GL30.glBindFramebuffer(GL30.GL_READ_FRAMEBUFFER,sources[i]);GL11.glReadBuffer(GL30.GL_COLOR_ATTACHMENT0);
                GL11.glReadPixels(0,0,width,height,GL11.GL_RGBA,GL11.GL_UNSIGNED_BYTE,(long)i*width*height*4);
            }
            readbackFence=GL32.glFenceSync(GL32.GL_SYNC_GPU_COMMANDS_COMPLETE,0);
            GL11.glFlush();
        } finally {
            GL15.glBindBuffer(GL21.GL_PIXEL_PACK_BUFFER,oldPack);GL30.glBindFramebuffer(GL30.GL_READ_FRAMEBUFFER,oldRead);
            GL11.glPopAttrib();GL11.glPopClientAttrib();
        }
    }
    /** Returns null while the GPU is busy; polling never waits. Mapping occurs only after the fence signals. */
    public ByteBuffer[] pollReadback() {
        if(readbackFence==0)return null;
        int status=GL32.glClientWaitSync(readbackFence,0,0);
        if(status==GL32.GL_TIMEOUT_EXPIRED)return null;
        if(status==GL32.GL_WAIT_FAILED)throw new IllegalStateException("Ownership GPU fence failed");
        int oldPack=GL11.glGetInteger(GL21.GL_PIXEL_PACK_BUFFER_BINDING);
        try {
            GL15.glBindBuffer(GL21.GL_PIXEL_PACK_BUFFER,readbackBuffer);
            mappedReadback=GL15.glMapBuffer(GL21.GL_PIXEL_PACK_BUFFER,GL15.GL_READ_ONLY,(long)width*height*4*3,null);
            if(mappedReadback==null)throw new IllegalStateException("Ownership PBO mapping failed");
            ByteBuffer[] out=new ByteBuffer[3];int bytes=width*height*4;
            for(int i=0;i<3;i++){
                ByteBuffer view=mappedReadback.duplicate();view.position(i*bytes);view.limit((i+1)*bytes);out[i]=view.slice();
            }
            GL32.glDeleteSync(readbackFence);readbackFence=0;return out;
        } finally {GL15.glBindBuffer(GL21.GL_PIXEL_PACK_BUFFER,oldPack);}
    }
    /** Called only after the worker has copied/consumed its mapped views. */
    public void releaseReadback(){
        if(mappedReadback==null)return;
        int oldPack=GL11.glGetInteger(GL21.GL_PIXEL_PACK_BUFFER_BINDING);
        try {GL15.glBindBuffer(GL21.GL_PIXEL_PACK_BUFFER,readbackBuffer);GL15.glUnmapBuffer(GL21.GL_PIXEL_PACK_BUFFER);mappedReadback=null;}
        finally {GL15.glBindBuffer(GL21.GL_PIXEL_PACK_BUFFER,oldPack);}
    }
    public ByteBuffer readRawIds(){return readRgba(framebuffer,width,height);}
    public ByteBuffer readUncertainty(){return readRgba(uncertainFramebuffer,width,height);}
    public ByteBuffer read(){
        ByteBuffer ids=readRgba(framebuffer,width,height),unknown=readRgba(uncertainFramebuffer,width,height);
        for(int i=0;i<width*height*4;i+=4)if((unknown.get(i)&255)!=0){
            ids.put(i,(byte)255);ids.put(i+1,(byte)255);ids.put(i+2,(byte)255);ids.put(i+3,(byte)255);
        }
        return ids;
    }
    public static ByteBuffer readRgba(int framebuffer,int width,int height){
        int old=GL11.glGetInteger(GL30.GL_READ_FRAMEBUFFER_BINDING);
        int pack=GL11.glGetInteger(GL21.GL_PIXEL_PACK_BUFFER_BINDING);
        GL11.glPushClientAttrib(GL11.GL_CLIENT_PIXEL_STORE_BIT);GL11.glPushAttrib(GL11.GL_PIXEL_MODE_BIT);
        try {
            GL30.glBindFramebuffer(GL30.GL_READ_FRAMEBUFFER,framebuffer);GL11.glReadBuffer(GL30.GL_COLOR_ATTACHMENT0);
            GL15.glBindBuffer(GL21.GL_PIXEL_PACK_BUFFER,0);GL11.glPixelStorei(GL11.GL_PACK_ALIGNMENT,1);
            GL11.glPixelStorei(GL11.GL_PACK_ROW_LENGTH,0);GL11.glPixelStorei(GL11.GL_PACK_SKIP_ROWS,0);GL11.glPixelStorei(GL11.GL_PACK_SKIP_PIXELS,0);
            ByteBuffer out=BufferUtils.createByteBuffer(width*height*4);
            GL11.glReadPixels(0,0,width,height,GL11.GL_RGBA,GL11.GL_UNSIGNED_BYTE,out);return out;
        } finally {
            GL15.glBindBuffer(GL21.GL_PIXEL_PACK_BUFFER,pack);GL30.glBindFramebuffer(GL30.GL_READ_FRAMEBUFFER,old);
            GL11.glPopAttrib();GL11.glPopClientAttrib();
        }
    }
    private static void restoreFramebuffer(int draw,int read){GL30.glBindFramebuffer(GL30.GL_DRAW_FRAMEBUFFER,draw);GL30.glBindFramebuffer(GL30.GL_READ_FRAMEBUFFER,read);}
    public void close(){releaseReadback();if(readbackFence!=0)GL32.glDeleteSync(readbackFence);if(readbackBuffer!=0)GL15.glDeleteBuffers(readbackBuffer);GL20.glDeleteProgram(program);GL15.glDeleteBuffers(feedback);GL30.glDeleteFramebuffers(framebuffer);GL30.glDeleteRenderbuffers(colour);GL30.glDeleteRenderbuffers(depth);GL30.glDeleteFramebuffers(uncertainFramebuffer);GL30.glDeleteRenderbuffers(uncertainColour);}
}
