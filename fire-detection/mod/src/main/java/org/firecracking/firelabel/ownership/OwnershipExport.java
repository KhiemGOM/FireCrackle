package org.firecracking.firelabel.ownership;

import com.google.gson.*;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.nio.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.imageio.ImageIO;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.render.VertexFormat;
import net.minecraft.client.render.model.ModelLoader;
import net.minecraft.client.texture.Sprite;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.lwjgl.BufferUtils;
import org.lwjgl.opengl.*;

/** Opt-in sampled recorder. GPU ownership remains experimental; disk work never runs on the game thread. */
public final class OwnershipExport {
    private static final Logger LOG=LogManager.getLogger("firelabel-ownership");
    private static final boolean ENABLED=Boolean.getBoolean("firelabel.ownership");
    private static final int EVERY=Math.max(1,Integer.getInteger("firelabel.ownershipEvery",180));
    private static final int LIMIT=Math.max(1,Math.min(10000,Integer.getInteger("firelabel.ownershipLimit",8)));
    private static final AtomicBoolean WRITING=new AtomicBoolean();
    private static final ExecutorService WRITER=Executors.newSingleThreadExecutor(r->{Thread t=new Thread(r,"firelabel-image-writer");t.setDaemon(true);return t;});
    private static final Map<Integer,List<SourceGeometry.FireQuad>> VERTICES=new HashMap<Integer,List<SourceGeometry.FireQuad>>();
    private static OwnershipRenderer renderer;
    private static boolean active,world,seenFire,inVignette;
    private static volatile boolean failed;
    private static int worldFrames,exported,mainFramebuffer,nextId,draws,atlas;
    private static Sprite boundSprite;
    private static Pending pending;
    private static float[] bounds0,bounds1;
    private static List<GeometryDraw> geometry;
    private static final Set<String> issues=new LinkedHashSet<String>();
    private static Path directory;
    private static ByteBuffer clientBytes;
    private static VertexFormat clientFormat;
    private static int clientCount;
    private static long replayNanos;
    private OwnershipExport(){}

    private static final class GeometryDraw {
        final List<SourceGeometry.FireQuad> quads;final float[] matrix;final int base,first,count,draw;
        GeometryDraw(List<SourceGeometry.FireQuad> quads,float[] matrix,int base,int first,int count,int draw){
            this.quads=quads;this.matrix=matrix;this.base=base;this.first=first;this.count=count;this.draw=draw;
        }
    }
    private static final class Pending {
        final int frame,row0,row1,w,h,draws;final long ticks;final List<GeometryDraw> geometry;final List<String> warnings;
        final double replayMs,submitMs;boolean writing;
        Pending(int frame,long ticks,int row0,int row1,int w,int h,int draws,List<GeometryDraw> geometry,List<String> warnings,double replayMs,double submitMs){
            this.frame=frame;this.ticks=ticks;this.row0=row0;this.row1=row1;this.w=w;this.h=h;this.draws=draws;this.geometry=geometry;this.warnings=warnings;this.replayMs=replayMs;this.submitMs=submitMs;
        }
    }
    private static void fireBounds(){
        Sprite current=ModelLoader.FIRE_0.getSprite();
        if(current!=boundSprite){
            bounds0=bounds(current);bounds1=bounds(ModelLoader.FIRE_1.getSprite());boundSprite=current;VERTICES.clear();
        }
    }
    private static float[] bounds(Sprite s){return new float[]{s.getMinU(),s.getMinV(),s.getMaxU(),s.getMaxV()};}
    public static void clientVertices(ByteBuffer bytes,VertexFormat format,int count){
        if(!ENABLED)return;clientBytes=bytes;clientFormat=format;clientCount=count;
    }
    public static void uploadVertices(int id,ByteBuffer bytes,VertexFormat format,int count){
        if(!ENABLED||failed||id<0)return;
        if(count%4!=0){VERTICES.remove(id);return;}
        try {
            fireBounds();
            // Retain filtered fire vertices, never full chunk buffers. A replaced VBO invalidates its old entry.
            if(VERTICES.size()>8192)VERTICES.clear();
            VERTICES.put(id,SourceGeometry.read(bytes,format,count,bounds0,bounds1));
        } catch(RuntimeException e){VERTICES.remove(id);LOG.warn("Ownership geometry cache skipped VBO {}",id,e);}
    }
    public static void forgetVertices(int id){if(ENABLED)VERTICES.remove(id);}
    public static void vignette(boolean drawing){if(ENABLED)inVignette=drawing;}
    public static void beginWorld(){
        if(!ENABLED||failed||exported>=LIMIT||worldFrames++%EVERY!=0||WRITING.get()||pending!=null)return;
        try {
            MinecraftClient mc=MinecraftClient.getInstance();
            int w=mc.getWindow().getFramebufferWidth(),h=mc.getWindow().getFramebufferHeight();
            if(w<1||h<1||w>8192||h>8192)return;
            mainFramebuffer=mc.getFramebuffer().fbo;int depthFormat=OwnershipRenderer.depthFormat(mainFramebuffer);
            if(renderer==null||renderer.width!=w||renderer.height!=h||renderer.depthFormat!=depthFormat){
                if(renderer!=null)renderer.close();renderer=new OwnershipRenderer(w,h,depthFormat);
            }
            fireBounds();atlas=mc.getTextureManager().getTexture(ModelLoader.FIRE_0.getAtlasId()).getGlId();issues.clear();geometry=new ArrayList<GeometryDraw>();nextId=1;draws=0;seenFire=false;replayNanos=0;
            renderer.begin(mainFramebuffer);active=true;world=true;
        } catch(RuntimeException e){fail(e);}
    }
    public static void endWorld(){world=false;}

    public static void draw(int mode,int first,int count){
        // The explicit vanilla vignette hook identifies photometric darkening, not an occluding layer.
        if(!active||failed||inVignette||count<=0)return;
        long start=System.nanoTime();
        try {
            if(GL11.glGetInteger(GL30.GL_DRAW_FRAMEBUFFER_BINDING)!=mainFramebuffer){issues.add("offscreen_draw_not_replayed");return;}
            if(GL11.glGetInteger(GL20.GL_CURRENT_PROGRAM)!=0){issues.add("custom_shader_not_replayed");return;}
            if(GL11.glGetInteger(GL13.GL_SAMPLES)>0){issues.add("multisampling_not_supported");return;}
            if(GL11.glIsEnabled(GL11.GL_STENCIL_TEST)){issues.add("stencil_not_replayed");return;}
            if(GL11.glIsEnabled(GL11.GL_COLOR_LOGIC_OP)){issues.add("logic_operation_not_supported");return;}
            ByteBuffer mask=BufferUtils.createByteBuffer(4);GL11.glGetBooleanv(GL11.GL_COLOR_WRITEMASK,mask);
            if(mask.get(0)==0&&mask.get(1)==0&&mask.get(2)==0)return;
            if(mask.get(0)==0||mask.get(1)==0||mask.get(2)==0)issues.add("partial_rgb_write_mask");
            int oldActive=GL11.glGetInteger(GL13.GL_ACTIVE_TEXTURE);GL13.glActiveTexture(GL13.GL_TEXTURE0);
            boolean fire=world&&mode==GL11.GL_QUADS&&first%4==0&&count%4==0
                    &&GL11.glIsEnabled(GL11.GL_TEXTURE_2D)&&GL11.glGetInteger(GL11.GL_TEXTURE_BINDING_2D)==atlas;
            GL13.glActiveTexture(oldActive);
            if(count>2000000||nextId+count/4>=0xffffff){issues.add("geometry_budget_exceeded");return;}
            int base=nextId-first/4;nextId+=count/4+1;draws++;
            if(fire){
                List<SourceGeometry.FireQuad> quads;
                int vbo=GL11.glGetInteger(GL15.GL_ARRAY_BUFFER_BINDING);
                if(vbo!=0)quads=VERTICES.get(vbo);
                else if(clientBytes!=null&&clientFormat!=null){
                    ByteBuffer bytes=clientBytes.duplicate();bytes.clear();
                    quads=SourceGeometry.read(bytes,clientFormat,clientCount,bounds0,bounds1);
                } else quads=null;
                if(quads==null)issues.add("missing_source_vertices_vbo_"+vbo+"_count_"+count);
                else if(!quads.isEmpty()){
                    FloatBuffer mv=BufferUtils.createFloatBuffer(16),pr=BufferUtils.createFloatBuffer(16);
                    GL11.glGetFloatv(GL11.GL_MODELVIEW_MATRIX,mv);GL11.glGetFloatv(GL11.GL_PROJECTION_MATRIX,pr);
                    float[] m=new float[16],p=new float[16];mv.get(m);pr.get(p);
                    geometry.add(new GeometryDraw(quads,SourceGeometry.multiply(p,m),base,first,count,draws));seenFire=true;
                }
            }
            // No transform feedback or per-draw GPU readback in the recording path.
            renderer.draw(mode,first,count,base,fire,bounds0,bounds1,false,seenFire);
        } catch(RuntimeException e){fail(e);}
        finally {replayNanos+=System.nanoTime()-start;}
    }
    public static void noteBlit(int mask){
        if(active&&(mask&GL11.GL_COLOR_BUFFER_BIT)!=0&&GL11.glGetInteger(GL30.GL_DRAW_FRAMEBUFFER_BINDING)==mainFramebuffer)
            issues.add("colour_blit_not_replayed");
    }
    public static void clear(int mask){
        if(!active||failed||(mask&GL11.GL_DEPTH_BUFFER_BIT)==0)return;
        try {if(GL11.glGetInteger(GL30.GL_DRAW_FRAMEBUFFER_BINDING)==mainFramebuffer)renderer.clearDepth();}
        catch(RuntimeException e){fail(e);}
    }
    public static void finish(int frameId,long ticks,int row0,int row1){
        if(!ENABLED||failed)return;
        try {pumpReadback();}catch(RuntimeException e){fail(e);}
        if(!active)return;active=false;world=false;
        if(failed||geometry.isEmpty()||pending!=null)return;
        try {
            if(directory==null){directory=FabricLoader.getInstance().getGameDir().resolve("firelabel").resolve("ownership-"+UUID.randomUUID());Files.createDirectories(directory);}
            long start=System.nanoTime();renderer.requestReadback(mainFramebuffer);
            pending=new Pending(frameId,ticks,row0,row1,renderer.width,renderer.height,draws,geometry,new ArrayList<String>(issues),replayNanos/1e6,(System.nanoTime()-start)/1e6);
            exported++;
        }catch(IOException|RuntimeException e){fail(e);}
    }
    private static void pumpReadback(){
        if(pending==null)return;
        if(pending.writing){
            if(!WRITING.get()){renderer.releaseReadback();pending=null;}
            return;
        }
        long start=System.nanoTime();ByteBuffer[] mapped=renderer.pollReadback();if(mapped==null)return;
        final Pending sample=pending;final Path dir=directory;
        final double readMs=sample.submitMs+(System.nanoTime()-start)/1e6;
        WRITING.set(true);sample.writing=true;
        WRITER.execute(()->{
            try {
                // Copy mapped data on the worker; GL mapping/unmapping stays on the render thread.
                ByteBuffer[] pixels=new ByteBuffer[3];
                for(int i=0;i<3;i++){byte[] bytes=new byte[sample.w*sample.h*4];mapped[i].get(bytes);pixels[i]=ByteBuffer.wrap(bytes);}
                writeSample(dir,sample.frame,sample.ticks,sample.row0,sample.row1,sample.w,sample.h,sample.draws,sample.geometry,sample.warnings,pixels[0],pixels[1],pixels[2],sample.replayMs,readMs);
            }catch(IOException|RuntimeException e){failed=true;LOG.error("Ownership writer failed; further exports disabled",e);}
            finally {WRITING.set(false);}
        });
    }
    private static void writeSample(Path dir,int frame,long ticks,int row0,int row1,int w,int h,int draws,
            List<GeometryDraw> geometry,List<String> warnings,ByteBuffer rgb,ByteBuffer ids,ByteBuffer unknown,double replayMs,double readMs) throws IOException {
        long start=System.nanoTime();JsonArray quads=new JsonArray();Set<Integer> known=new HashSet<Integer>();
        for(GeometryDraw draw:geometry)for(SourceGeometry.FireQuad source:draw.quads){
            if(source.index*4<draw.first||source.index*4>=draw.first+draw.count)continue;
            int id=draw.base+source.index;known.add(id);JsonObject q=new JsonObject();
            q.addProperty("id",id);q.addProperty("draw",draw.draw);q.addProperty("quad_in_draw",source.index);
            q.addProperty("sheet",source.sheet);q.addProperty("row",source.sheet==0?row0:row1);
            JsonArray corners=new JsonArray(),uv=new JsonArray();
            for(int v=0;v<4;v++){
                float[] c=SourceGeometry.transform(draw.matrix,source.positions[v*3],source.positions[v*3+1],source.positions[v*3+2]);
                JsonArray corner=new JsonArray(),tex=new JsonArray();for(float f:c)corner.add(f);
                tex.add(source.uv[v*2]);tex.add(source.uv[v*2+1]);corners.add(corner);uv.add(tex);
            }
            q.add("clip_corners",corners);q.add("uv",uv);quads.add(q);
        }
        int unmapped=0,visible=0,uncertain=0;
        for(int i=0;i<ids.limit();i+=4){
            int id=(ids.get(i)&255)+256*(ids.get(i+1)&255)+65536*(ids.get(i+2)&255);
            if((unknown.get(i)&255)!=0||id==0xffffff){for(int c=0;c<4;c++)ids.put(i+c,(byte)255);uncertain++;}
            else if(id>0&&!known.contains(id)){for(int c=0;c<4;c++)ids.put(i+c,(byte)255);unmapped++;uncertain++;}
            else if(id>0)visible++;
        }
        if(unmapped>0)warnings.add("unmapped_fire_fragments_"+unmapped);
        if(uncertain==w*h)warnings.add("all_pixels_unknown");
        String stem=String.format(Locale.ROOT,"frame-%08d",frame);Path rgbFile=dir.resolve(stem+"-rgb.png"),idFile=dir.resolve(stem+"-ids.png");
        writePng(rgbFile,rgb,w,h,true);writePng(idFile,ids,w,h,false);
        JsonObject meta=new JsonObject();meta.addProperty("schema","firelabel-ownership-v2");
        meta.addProperty("status",warnings.isEmpty()?"experimental_unvalidated":"rejected_sample");meta.addProperty("ground_truth",false);
        meta.addProperty("frame_id",frame);meta.addProperty("client_tick",ticks);meta.addProperty("width",w);meta.addProperty("height",h);
        meta.addProperty("capture_stage","before_sync_strip_and_debug");meta.addProperty("origin","top_left");
        meta.addProperty("geometry_source","submitted_cpu_vertices; cached_static_vbos; clip_projection_float_tolerance");
        meta.addProperty("id_encoding","R + 256*G + 65536*B; 0=non-target; 16777215=unknown; A=sheet+1 or 255 unknown");
        meta.addProperty("rgb",rgbFile.getFileName().toString());meta.addProperty("ids",idFile.getFileName().toString());
        meta.addProperty("rgb_sha256",sha256(rgbFile));meta.addProperty("ids_sha256",sha256(idFile));
        meta.addProperty("draw_calls",draws);meta.addProperty("known_fire_pixels",visible);meta.addProperty("unknown_pixels",uncertain);
        meta.addProperty("replay_cpu_ms",replayMs);meta.addProperty("readback_cpu_ms",readMs);meta.addProperty("writer_cpu_ms",(System.nanoTime()-start)/1e6);
        JsonArray problems=new JsonArray();for(String s:warnings)problems.add(s);meta.add("issues",problems);meta.add("quads",quads);
        Files.write(dir.resolve(stem+".json"),new GsonBuilder().setPrettyPrinting().create().toJson(meta).getBytes(StandardCharsets.UTF_8));
        LOG.info("Ownership sample {}: {} visible fire pixels; replay={}ms readback={}ms; writer thread complete",frame,visible,String.format(Locale.ROOT,"%.1f",replayMs),String.format(Locale.ROOT,"%.1f",readMs));
    }
    public static void writePng(Path path,ByteBuffer pixels,int width,int height,boolean opaque) throws IOException{
        BufferedImage image=new BufferedImage(width,height,BufferedImage.TYPE_INT_ARGB);
        for(int y=0;y<height;y++)for(int x=0;x<width;x++){
            int i=((height-1-y)*width+x)*4,a=opaque?255:pixels.get(i+3)&255;
            image.setRGB(x,y,(a<<24)|((pixels.get(i)&255)<<16)|((pixels.get(i+1)&255)<<8)|(pixels.get(i+2)&255));
        }
        if(!ImageIO.write(image,"png",path.toFile()))throw new IOException("PNG encoder unavailable");
    }
    private static String sha256(Path path) throws IOException{
        try {byte[] digest=MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(path));StringBuilder out=new StringBuilder();for(byte b:digest)out.append(String.format(Locale.ROOT,"%02x",b&255));return out.toString();}
        catch(java.security.NoSuchAlgorithmException e){throw new IllegalStateException(e);}
    }
    private static void fail(Exception e){active=false;failed=true;LOG.error("Ownership export disabled; normal recording continues",e);}
    public static void close(){
        active=false;WRITER.shutdown();boolean finished=false;
        try {finished=WRITER.awaitTermination(30,TimeUnit.SECONDS);}
        catch(InterruptedException e){Thread.currentThread().interrupt();}
        if(finished&&renderer!=null){renderer.close();renderer=null;}
        else if(!finished)LOG.warn("Ownership writer still finishing; GPU readback retained until process exit");
        VERTICES.clear();
    }
}
