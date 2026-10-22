package org.firecracking.hudinfo;

/** When the overlay (line, strip, log row) is drawn. Kept out of the mixin so it can be tested without a client.
 *  Mirrors mod-gui: the only things that hide it are no player, the F1 hidden HUD, and the F3 screen being open.
 *  A pinned debug entry (vanilla's {@code shouldShowDebugHud()} counts those) must NOT hide it. */
public final class Visibility {
    private Visibility() {}

    public static boolean shouldDraw(boolean playerPresent, boolean hudHidden, boolean f3Open) {
        return playerPresent && !hudHidden && !f3Open;
    }
}
