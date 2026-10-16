import unittest
import numpy as np
from render import load_sprites
from prepare_survival_train import quality,balanced_select


class ScreeningTests(unittest.TestCase):
    def test_exact_shaded_sprite_passes(self):
        sprite=load_sprites()[14]
        rgb=np.uint8(sprite[:,:,:3]*.6);rgb[sprite[:,:,3]<128]=[30,35,40]
        crop=rgb.repeat(4,0).repeat(4,1)
        result=quality(crop,sprite)
        self.assertGreater(result['coverage'],.95)
        self.assertAlmostEqual(result['gain'],.6,delta=.02)

    def test_missing_most_opaque_cells_fails(self):
        sprite=load_sprites()[14];rgb=sprite[:,:,:3].copy()
        coords=np.argwhere(sprite[:,:,3]>127)
        for y,x in coords[:len(coords)//2]:rgb[y,x]=[20,30,40]
        self.assertLess(quality(rgb.repeat(4,0).repeat(4,1),sprite)['coverage'],.7)

    def test_balanced_select_avoids_linear_expression_depth(self):
        expression=balanced_select(list(range(1024)))
        self.assertEqual(expression.count('eq('),1024)
        depth=highest=0
        for ch in expression:
            if ch=='(':depth+=1;highest=max(highest,depth)
            if ch==')':depth-=1
        self.assertEqual(depth,0);self.assertLess(highest,15)


if __name__=='__main__':unittest.main()
