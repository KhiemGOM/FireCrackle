package org.firecracking.hudinfo.mixin;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.hud.InGameHud;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.client.render.RenderTickCounter;
import org.firecracking.hudinfo.HudInfoClient;
import org.firecracking.hudinfo.HudText;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Draws the info line at the top left of every HUD frame, like the always-on overlay in the reference footage,
 *  then the frame-ID strip above it. The FPS value is {@code MinecraftClient.getCurrentFps()}: the same
 *  once-per-second number F3 shows. */
@Mixin(InGameHud.class)
public class InGameHudMixin {
    @Inject(method = "render", at = @At("TAIL"))
    private void hudinfo$draw(DrawContext context, RenderTickCounter tickCounter, CallbackInfo ci) {
        MinecraftClient client = MinecraftClient.getInstance();
        ClientPlayerEntity player = client.player;
        if (player == null || client.options.hudHidden || client.getDebugHud().shouldShowDebugHud()) {
            return;
        }
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
