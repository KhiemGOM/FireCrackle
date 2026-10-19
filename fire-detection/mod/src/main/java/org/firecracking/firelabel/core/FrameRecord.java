package org.firecracking.firelabel.core;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Everything the label log says about one rendered frame. {@code fire} is derived from the sources, so it can
 * never disagree with them. There is deliberately no frame-level box: with several fires on screen one
 * rectangle around all of them is a poor label, so every source carries its own box.
 */
public final class FrameRecord {
    public final int frameId;
    public final long tick;
    /** Displayed image row of fire_0 / fire_1 this frame, -1 if unavailable. */
    public final int f0;
    public final int f1;
    /** Game framebuffer size in pixels: all boxes are in these pixels, so they can be scaled to any video size. */
    public final int width;
    public final int height;

    private final List<FireSourceLabel> fires;
    /** Soul sources remain separate so legacy normal-fire consumers cannot mistake cyan for orange. */
    private final List<FireSourceLabel> soulFires;
    public final int s0;
    public final int s1;
    public final boolean hasSoulCapture;

    public FrameRecord(int frameId, long tick, int f0, int f1, int width, int height, List<FireSourceLabel> fires) {
        this(frameId, tick, f0, f1, width, height, fires, -1, -1, Collections.<FireSourceLabel>emptyList(), false);
    }

    public FrameRecord(int frameId, long tick, int f0, int f1, int width, int height, List<FireSourceLabel> fires,
            int s0, int s1, List<FireSourceLabel> soulFires) {
        this(frameId, tick, f0, f1, width, height, fires, s0, s1, soulFires, true);
    }

    private FrameRecord(int frameId, long tick, int f0, int f1, int width, int height, List<FireSourceLabel> fires,
            int s0, int s1, List<FireSourceLabel> soulFires, boolean hasSoulCapture) {
        if (width <= 0 || height <= 0) {
            throw new IllegalArgumentException("framebuffer size must be positive: " + width + "x" + height);
        }
        this.frameId = frameId;
        this.tick = tick;
        this.f0 = f0;
        this.f1 = f1;
        this.width = width;
        this.height = height;
        this.fires = Collections.unmodifiableList(new ArrayList<FireSourceLabel>(fires));
        this.soulFires = Collections.unmodifiableList(new ArrayList<FireSourceLabel>(soulFires));
        this.s0 = s0;
        this.s1 = s1;
        this.hasSoulCapture = hasSoulCapture;
    }

    public List<FireSourceLabel> fires() {
        return fires;
    }

    public List<FireSourceLabel> soulFires() { return soulFires; }

    /** True iff at least one fire source is visible. */
    public boolean fire() {
        return !fires.isEmpty();
    }
}
