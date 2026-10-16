import unittest
import numpy as np
import torch
from render import colour_mask
from train import inputs,make_model,checkpoint_model,evaluate
from finetune import augment


class ModelTests(unittest.TestCase):
    def test_input_has_no_label(self):
        rgb=np.full((2,64,64,3),[200,140,20],np.uint8)
        x=inputs(rgb)
        self.assertEqual(x.shape,(2,4,64,64))
        np.testing.assert_allclose(x[0,3].numpy(),colour_mask(rgb[0])/127.5-1)
        np.testing.assert_allclose(x[0,:3,0,0].numpy(),np.array([200,140,20])/127.5-1,atol=1e-6)

    def test_shape_and_parameter_count(self):
        torch.set_num_threads(2);model=make_model().eval()
        with torch.inference_mode():self.assertEqual(model(torch.zeros(2,4,64,64)).shape,(2,128))
        self.assertEqual(sum(p.numel() for p in model.parameters()),1649200)

    def test_wrong_confident_results_are_counted(self):
        class Fake(torch.nn.Module):
            def forward(self,x):
                y=torch.zeros(len(x),128);y[:,0]=20;return y
        metrics,_,_=evaluate(Fake(),torch.zeros(3,4,64,64),torch.tensor([0,1,-1]),torch.device("cpu"))
        self.assertEqual(metrics["top1"],1)
        self.assertEqual(metrics["0.95"],dict(accepted=3,wrong=2))

    def test_larger_architecture_checkpoint_and_legacy_loading(self):
        torch.set_num_threads(2)
        for arch in ["resnet18","mobilenet_v3_small"]:
            original=make_model(arch).eval()
            checkpoint=dict(state_dict=original.state_dict())
            if arch=="resnet18":checkpoint["architecture"]=arch
            loaded=checkpoint_model(checkpoint).eval()
            with torch.inference_mode():
                x=torch.randn(2,4,64,64)
                self.assertEqual(loaded(x).shape,(2,128))
                torch.testing.assert_close(loaded(x),original(x))
            if arch=="resnet18":self.assertGreater(sum(p.numel() for p in loaded.parameters()),11000000)
        with self.assertRaises(ValueError):make_model("typo")

    def test_augmentation_preserves_sheet_and_row(self):
        torch.manual_seed(29);labels=torch.arange(128)
        x,y=augment(torch.zeros(128,4,64,64),labels)
        self.assertTrue(torch.equal(y//2,labels//2))
        self.assertTrue((y!=labels).any())
        self.assertTrue(torch.isfinite(x).all())
        self.assertGreaterEqual(float(x.min()),-1)
        self.assertLessEqual(float(x.max()),1)


if __name__=="__main__":unittest.main()
