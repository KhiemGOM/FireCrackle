package org.firecracking.firelabel.mixin;

import java.util.Random;
import net.minecraft.block.BlockState;
import net.minecraft.block.Blocks;
import net.minecraft.client.render.VertexConsumer;
import net.minecraft.client.render.block.BlockRenderManager;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.BlockRenderView;
import org.firecracking.firelabel.FireTracker;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * Low priority number = runs before other mods' HEAD injections (e.g. Indigo's cancelling one), so we still
 * see every block the chunk builder renders. Runs on chunk-builder threads: only touches a concurrent set.
 */
@Mixin(value = BlockRenderManager.class, priority = 500)
public class BlockRenderManagerMixin {
    @Inject(method = "renderBlock", at = @At("HEAD"))
    private void firelabel$trackFire(
            BlockState state,
            BlockPos pos,
            BlockRenderView world,
            MatrixStack matrix,
            VertexConsumer vertexConsumer,
            boolean cull,
            Random random,
            CallbackInfoReturnable<Boolean> cir) {
        if (FireTracker.isFire(state)) {
            FireTracker.add(pos);
        }
    }
}
