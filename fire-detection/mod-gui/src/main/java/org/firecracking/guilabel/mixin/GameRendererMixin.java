package org.firecracking.guilabel.mixin;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.render.state.GuiRenderState;
import net.minecraft.client.render.GameRenderer;
import net.minecraft.client.render.RenderTickCounter;
import org.firecracking.guilabel.GuiLabelClient;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(GameRenderer.class)
public class GameRendererMixin {
    @Shadow @Final private GuiRenderState guiState;

    @Inject(method = "render", at = @At("HEAD"))
    private void guilabel$begin(RenderTickCounter counter, boolean tick, CallbackInfo ci) {
        GuiLabelClient.begin(MinecraftClient.getInstance());
    }

    // Last GUI extraction point: includes HUD, menus and overlays, before GPU submission.
    @Inject(method = "render", at = @At(value = "INVOKE", target = "Lnet/minecraft/client/gui/render/GuiRenderer;render(Lcom/mojang/blaze3d/buffers/GpuBufferSlice;)V"))
    private void guilabel$frame(RenderTickCounter counter, boolean tick, CallbackInfo ci) {
        MinecraftClient client = MinecraftClient.getInstance();
        GuiLabelClient.frame(client, new DrawContext(client, guiState, 0, 0));
    }
}
