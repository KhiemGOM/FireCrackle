package org.firecracking.firelabel.mixin;

import net.minecraft.client.render.Camera;
import net.minecraft.client.render.GameRenderer;
import net.minecraft.client.render.LightmapTextureManager;
import net.minecraft.client.render.WorldRenderer;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.util.math.Matrix4f;
import org.firecracking.firelabel.FrameCapture;
import org.firecracking.firelabel.ownership.OwnershipExport;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(WorldRenderer.class)
public class WorldRendererMixin {
    /**
     * The exact view (with bobbing and hurt tilt) and projection matrices the world is drawn with this frame.
     * Captured only here, so the hand and GUI passes cannot overwrite them. Also arms entity fire capture.
     */
    @Inject(method = "render", at = @At("HEAD"))
    private void firelabel$beginWorld(
            MatrixStack matrices,
            float tickDelta,
            long limitTime,
            boolean renderBlockOutline,
            Camera camera,
            GameRenderer gameRenderer,
            LightmapTextureManager lightmapTextureManager,
            Matrix4f projectionMatrix,
            CallbackInfo ci) {
        OwnershipExport.beginWorld();
        FrameCapture.beginWorld(matrices.peek().getModel(), projectionMatrix, camera.getPos());
    }

    /** Entity fire drawn after this point (inventory preview, GUI) uses other matrices and must be ignored. */
    @Inject(method = "render", at = @At("RETURN"))
    private void firelabel$endWorld(
            MatrixStack matrices,
            float tickDelta,
            long limitTime,
            boolean renderBlockOutline,
            Camera camera,
            GameRenderer gameRenderer,
            LightmapTextureManager lightmapTextureManager,
            Matrix4f projectionMatrix,
            CallbackInfo ci) {
        FrameCapture.endWorld();
        OwnershipExport.endWorld();
    }
}
