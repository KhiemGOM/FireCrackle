package org.firecracking.firelabel.mixin;

import net.minecraft.block.BlockState;
import net.minecraft.block.Blocks;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.chunk.WorldChunk;
import org.firecracking.firelabel.FireTracker;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** New fire on the client (placed, spread, or sent by the server) is tracked immediately, not at the next scan. */
@Mixin(WorldChunk.class)
public abstract class WorldChunkMixin {
    @Inject(method = "setBlockState", at = @At("RETURN"))
    private void firelabel$trackNewFire(
            BlockPos pos, BlockState state, boolean moved, CallbackInfoReturnable<BlockState> cir) {
        if (FireTracker.isFire(state) && ((WorldChunk) (Object) this).getWorld().isClient()) {
            FireTracker.add(pos);
        }
    }
}
