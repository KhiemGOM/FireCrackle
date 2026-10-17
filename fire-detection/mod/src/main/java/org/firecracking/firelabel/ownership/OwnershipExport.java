package org.firecracking.firelabel.ownership;

import com.google.gson.*;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.FloatBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import javax.imageio.ImageIO;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.render.model.ModelLoader;
import net.minecraft.client.texture.Sprite;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.lwjgl.opengl.*;

/** Experimental sampled recorder; IDs identify actual submitted quads, never inferred hidden texture. */
public final class OwnershipExport {
    private static final Logger LOG=LogManager.getLogger("firelabel-ownership");
    private static final boolean ENABLED=Boolean.getBoolean("firelabel.ownership");
    private static final int EVERY=Math.max(1,Integer.getInteger("firelabel.ownershipEvery",120));
    private static final int LIMIT=Math.max(1,Math.min(10000,Integer.getInteger("firelabel.ownershipLimit",8)));
    private static final float[] EMPTY={-2,-2,-1,-1};
    private static OwnershipRenderer renderer;
    private static boolean active,world,failed,seenFire;
    private static int worldFrames,exported,mainFramebuffer,nextId,draws,atlas;
    private static float[] bounds0,bounds1;
    private static JsonArray quads;
    private static final Set<String> issues=new LinkedHashSet<String>();
    private static Path directory;
    private OwnershipExport(){}

    public static void beginWorld(){
        if(!ENABLED||failed||exported>=LIMIT||worldFrames++%EVERY!=0)return;
        try {
            MinecraftClient mc=MinecraftClient.getInstance();
            int w=mc.getWindow().getFramebufferWidth(),h=mc.getWindow().getFramebufferHeight();
            if(w<1||h<1||w>8192||h>8192)return;
            mainFramebuffer=mc.getFramebuffer().fbo;
            int depthFormat=OwnershipRenderer.depthFormat(mainFramebuffer);
            if(renderer==null||renderer.width!=w||renderer.height!=h||renderer.depthFormat!=depthFormat){
                if(renderer!=null)renderer.close();renderer=new OwnershipRenderer(w,h,depthFormat);
            }
            bounds0=bounds(ModelLoader.FIRE_0.getSprite());bounds1=bounds(ModelLoader.FIRE_1.getSprite());
            atlas=mc.getTextureManager().getTexture(ModelLoader.FIRE_0.getAtlasId()).getGlId();
            issues.clear();quads=new JsonArray();nextId=1;draws=0;seenFire=false;
            renderer.begin(mainFramebuffer);active=true;world=true;
        } catch(RuntimeException e){fail(e);}
    }
    public static void endWorld(){world=false;}
    private static float[] bounds(Sprite s){return new float[]{s.getMinU(),s.getMinV(),s.getMaxU(),s.getMaxV()};}

    /** Called immediately before vanilla glDrawArrays with its original arrays still bound. */
    public static void draw(int mode,int first,int count){
        if(!active||failed||count<=0)return;
        try {
            if(GL11.glGetInteger(GL30.GL_DRAW_FRAMEBUFFER_BINDING)!=mainFramebuffer){issues.add("offscreen_draw_not_replayed");return;}
            if(GL11.glGetInteger(GL20.GL_CURRENT_PROGRAM)!=0){issues.add("custom_shader_not_replayed");return;}
            if(GL11.glGetInteger(GL13.GL_SAMPLES)>0){issues.add("multisampling_not_supported");return;}
            if(GL11.glIsEnabled(GL11.GL_STENCIL_TEST)){issues.add("stencil_not_replayed");return;}
            if(GL11.glIsEnabled(GL11.GL_COLOR_LOGIC_OP)){issues.add("logic_operation_not_supported");return;}
            // Alpha-only GUI bookkeeping is not visible RGB geometry.
            ByteBuffer mask=org.lwjgl.BufferUtils.createByteBuffer(4);GL11.glGetBooleanv(GL11.GL_COLOR_WRITEMASK,mask);
            if(mask.get(0)==0&&mask.get(1)==0&&mask.get(2)==0)return;
            if(mask.get(0)==0||mask.get(1)==0||mask.get(2)==0)issues.add("partial_rgb_write_mask");
            int activeTexture=GL11.glGetInteger(GL13.GL_ACTIVE_TEXTURE);
            GL13.glActiveTexture(GL13.GL_TEXTURE0);
            boolean fire=world&&mode==GL11.GL_QUADS&&first%4==0&&count%4==0
                    &&GL11.glIsEnabled(GL11.GL_TEXTURE_2D)&&GL11.glGetInteger(GL11.GL_TEXTURE_BINDING_2D)==atlas;
            GL13.glActiveTexture(activeTexture);
            if(count>2000000||nextId+count/4>=0xffffff){issues.add("geometry_budget_exceeded");return;}
            int idBase=nextId-first/4;nextId+=count/4+1;draws++;
            FloatBuffer geometry=renderer.draw(mode,first,count,idBase,fire,bounds0,bounds1,fire,seenFire);
            if(geometry!=null)collect(geometry,count,idBase+first/4,draws);
            if(quads.size()>0)seenFire=true;
        } catch(RuntimeException e){fail(e);}
    }
    public static void noteBlit(int mask){
        if(active&&(mask&GL11.GL_COLOR_BUFFER_BIT)!=0
                &&GL11.glGetInteger(GL30.GL_DRAW_FRAMEBUFFER_BINDING)==mainFramebuffer)
            issues.add("colour_blit_not_replayed");
    }
    public static void clear(int mask){
        if(!active||failed||(mask&GL11.GL_DEPTH_BUFFER_BIT)==0)return;
        try {
            if(GL11.glGetInteger(GL30.GL_DRAW_FRAMEBUFFER_BINDING)==mainFramebuffer)renderer.clearDepth();
        } catch(RuntimeException e){fail(e);}
    }
    private static void collect(FloatBuffer g,int count,int firstId,int draw){
        for(int q=0;q<count/4;q++){
            int sheet=sheet(g,q,bounds0)?0:sheet(g,q,bounds1)?1:-1;
            if(sheet<0)continue;
            JsonObject entry=new JsonObject();entry.addProperty("id",firstId+q);entry.addProperty("draw",draw);
            entry.addProperty("quad_in_draw",q);entry.addProperty("sheet",sheet);
            JsonArray corners=new JsonArray(),uv=new JsonArray();float[] b=sheet==0?bounds0:bounds1;
            for(int v=0;v<4;v++){
                int i=(q*4+v)*6;JsonArray c=new JsonArray(),t=new JsonArray();
                for(int a=0;a<4;a++)c.add(g.get(i+a));
                t.add((g.get(i+4)-b[0])/(b[2]-b[0]));t.add((g.get(i+5)-b[1])/(b[3]-b[1]));
                corners.add(c);uv.add(t);
            }
            entry.add("clip_corners",corners);entry.add("uv",uv);quads.add(entry);
        }
    }
    private static boolean sheet(FloatBuffer g,int quad,float[] b){
        for(int v=0;v<4;v++){
            int i=(quad*4+v)*6;float u=g.get(i+4),t=g.get(i+5);
            if(!Float.isFinite(u)||!Float.isFinite(t)||u<b[0]||u>b[2]||t<b[1]||t>b[3])return false;
        }
        return true;
    }

    /** RGB and ownership are sampled together, before the sync strip/debug overlay is added. */
    public static void finish(int frameId,long ticks,int row0,int row1){
        if(!active)return;active=false;world=false;
        if(failed||quads.size()==0)return;
        try {
            ByteBuffer rgb=OwnershipRenderer.readRgba(mainFramebuffer,renderer.width,renderer.height);
            ByteBuffer ids=renderer.read();
            Set<Integer> knownIds=new HashSet<Integer>();for(JsonElement e:quads)knownIds.add(e.getAsJsonObject().get("id").getAsInt());
            int unmapped=0;
            for(int i=0;i<ids.limit();i+=4){
                int owner=(ids.get(i)&255)+256*(ids.get(i+1)&255)+65536*(ids.get(i+2)&255);
                if(owner!=0&&owner!=0xffffff&&!knownIds.contains(owner)){
                    for(int c=0;c<4;c++)ids.put(i+c,(byte)255);unmapped++;
                }
            }
            if(unmapped>0)issues.add("unmapped_fire_fragments_"+unmapped);
            if(directory==null){
                directory=FabricLoader.getInstance().getGameDir().resolve("firelabel").resolve("ownership-"+UUID.randomUUID());
                Files.createDirectories(directory);
            }
            String stem=String.format(Locale.ROOT,"frame-%08d",frameId);
            Path rgbFile=directory.resolve(stem+"-rgb.png"),idFile=directory.resolve(stem+"-ids.png");
            // RGB ID channels must survive losslessly; unknown is 0xffffff. Never feed alpha to a compositor.
            writePng(rgbFile,rgb,renderer.width,renderer.height,true);
            writePng(idFile,ids,renderer.width,renderer.height,false);
            JsonObject meta=new JsonObject();meta.addProperty("schema","firelabel-ownership-v1");
            meta.addProperty("status",issues.isEmpty()?"experimental_unvalidated":"rejected_unsupported_render_state");
            meta.addProperty("ground_truth",false);meta.addProperty("frame_id",frameId);meta.addProperty("client_tick",ticks);
            meta.addProperty("width",renderer.width);meta.addProperty("height",renderer.height);
            meta.addProperty("capture_stage","before_sync_strip_and_debug");meta.addProperty("origin","top_left");
            meta.addProperty("id_encoding","R + 256*G + 65536*B; 0=non-target; 16777215=unknown; A=sheet+1 or 255 unknown");
            meta.addProperty("rgb",rgbFile.getFileName().toString());meta.addProperty("ids",idFile.getFileName().toString());
            meta.addProperty("rgb_sha256",sha256(rgbFile));meta.addProperty("ids_sha256",sha256(idFile));
            meta.addProperty("draw_calls",draws);JsonArray warnings=new JsonArray();for(String s:issues)warnings.add(s);meta.add("issues",warnings);
            for(JsonElement e:quads){JsonObject q=e.getAsJsonObject();q.addProperty("row",q.get("sheet").getAsInt()==0?row0:row1);}
            meta.add("quads",quads);
            // Metadata is the completion marker; partial image pairs without it are ignored.
            Files.write(directory.resolve(stem+".json"),new GsonBuilder().setPrettyPrinting().create().toJson(meta).getBytes(StandardCharsets.UTF_8));
            exported++;LOG.info("Ownership sample {} written to {} ({} quads; experimental, not ground truth)",frameId,directory,quads.size());
        } catch(IOException|RuntimeException e){fail(e);}
    }
    public static void writePng(Path path,ByteBuffer pixels,int width,int height,boolean opaque) throws IOException{
        BufferedImage image=new BufferedImage(width,height,BufferedImage.TYPE_INT_ARGB);
        for(int y=0;y<height;y++)for(int x=0;x<width;x++){
            int i=((height-1-y)*width+x)*4;
            int a=opaque?255:pixels.get(i+3)&255;
            image.setRGB(x,y,(a<<24)|((pixels.get(i)&255)<<16)|((pixels.get(i+1)&255)<<8)|(pixels.get(i+2)&255));
        }
        if(!ImageIO.write(image,"png",path.toFile()))throw new IOException("PNG encoder unavailable");
    }
    private static String sha256(Path path) throws IOException{
        try {byte[] digest=MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(path));StringBuilder out=new StringBuilder();for(byte b:digest)out.append(String.format(Locale.ROOT,"%02x",b&255));return out.toString();}
        catch(java.security.NoSuchAlgorithmException e){throw new IllegalStateException(e);}
    }
    private static void fail(Exception e){active=false;failed=true;LOG.error("Ownership export disabled for this session; normal recording continues",e);}
    public static void close(){active=false;if(renderer!=null){renderer.close();renderer=null;}}
}
