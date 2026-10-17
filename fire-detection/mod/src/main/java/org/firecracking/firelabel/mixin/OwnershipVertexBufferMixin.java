package org.firecracking.firelabel.mixin;

import com.mojang.datafixers.util.Pair;
import java.nio.ByteBuffer;
import net.minecraft.client.gl.VertexBuffer;
import net.minecraft.client.render.BufferBuilder;
import org.firecracking.firelabel.ownership.OwnershipExport;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.Redirect;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(VertexBuffer.class)
public class OwnershipVertexBufferMixin {
    @Shadow private int vertexBufferId;
    @Redirect(method="uploadInternal",at=@At(value="INVOKE",target="Lnet/minecraft/client/render/BufferBuilder;popData()Lcom/mojang/datafixers/util/Pair;"))
    private Pair<BufferBuilder.DrawArrayParameters,ByteBuffer> firelabel$uploadedVertices(BufferBuilder builder){
        Pair<BufferBuilder.DrawArrayParameters,ByteBuffer> pair=builder.popData();
        OwnershipExport.uploadVertices(vertexBufferId,pair.getSecond(),pair.getFirst().getVertexFormat(),pair.getFirst().getCount());
        return pair;
    }
    @Inject(method="close",at=@At("HEAD"))
    private void firelabel$forget(CallbackInfo ci){OwnershipExport.forgetVertices(vertexBufferId);}
}
