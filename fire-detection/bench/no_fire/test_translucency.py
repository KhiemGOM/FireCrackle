import unittest
import numpy as np
from translucency import detect

class MaterialTests(unittest.TestCase):
 def test_gui_unknown_items_are_not_world(self):
  from gui_mask_native import world_pixels
  p=np.array([[0,0x100,0x200,0x304,0x305,0x30b,0x301,0x315]],np.uint16)
  self.assertEqual(world_pixels(p).tolist(),[[1,0,0,0,0,0,1,1]])
 def test_gui_requires_confirmation(self):
  from gui_mask_native import mask
  with self.assertRaises(ValueError):mask(np.zeros((16,16,3),np.uint8))
 def test_flat_sky_not_surface(self):
  a=np.full((240,320,3),[70,145,230],np.uint8)
  self.assertFalse(detect(a)['abstain'])
 def test_textured_blue_surface(self):
  rng=np.random.default_rng(12);a=np.full((240,320,3),[40,85,150],np.int16)
  a+=rng.integers(-20,21,(240,320,1),dtype=np.int16)
  self.assertIn('textured_blue_water_or_tinted_glass',detect(a.astype(np.uint8))['reasons'])
 def test_white_cloud_boundaries_do_not_supply_blue_texture(self):
  a=np.full((240,320,3),[70,145,230],np.uint8)
  a[30:100,30:260]=[230,230,230]
  a[140:170,100:290]=[245,245,245]
  self.assertFalse(detect(a)['abstain'])
 def test_dark_obsidian_not_portal(self):
  a=np.full((240,320,3),[30,15,55],np.uint8)
  self.assertFalse(detect(a)['abstain'])
 def test_pale_blue_cloud_shading(self):
  a=np.full((240,320,3),[185,210,250],np.int16)
  a+=np.random.default_rng(4).integers(-8,6,(240,320,1),dtype=np.int16)
  self.assertFalse(detect(a.astype(np.uint8))['abstain'])
 def test_portal_and_gui_mask(self):
  a=np.full((240,320,3),[140,20,210],np.int16)
  a+=np.random.default_rng(2).integers(-20,21,(240,320,1),dtype=np.int16);a=a.astype(np.uint8)
  self.assertTrue(detect(a)['abstain'])
  self.assertFalse(detect(a,np.zeros((240,320),np.uint8))['abstain'])

if __name__=='__main__':unittest.main()
