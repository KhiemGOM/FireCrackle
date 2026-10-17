package org.firecracking.firelabel.mixin;

import java.nio.ByteBuffer;
import net.minecraft.client.render.BufferRenderer;
import net.minecraft.client.render.VertexFormat;
import org.firecracking.firelabel.ownership.OwnershipExport;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(BufferRenderer.class)
public class OwnershipBufferMixin {
    @Inject(method="draw(Ljava/nio/ByteBuffer;ILnet/minecraft/client/render/VertexFormat;I)V",at=@At("HEAD"))
    private static void firelabel$source(ByteBuffer bytes,int mode,VertexFormat format,int count,CallbackInfo ci){
        OwnershipExport.clientVertices(bytes,format,count);
    }
    @Inject(method="draw(Ljava/nio/ByteBuffer;ILnet/minecraft/client/render/VertexFormat;I)V",at=@At("RETURN"))
    private static void firelabel$clearSource(ByteBuffer bytes,int mode,VertexFormat format,int count,CallbackInfo ci){
        OwnershipExport.clientVertices(null,null,0);
    }
}
