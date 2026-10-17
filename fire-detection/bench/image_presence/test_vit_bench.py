import unittest
import torch
from vit_bench import ViTBag,set_trainable

class ViTContract(unittest.TestCase):
    def test_image_logits_and_fine_tuning_boundary(self):
        torch.set_num_threads(2)
        model=ViTBag(False).eval()
        with torch.inference_mode():self.assertEqual(tuple(model(torch.zeros(2,3,224,224)).shape),(2,))
        set_trainable(model,False)
        self.assertFalse(any(p.requires_grad for p in model.features.parameters()))
        self.assertTrue(all(p.requires_grad for p in model.head.parameters()))
        set_trainable(model,True)
        blocks=list(model.features.net.encoder.layers.children())
        self.assertFalse(any(p.requires_grad for b in blocks[:-2] for p in b.parameters()))
        self.assertTrue(all(p.requires_grad for b in blocks[-2:] for p in b.parameters()))
        self.assertFalse(model.features.net.conv_proj.weight.requires_grad)
        self.assertFalse(model.features.net.class_token.requires_grad)
        self.assertTrue(model.features.net.encoder.ln.weight.requires_grad)

if __name__=='__main__':unittest.main()
