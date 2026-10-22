package org.firecracking.hudinfo.mixin;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.hud.InGameHud;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.client.render.RenderTickCounter;
import net.minecraft.util.Colors;
import org.firecracking.hudinfo.HudText;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Draws the info line at the top left of every HUD frame, like the always-on overlay in the reference footage.
 *  The FPS value is {@code MinecraftClient.getCurrentFps()}: the same once-per-second number F3 shows. */
@Mixin(InGameHud.class)
public class InGameHudMixin {
    @Inject(method = "render", at = @At("TAIL"))
    private void hudinfo$draw(DrawContext context, RenderTickCounter tickCounter, CallbackInfo ci) {
        MinecraftClient client = MinecraftClient.getInstance();
        ClientPlayerEntity player = client.player;
        if (player == null || client.options.hudHidden || client.getDebugHud().shouldShowDebugHud()) {
            return;
        }
        String line = HudText.line(player.getX(), player.getY(), player.getZ(), player.getYaw(), player.getPitch(),
            player.getHorizontalFacing().asString(), client.getCurrentFps());
        context.drawTextWithShadow(client.textRenderer, line, 2, 2, Colors.WHITE);
    }
}
