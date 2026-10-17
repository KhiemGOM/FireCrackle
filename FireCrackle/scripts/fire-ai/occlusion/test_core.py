import tempfile,unittest
from pathlib import Path
import numpy as np
import torch
from core import MaskNet,OwnershipRenderer,crop_native,counts,metrics,spatial_masks
from survival import weak_labels,SurvivalPatches


class OcclusionControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(1)
        cls.renderer=OwnershipRenderer(np.full((2,160,160,3),30,np.uint8),'cpu')

    def test_scene_is_reproducible(self):
        a=self.renderer.scene(torch.arange(4),701,'other_fire');b=self.renderer.scene(torch.arange(4),701,'other_fire')
        for name in ['x','y','foreign','image','quad']:self.assertTrue(torch.equal(a[name],b[name]),name)

    def test_visible_and_foreign_do_not_overlap(self):
        for kind in self.renderer.kinds:
            s=self.renderer.scene(torch.arange(4),702,kind)
            self.assertFalse(bool((s['visible']&s['occluder']).any()),kind)
            self.assertTrue(torch.isfinite(s['x']).all())
            self.assertEqual(s['x'].shape,(4,4,64,64))

    def test_clean_keeps_target_and_no_target_is_empty(self):
        clean=self.renderer.scene(torch.arange(4),703,'clean')
        self.assertTrue(bool(clean['y'].any()));self.assertFalse(bool(clean['foreign'].any()))
        absent=self.renderer.scene(torch.arange(4),703,'no_target')
        self.assertFalse(bool(absent['visible'].any()));self.assertFalse(bool(absent['y'].any()))

    def test_oracle_removes_foreign_without_changing_uncovered_regions(self):
        s=self.renderer.scene(torch.arange(4),704,'aligned_fire')
        keep=~s['occluder'];self.assertFalse(bool((keep&s['occluder']).any()))
        self.assertTrue(bool((keep&s['visible']).any()))

    def test_full_quad_crop_preserves_pixel_centres(self):
        image=torch.arange(64*64).reshape(1,1,64,64).float()
        q=torch.tensor([[[0.,0.],[64.,0.],[64.,64.],[0.,64.]]])
        self.assertTrue(torch.allclose(crop_native(image,q),image,atol=.001))

    def test_morphology_and_empty_mask_are_finite(self):
        mask=torch.zeros(1,1,64,64);mask[:,:,20,20]=1
        m=spatial_masks(mask);self.assertEqual(int(m['opening'].sum()),0);self.assertEqual(int(m['majority'].sum()),0)

    def test_metrics_do_not_confuse_foreign_with_background(self):
        p=torch.tensor([1,1,0]);y=torch.tensor([1,0,1]);f=torch.tensor([0,1,0])
        m=metrics(counts(p,y,f));self.assertEqual(m['recall'],.5);self.assertEqual(m['foreign_retention'],1);self.assertEqual(m['iou'],1/3)

    def test_model_roundtrip_without_target_identity(self):
        torch.manual_seed(17);m=MaskNet().eval();x=torch.zeros(2,4,64,64)
        with torch.inference_mode():expected=m(x)
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'model.pt';torch.save(m.state_dict(),p);other=MaskNet().eval();other.load_state_dict(torch.load(p,weights_only=True))
            with torch.inference_mode():self.assertTrue(torch.equal(expected,other(x)))
        self.assertEqual(expected.shape,(2,1,64,64))

    def test_weak_supervision_ignores_unmatched_opaque_instead_of_negative(self):
        sprites=torch.ones(1,4,16,16);sprites[:,1]=.5;sprites[:,2]=.05
        rgb=torch.zeros(1,3,64,64);rgb[:,2]=1
        target,valid=weak_labels(rgb,torch.tensor([0]),sprites)
        self.assertFalse(bool(target.any()));self.assertFalse(bool(valid.any()))
        sprites[:,3]=0;target,valid=weak_labels(rgb,torch.tensor([0]),sprites)
        self.assertTrue(bool(valid.any()));self.assertFalse(bool(target.any()))

    def test_real_patch_train_and_validation_are_temporally_separated(self):
        train=SurvivalPatches('train','cpu');val=SurvivalPatches('val','cpu')
        self.assertEqual(len(train.ids),100);self.assertEqual(len(val.ids),15)
        self.assertLess(max(int(s.split('-')[0]) for s in train.ids)+60,min(int(s.split('-')[0]) for s in val.ids))
        s=train.batch(4,171);self.assertFalse(bool(((s['y']>0)&(s['foreign']>0)).any()))
        self.assertTrue(bool(s['valid'].any()))


if __name__=='__main__':unittest.main()
