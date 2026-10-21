import unittest
import torch
from resnet_bench import ResNetBag,set_trainable

class ModelContract(unittest.TestCase):
    def test_backbones_return_one_logit_per_image(self):
        torch.set_num_threads(2)
        for name in ['resnet18','resnet50']:
            model=ResNetBag(name,pretrained=False).eval()
            with torch.inference_mode():self.assertEqual(tuple(model(torch.zeros(2,3,224,224)).shape),(2,))
            set_trainable(model,False);self.assertFalse(any(p.requires_grad for p in model.features.parameters()))
            self.assertTrue(all(p.requires_grad for p in model.head.parameters()))
            set_trainable(model,True)
            self.assertTrue(all(p.requires_grad for p in model.features[-1].parameters()))
            self.assertFalse(any(p.requires_grad for p in model.features[0].parameters()))

if __name__=='__main__':unittest.main()
