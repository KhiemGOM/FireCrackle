package org.firecracking.guilabel.mixin;

import net.minecraft.client.gui.screen.ingame.HandledScreen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

@Mixin(HandledScreen.class)
public interface HandledScreenAccessor {
    @Accessor("x") int guilabel$x();
    @Accessor("y") int guilabel$y();
    @Accessor("backgroundWidth") int guilabel$width();
    @Accessor("backgroundHeight") int guilabel$height();
}
