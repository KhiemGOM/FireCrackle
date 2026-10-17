package org.firecracking.firelabel.mixin;

import net.minecraft.client.gui.hud.InGameHud;
import net.minecraft.entity.Entity;
import org.firecracking.firelabel.GuiMask;
import org.firecracking.firelabel.ownership.OwnershipExport;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(InGameHud.class)
public class InGameHudMixin {
    /** The vignette's blend mode writes alpha over the whole screen; it is not GUI coverage, so keep it out. */
    @Inject(method = "renderVignetteOverlay", at = @At("HEAD"))
    private void firelabel$vignetteStart(Entity entity, CallbackInfo ci) {
        OwnershipExport.vignette(true);
        GuiMask.maskAlphaWrites(true);
    }

    @Inject(method = "renderVignetteOverlay", at = @At("RETURN"))
    private void firelabel$vignetteEnd(Entity entity, CallbackInfo ci) {
        GuiMask.maskAlphaWrites(false);
        OwnershipExport.vignette(false);
    }
}
