package org.firecracking.firelabel.mixin;

import com.mojang.blaze3d.platform.GlStateManager;
import org.firecracking.firelabel.ownership.OwnershipExport;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Both chunk VBOs and immediate BufferBuilder batches reach this vanilla entry point. */
@Mixin(GlStateManager.class)
public class OwnershipDrawMixin {
    @Inject(method="drawArrays",at=@At("HEAD"))
    private static void firelabel$ownershipDraw(int mode,int first,int count,CallbackInfo ci){
        OwnershipExport.draw(mode,first,count);
    }
    @Inject(method="blitFramebuffer",at=@At("HEAD"))
    private static void firelabel$ownershipBlit(int x0,int y0,int x1,int y1,int dx0,int dy0,int dx1,int dy1,int mask,int filter,CallbackInfo ci){
        OwnershipExport.noteBlit(mask);
    }
    @Inject(method="clear",at=@At("HEAD"))
    private static void firelabel$ownershipClear(int mask,boolean checkError,CallbackInfo ci){
        OwnershipExport.clear(mask);
    }
}
