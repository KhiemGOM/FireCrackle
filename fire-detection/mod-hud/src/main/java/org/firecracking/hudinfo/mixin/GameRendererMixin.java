package org.firecracking.hudinfo.mixin;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.render.state.GuiRenderState;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.client.render.GameRenderer;
import net.minecraft.client.render.RenderTickCounter;
import org.firecracking.hudinfo.HudInfoClient;
import org.firecracking.hudinfo.HudText;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Draws the info line and the frame-ID strip as the very last GUI content of every frame, after any screen
 *  (pause menu, inventory) and its blur/tint, so they are readable on every rendered frame in a world. The FPS
 *  value is {@code MinecraftClient.getCurrentFps()}: the same once-per-second number F3 shows. */
@Mixin(GameRenderer.class)
public class GameRendererMixin {
    @Shadow @Final private GuiRenderState guiState;

    @Inject(method = "render", at = @At(value = "INVOKE", target = "Lnet/minecraft/client/gui/render/GuiRenderer;render(Lcom/mojang/blaze3d/buffers/GpuBufferSlice;)V"))
    private void hudinfo$draw(RenderTickCounter counter, boolean tick, CallbackInfo ci) {
        MinecraftClient client = MinecraftClient.getInstance();
        ClientPlayerEntity player = client.player;
        if (player == null || client.options.hudHidden || client.getDebugHud().shouldShowDebugHud()) {
            return;
        }
        DrawContext context = new DrawContext(client, guiState, 0, 0);
        context.createNewRootLayer();
        int fps = client.getCurrentFps();
        String line = HudText.line(player.getX(), player.getY(), player.getZ(), player.getYaw(), player.getPitch(),
            player.getHorizontalFacing().asString(), fps);
        // Same look as the vanilla F3 lines: translucent grey box, light grey text, no shadow.
        int y = HudInfoClient.TEXT_Y;
        int width = client.textRenderer.getWidth(line);
        context.fill(1, y - 1, 2 + width + 1, y + 9 - 1, 0x90505050);
        context.drawText(client.textRenderer, line, 2, y, 0xFFE0E0E0, false);
        HudInfoClient.frame(client, context, fps);
    }
}
