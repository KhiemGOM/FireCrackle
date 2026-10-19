package org.firecracking.firelabel;

import java.util.Collections;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import net.minecraft.block.BlockState;
import net.minecraft.block.Blocks;
import net.minecraft.client.world.ClientWorld;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.chunk.Chunk;
import net.minecraft.world.chunk.ChunkSection;
import net.minecraft.world.chunk.ChunkStatus;

/**
 * Positions of fire blocks near the camera. Fed three ways, because the chunk builder alone cannot be relied on
 * (Fabric's Indigo renderer bypasses {@code BlockRenderManager.renderBlock}, found in the first in-game run):
 * a periodic scan of loaded chunk sections, an immediate hook on client block changes, and the render hook
 * for setups without Indigo. Entries are re-validated against the world every frame by the labeler.
 */
public final class FireTracker {
    private static final Set<Long> POSITIONS = Collections.newSetFromMap(new ConcurrentHashMap<Long, Boolean>());
    /** Chunks around the camera to scan; 5 chunks = 80 blocks, beyond the labeller's 64-block range. */
    private static final int SCAN_RADIUS_CHUNKS = 5;

    private FireTracker() {}

    public static void add(BlockPos pos) {
        POSITIONS.add(pos.asLong());
    }

    static Set<Long> positions() {
        return POSITIONS;
    }

    /**
     * Finds fire in the loaded chunks around the camera. Cheap: a section is only walked block by block if its
     * palette says it contains fire at all.
     */
    static void scan(ClientWorld world, double camX, double camZ) {
        int ccx = ((int) Math.floor(camX)) >> 4;
        int ccz = ((int) Math.floor(camZ)) >> 4;
        for (int cx = ccx - SCAN_RADIUS_CHUNKS; cx <= ccx + SCAN_RADIUS_CHUNKS; cx++) {
            for (int cz = ccz - SCAN_RADIUS_CHUNKS; cz <= ccz + SCAN_RADIUS_CHUNKS; cz++) {
                Chunk chunk = world.getChunkManager().getChunk(cx, cz, ChunkStatus.FULL, false);
                if (chunk == null) {
                    continue;
                }
                for (ChunkSection section : chunk.getSectionArray()) {
                    if (section == null || section.isEmpty() || !section.hasAny(FireTracker::isFire)) {
                        continue;
                    }
                    for (int y = 0; y < 16; y++) {
                        for (int z = 0; z < 16; z++) {
                            for (int x = 0; x < 16; x++) {
                                if (isFire(section.getBlockState(x, y, z))) {
                                    POSITIONS.add(BlockPos.asLong((cx << 4) + x, section.getYOffset() + y, (cz << 4) + z));
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    public static boolean isFire(BlockState state) {
        return state.isOf(Blocks.FIRE) || state.isOf(Blocks.SOUL_FIRE);
    }
}
