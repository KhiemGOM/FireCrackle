package org.firecracking.firelabel;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.IdentityHashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import net.minecraft.block.BlockState;
import net.minecraft.block.Blocks;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.render.model.BakedModel;
import net.minecraft.client.render.model.BakedQuad;
import net.minecraft.client.render.model.ModelLoader;
import net.minecraft.client.texture.Sprite;
import net.minecraft.client.world.ClientWorld;
import net.minecraft.entity.Entity;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Box;
import net.minecraft.util.math.Direction;
import net.minecraft.util.math.Vec3d;
import net.minecraft.world.BlockView;
import net.minecraft.world.RaycastContext;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.firecracking.firelabel.core.BBox;
import org.firecracking.firelabel.core.BoxCulling;
import org.firecracking.firelabel.core.FirePart;
import org.firecracking.firelabel.core.EntityOcclusionIndex;
import org.firecracking.firelabel.core.FireQuadLabel;
import org.firecracking.firelabel.core.FireQuadProjection;
import org.firecracking.firelabel.core.FireSourceLabel;
import org.firecracking.firelabel.core.FrameRecord;
import org.firecracking.firelabel.core.Occluder;
import org.firecracking.firelabel.core.OverlayQuads;
import org.firecracking.firelabel.core.Projector;
import org.firecracking.firelabel.core.Quad;
import org.firecracking.firelabel.core.QuadVisibility;
import org.firecracking.firelabel.core.RayBox;
import org.firecracking.firelabel.core.ScreenBounds;
import org.firecracking.firelabel.core.ScreenMask;
import org.firecracking.firelabel.core.TexelMask;
import org.firecracking.firelabel.core.ViewTransform;
import org.firecracking.firelabel.mixin.BakedQuadAccessor;

/**
 * Builds the per-frame fire label from the game's own geometry, for every source of the fire_0 / fire_1
 * textures: fire blocks, burning entities, and the first-person on-fire overlay. Each source gets ONE box and
 * the texture variants it shows as parts. See mod/PLAN.md ("Schema v3").
 */
final class FireLabeler {
    private static final double MAX_DIST = 64.0;
    private static final double FIRE_HEIGHT = 1.4; // side/up planes are 22.4/16 blocks tall
    private static final int MACRO = 4;
    private static final double[] ORIGIN = {0, 0, 0};

    private static final Logger LOGGER = LogManager.getLogger("firelabel");
    private static final boolean DEBUG = Boolean.getBoolean("firelabel.debug");
    private static boolean overlayDebugLogged;
    private static final int SCAN_EVERY_FRAMES = 15;
    private static int frameCounter;
    private static boolean scanFailed;
    // debug statistics of the last block pass
    private static int statEvaluated;
    private static int statQuads;

    private static final class CachedQuad {
        final Quad quad;
        final int sheet;

        CachedQuad(Quad quad, int sheet) {
            this.quad = quad;
            this.sheet = sheet;
        }
    }

    private static final class CachedFire {
        final BlockState state;
        final List<CachedQuad> quads;

        CachedFire(BlockState state, List<CachedQuad> quads) {
            this.state = state;
            this.quads = quads;
        }
    }

    /** Accumulates the quads of one (sheet, mirrored) variant of one source. */
    private static final class Group {
        int opaque;
        int visible;
        double veilSum;
        final BBox box = new BBox();
    }

    /** The four variant groups of a source, indexed by sheet * 2 + (mirrored ? 1 : 0). */
    private static final class Variants {
        final Group[] groups = new Group[4];
        final List<FireQuadLabel> quads = new ArrayList<FireQuadLabel>();

        void add(int sheet, int row, Quad quad, double[] camera, Projector projector, QuadVisibility.Result r) {
            boolean mirrored = quad.isMirroredFrom(camera);
            FireQuadLabel label = FireQuadProjection.capture(sheet, row, quad, camera, projector, r);
            if (label != null) {
                quads.add(label);
            }
            int g = sheet * 2 + (mirrored ? 1 : 0);
            if (groups[g] == null) {
                groups[g] = new Group();
            }
            groups[g].opaque += r.opaqueTexels;
            groups[g].visible += r.visibleTexels;
            groups[g].veilSum += r.veilSum;
            groups[g].box.add(r.box);
        }

        /** The visible variants as parts (empty if nothing of this source is visible). */
        List<FirePart> parts(int[] rows) {
            List<FirePart> parts = new ArrayList<FirePart>();
            for (int g = 0; g < 4; g++) {
                Group grp = groups[g];
                if (grp != null && grp.visible > 0 && !grp.box.isEmpty()) {
                    int sheet = g / 2;
                    double veil = Math.min(1.0, grp.veilSum / grp.visible);
                    parts.add(new FirePart(sheet, (g & 1) == 1, rows[sheet], grp.box, grp.visible, grp.opaque, veil));
                }
            }
            return parts;
        }
    }

    private static final Map<Long, CachedFire> CACHE = new HashMap<Long, CachedFire>();
    private static Sprite cachedSprite0;
    private static Sprite cachedSoulSprite0;

    private FireLabeler() {}

    static FrameRecord label(MinecraftClient client, int frameId, long tick, int row0, int row1) {
        try {
            return labelFrame(client, frameId, tick, row0, row1);
        } finally {
            GuiMask.endFrame();
        }
    }

    private static FrameRecord labelFrame(MinecraftClient client, int frameId, long tick, int row0, int row1) {
        List<FireSourceLabel> out = new ArrayList<FireSourceLabel>();
        List<FireSourceLabel> soulOut = new ArrayList<FireSourceLabel>();
        FrameCapture.Frame data = FrameCapture.take();
        ClientWorld world = client.world;
        // the framebuffer size goes into every row; a minimised window (0x0) throws and the frame is omitted
        int w = client.getWindow().getFramebufferWidth();
        int h = client.getWindow().getFramebufferHeight();
        if (world == null || data == null || row0 < 0 || row1 < 0) {
            return new FrameRecord(frameId, tick, row0, row1, w, h, out);
        }
        // fire is labelled against what the GUI drew over it; without a trustworthy mask the frame is omitted
        GuiMask.requireReady();

        final Sprite sprite0 = ModelLoader.FIRE_0.getSprite();
        final Sprite sprite1 = ModelLoader.FIRE_1.getSprite();
        final Sprite soul0 = SoulFireSprites.ZERO.getSprite();
        final Sprite soul1 = SoulFireSprites.ONE.getSprite();
        final int soulRow0 = FireLabel.spriteFrame(SoulFireSprites.ZERO);
        final int soulRow1 = FireLabel.spriteFrame(SoulFireSprites.ONE);
        if (soulRow0 < 0 || soulRow1 < 0) {
            throw new IllegalStateException("Soul fire animation unavailable; refusing incomplete labels");
        }
        if (sprite0 != cachedSprite0 || soul0 != cachedSoulSprite0) {
            CACHE.clear(); // resources were reloaded: quads and sprites are new objects
            cachedSprite0 = sprite0;
            cachedSoulSprite0 = soul0;
        }
        final int fr0 = row0;
        final int fr1 = row1;
        TexelMask[] masks = {
            (tx, ty) -> !sprite0.isPixelTransparent(fr0, tx, ty),
            (tx, ty) -> !sprite1.isPixelTransparent(fr1, tx, ty)
        };
        int[] rows = {row0, row1};
        int[] soulRows = {soulRow0, soulRow1};
        TexelMask[] soulMasks = {
            (tx, ty) -> !soul0.isPixelTransparent(soulRow0, tx, ty),
            (tx, ty) -> !soul1.isPixelTransparent(soulRow1, tx, ty)
        };
        int texels = sprite0.getWidth();
        // RaycastContext needs a non-null entity (it builds a ShapeContext from it); the camera entity is a safe pick
        Entity viewer = client.getCameraEntity() != null ? client.getCameraEntity() : client.player;
        if (viewer == null) {
            throw new IllegalStateException("no camera entity: cannot ray-cast, so this frame is not labelled");
        }
        WorldOccluder blocks = new WorldOccluder(world, viewer);
        EntityOccluder entities = new EntityOccluder(world, data.camera);

        if (frameCounter++ % SCAN_EVERY_FRAMES == 0) {
            try {
                FireTracker.scan(world, data.camera[0], data.camera[2]);
            } catch (RuntimeException e) {
                // a scan problem must not cost us the frame's labels; blocks are still picked up by the hooks
                if (!scanFailed) {
                    scanFailed = true;
                    LOGGER.error("Fire block scan failed", e);
                }
            }
        }
        int blockLabelsBefore = out.size();
        labelBlocks(client, world, data, w, h, masks, rows, texels, blocks, entities, sprite0, sprite1, out,
                soulMasks, soulRows, soul0, soul1, soulOut);
        if (DEBUG && frameCounter % 300 == 1) {
            LOGGER.info("fire stats: tracked={} evaluated={} blockLabels={} quadsOfLastBlock={} entityQuads={} occludingEntities={}",
                    FireTracker.positions().size(), statEvaluated, out.size() - blockLabelsBefore,
                    statQuads, data.entityQuads.size(), entities.count());
            LOGGER.info("gui mask: regionReads={} pixelsRead={} alpha1-127={} alpha128-254={} alpha255={}",
                    GuiMask.statReads, GuiMask.statPixels, GuiMask.statLow, GuiMask.statHigh, GuiMask.statOpaque);
        }
        labelEntities(data, w, h, masks, rows, texels, blocks, entities, out);
        labelOverlay(data, w, h, masks, rows, texels, out);
        return new FrameRecord(frameId, tick, row0, row1, w, h, out, soulRow0, soulRow1, soulOut);
    }

    // ---------------------------------------------------------------- fire blocks

    private static void labelBlocks(
            MinecraftClient client, ClientWorld world, FrameCapture.Frame data, int w, int h,
            TexelMask[] masks, int[] rows, int texels, Occluder blocks, EntityOccluder entities,
            Sprite sprite0, Sprite sprite1, List<FireSourceLabel> out,
            TexelMask[] soulMasks, int[] soulRows, Sprite soul0, Sprite soul1, List<FireSourceLabel> soulOut) {
        Projector projector = new Projector(data.worldMvp, w, h);
        double[] cam = data.camera;
        Occluder occluder = (c, target) -> blocks.blocked(c, target) || entities.blocked(c, target, -1);
        statEvaluated = 0;
        Iterator<Long> it = FireTracker.positions().iterator();
        while (it.hasNext()) {
            long key = it.next();
            BlockPos pos = BlockPos.fromLong(key);
            if (!world.isChunkLoaded(pos)) {
                it.remove();
                CACHE.remove(key);
                continue;
            }
            BlockState state = world.getBlockState(pos);
            if (!FireTracker.isFire(state)) {
                it.remove();
                CACHE.remove(key);
                continue;
            }
            double dx = pos.getX() + 0.5 - cam[0];
            double dy = pos.getY() + 0.5 - cam[1];
            double dz = pos.getZ() + 0.5 - cam[2];
            double dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dist > MAX_DIST) {
                continue;
            }
            double[] min = {pos.getX(), pos.getY(), pos.getZ()};
            double[] max = {pos.getX() + 1.0, pos.getY() + FIRE_HEIGHT, pos.getZ() + 1.0};
            if (BoxCulling.isOffScreen(projector, cam, min, max)) {
                continue;
            }

            boolean soul = state.isOf(Blocks.SOUL_FIRE);
            int[] sourceRows = soul ? soulRows : rows;
            TexelMask[] sourceMasks = soul ? soulMasks : masks;
            CachedFire fire = CACHE.get(key);
            if (fire == null || fire.state != state) {
                fire = new CachedFire(state, buildQuads(client, state, pos, soul ? soul0 : sprite0, soul ? soul1 : sprite1));
                CACHE.put(key, fire);
            }
            statEvaluated++;
            statQuads = fire.quads.size();

            // what the GUI drew over this fire's part of the screen (hotbar, chat, menus ...)
            ScreenMask gui = GuiMask.read(w, h, ScreenBounds.ofBox(projector, cam, min, max));
            Variants variants = new Variants();
            for (CachedQuad cq : fire.quads) {
                QuadVisibility.Result r = QuadVisibility.evaluate(
                        cq.quad, cam, projector, texels, sourceMasks[cq.sheet], occluder, MACRO, true, gui);
                variants.add(cq.sheet, sourceRows[cq.sheet], cq.quad, cam, projector, r);
            }
            List<FirePart> parts = variants.parts(sourceRows);
            if (!parts.isEmpty()) {
                (soul ? soulOut : out).add(FireSourceLabel.block(pos.getX(), pos.getY(), pos.getZ(), dist, parts, variants.quads));
            }
        }
    }

    /** The quads the game draws for this fire block: same model, same per-position seeding as vanilla. */
    private static List<CachedQuad> buildQuads(
            MinecraftClient client, BlockState state, BlockPos pos, Sprite sprite0, Sprite sprite1) {
        BakedModel model = client.getBlockRenderManager().getModel(state);
        Random random = new Random();
        Map<BakedQuad, Boolean> seen = new IdentityHashMap<BakedQuad, Boolean>();
        List<CachedQuad> quads = new ArrayList<CachedQuad>();
        Direction[] faces = {null, Direction.DOWN, Direction.UP, Direction.NORTH, Direction.SOUTH, Direction.WEST, Direction.EAST};
        for (Direction face : faces) {
            random.setSeed(state.getRenderingSeed(pos)); // vanilla re-seeds before every getQuads call
            for (BakedQuad baked : model.getQuads(state, face, random)) {
                if (seen.put(baked, Boolean.TRUE) != null) {
                    continue;
                }
                Sprite sprite = ((BakedQuadAccessor) baked).firelabel$getSprite();
                int sheet = sprite == sprite1 ? 1 : (sprite == sprite0 ? 0 : -1);
                if (sheet < 0) {
                    continue;
                }
                int[] data = baked.getVertexData(); // 8 ints per vertex: x y z color u v light normal
                double[][] v = new double[4][3];
                double[][] uv = new double[4][2];
                float du = sprite.getMaxU() - sprite.getMinU();
                float dv = sprite.getMaxV() - sprite.getMinV();
                for (int i = 0; i < 4; i++) {
                    v[i][0] = pos.getX() + Float.intBitsToFloat(data[i * 8]);
                    v[i][1] = pos.getY() + Float.intBitsToFloat(data[i * 8 + 1]);
                    v[i][2] = pos.getZ() + Float.intBitsToFloat(data[i * 8 + 2]);
                    uv[i][0] = (Float.intBitsToFloat(data[i * 8 + 4]) - sprite.getMinU()) / du;
                    uv[i][1] = (Float.intBitsToFloat(data[i * 8 + 5]) - sprite.getMinV()) / dv;
                }
                quads.add(new CachedQuad(new Quad(v, uv), sheet));
            }
        }
        return Collections.unmodifiableList(quads);
    }

    // ---------------------------------------------------------------- burning entities

    private static void labelEntities(
            FrameCapture.Frame data, int w, int h, TexelMask[] masks, int[] rows, int texels,
            Occluder blocks, EntityOccluder entities, List<FireSourceLabel> out) {
        if (data.entityQuads.isEmpty()) {
            return;
        }
        // geometry is in view space, so the camera is the origin and only the projection is applied
        Projector projector = new Projector(data.worldProjection, w, h);
        final ViewTransform toWorld = new ViewTransform(data.worldView, data.camera);
        final double[] camWorld = data.camera;

        // one GUI-coverage read per burning entity, around everything it draws on screen
        Map<Integer, List<double[]>> corners = new HashMap<Integer, List<double[]>>();
        for (FrameCapture.EntityFireQuad q : data.entityQuads) {
            List<double[]> list = corners.get(q.entityId);
            if (list == null) {
                list = new ArrayList<double[]>();
                corners.put(q.entityId, list);
            }
            for (int i = 0; i < 4; i++) {
                list.add(q.quad.vertex(i));
            }
        }
        Map<Integer, ScreenMask> guiByEntity = new HashMap<Integer, ScreenMask>();
        for (Map.Entry<Integer, List<double[]>> e : corners.entrySet()) {
            BBox region = ScreenBounds.ofPoints(projector, ORIGIN, e.getValue().toArray(new double[0][]));
            guiByEntity.put(e.getKey(), GuiMask.read(w, h, region));
        }

        Map<Integer, Variants> perEntity = new LinkedHashMap<Integer, Variants>();
        Map<Integer, String> types = new HashMap<Integer, String>();
        Map<Integer, Double> minDist = new HashMap<Integer, Double>();
        for (FrameCapture.EntityFireQuad q : data.entityQuads) {
            final int self = q.entityId;
            // a burning entity's own hitbox surrounds its fire, so it must not hide it; other entities and blocks do
            Occluder viewOccluder = (camView, target) -> {
                double[] world = toWorld.toWorld(target);
                return blocks.blocked(camWorld, world) || entities.blocked(camWorld, world, self);
            };
            QuadVisibility.Result r = QuadVisibility.evaluate(
                    q.quad, ORIGIN, projector, texels, masks[q.sheet], viewOccluder, MACRO, false, guiByEntity.get(self));
            Variants v = perEntity.get(self);
            if (v == null) {
                v = new Variants();
                perEntity.put(self, v);
                types.put(self, q.entityType);
            }
            v.add(q.sheet, rows[q.sheet], q.quad, ORIGIN, projector, r);
            double d = centroidDistance(q.quad);
            Double prev = minDist.get(self);
            minDist.put(self, prev == null ? d : Math.min(prev, d));
        }
        for (Map.Entry<Integer, Variants> e : perEntity.entrySet()) {
            List<FirePart> parts = e.getValue().parts(rows);
            if (!parts.isEmpty()) {
                out.add(FireSourceLabel.entity(e.getKey(), types.get(e.getKey()), minDist.get(e.getKey()), parts, e.getValue().quads));
            }
        }
    }

    private static double centroidDistance(Quad q) {
        double x = 0;
        double y = 0;
        double z = 0;
        for (int i = 0; i < 4; i++) {
            double[] v = q.vertex(i);
            x += v[0];
            y += v[1];
            z += v[2];
        }
        return Math.sqrt(x * x + y * y + z * z) / 4.0;
    }

    // ---------------------------------------------------------------- first-person overlay

    private static void labelOverlay(
            FrameCapture.Frame data, int w, int h, TexelMask[] masks, int[] rows, int texels,
            List<FireSourceLabel> out) {
        if (data.overlayModel == null || data.overlayProjection == null) {
            return;
        }
        if (DEBUG && !overlayDebugLogged) {
            overlayDebugLogged = true;
            StringBuilder sb = new StringBuilder();
            for (double d : data.overlayProjection) {
                sb.append(String.format(java.util.Locale.ROOT, "%.4f ", d));
            }
            LOGGER.info("overlay: frame {}x{}, projection (column-major) = {}", w, h, sb.toString().trim());
        }
        Projector projector = new Projector(data.overlayProjection, w, h);
        Occluder none = (cam, target) -> false; // drawn with depth test ALWAYS: nothing can hide it
        Quad[] quads = OverlayQuads.build(data.overlayModel);
        List<double[]> corners = new ArrayList<double[]>();
        for (Quad q : quads) {
            for (int i = 0; i < 4; i++) {
                corners.add(q.vertex(i));
            }
        }
        // the overlay sits below the GUI too: hotbar, chat and menus drawn over it hide it
        ScreenMask gui = GuiMask.read(w, h, ScreenBounds.ofPoints(projector, ORIGIN, corners.toArray(new double[0][])));
        Variants variants = new Variants();
        for (Quad q : quads) {
            QuadVisibility.Result r = QuadVisibility.evaluate(q, ORIGIN, projector, texels, masks[1], none, MACRO, false, gui);
            variants.add(1, rows[1], q, ORIGIN, projector, r);
        }
        List<FirePart> parts = variants.parts(rows);
        if (!parts.isEmpty()) {
            out.add(FireSourceLabel.overlay(parts, variants.quads));
        }
    }

    // ---------------------------------------------------------------- occlusion

    /** Blocks the line of sight if an opaque full cube lies between the camera and the point (world space). */
    private static final class WorldOccluder implements Occluder {
        private final ClientWorld world;
        private final Entity viewer;

        WorldOccluder(ClientWorld world, Entity viewer) {
            this.world = world;
            this.viewer = viewer;
        }

        @Override
        public boolean blocked(double[] cam, double[] target) {
            RaycastContext context = new RaycastContext(
                    new Vec3d(cam[0], cam[1], cam[2]),
                    new Vec3d(target[0], target[1], target[2]),
                    RaycastContext.ShapeType.COLLIDER,
                    RaycastContext.FluidHandling.NONE,
                    viewer);
            Boolean hit = BlockView.<Boolean>raycast(
                    context,
                    (ctx, p) -> world.getBlockState(p).isOpaqueFullCube(world, p) ? Boolean.TRUE : null,
                    ctx -> Boolean.FALSE);
            return hit != null && hit;
        }
    }

    /**
     * Entities hide fire too. Approximation: an entity occludes by its hitbox, not its model, so it can hide fire
     * that peeks around a thin model. An entity containing the camera (your own body in first person) is ignored,
     * and a burning entity is excluded for its own fire.
     */
    private static final class EntityOccluder {
        private final EntityOcclusionIndex index;
        private final int count;

        EntityOccluder(ClientWorld world, double[] cam) {
            List<EntityOcclusionIndex.Entry> entries = new ArrayList<EntityOcclusionIndex.Entry>();
            for (Entity e : world.getEntities()) {
                if (e.isInvisible() || e.isSpectator()) {
                    continue;
                }
                Box b = e.getBoundingBox();
                double dx = (b.minX + b.maxX) / 2 - cam[0];
                double dy = (b.minY + b.maxY) / 2 - cam[1];
                double dz = (b.minZ + b.maxZ) / 2 - cam[2];
                if (dx * dx + dy * dy + dz * dz > (MAX_DIST + 8) * (MAX_DIST + 8)) {
                    continue;
                }
                entries.add(new EntityOcclusionIndex.Entry(e.getEntityId(),
                        new double[] {b.minX, b.minY, b.minZ}, new double[] {b.maxX, b.maxY, b.maxZ}));
            }
            count = entries.size();
            index = new EntityOcclusionIndex(entries);
        }

        int count() {
            return count;
        }

        boolean blocked(double[] cam, double[] target, int excludeId) {
            return index.blocked(cam, target, excludeId);
        }
    }
}
